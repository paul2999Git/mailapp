/**
 * Import categories and rules into prod DB from a JSON file created by export-dev-data.ts.
 * Resolves all IDs by name/email address — safe to run against a fresh prod DB.
 * Existing records (matched by name or matchType+matchValue) are skipped, not overwritten.
 *
 * Usage (from server/ directory, with prod DATABASE_URL set):
 *   DATABASE_URL=<prod_url> npx tsx src/scripts/import-dev-data.ts <user-email> migration-export.json
 *
 * Example:
 *   DATABASE_URL="postgresql://..." npx tsx src/scripts/import-dev-data.ts you@example.com migration-export.json
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

interface ExportedCategory {
    name: string;
    parentName: string | null;
    description: string | null;
    color: string | null;
    icon: string | null;
    priority: number;
}

interface ExportedRule {
    matchType: string;
    matchValue: string;
    action: string;
    priority: number;
    confidenceBoost: string;
    targetCategoryName: string | null;
    targetFolderPath: string | null;
    targetFolderAccountEmail: string | null;
    accountEmail: string | null;
}

interface ExportFile {
    exportedAt: string;
    userEmail: string;
    categories: ExportedCategory[];
    rules: ExportedRule[];
}

async function main() {
    const userEmail = process.argv[2];
    const exportFile = process.argv[3];

    if (!userEmail || !exportFile) {
        console.error('Usage: DATABASE_URL=<prod_url> npx tsx src/scripts/import-dev-data.ts <user-email> <export-file>');
        process.exit(1);
    }

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
        console.error(`User not found in prod DB: ${userEmail}`);
        console.error('Make sure you have logged in to prod at least once to create the user record.');
        process.exit(1);
    }

    const data: ExportFile = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
    console.log(`Importing data exported at ${data.exportedAt} from ${data.userEmail}`);

    // -------------------------------------------------------------------------
    // 1. Import categories (parents first, then children)
    // -------------------------------------------------------------------------
    let catCreated = 0;
    let catSkipped = 0;

    // Two passes: first create parent-less categories, then children
    const parentFirst = [
        ...data.categories.filter(c => c.parentName === null),
        ...data.categories.filter(c => c.parentName !== null),
    ];

    for (const cat of parentFirst) {
        const existing = await prisma.category.findFirst({
            where: { userId: user.id, name: cat.name },
        });
        if (existing) {
            catSkipped++;
            continue;
        }

        let parentId: string | null = null;
        if (cat.parentName) {
            const parent = await prisma.category.findFirst({
                where: { userId: user.id, name: cat.parentName },
            });
            if (!parent) {
                console.warn(`  WARNING: parent category "${cat.parentName}" not found, creating "${cat.name}" without parent`);
            } else {
                parentId = parent.id;
            }
        }

        await prisma.category.create({
            data: {
                userId: user.id,
                name: cat.name,
                parentId,
                description: cat.description,
                color: cat.color,
                icon: cat.icon,
                priority: cat.priority,
                isSystem: false,
            },
        });
        console.log(`  Created category: ${cat.name}`);
        catCreated++;
    }

    console.log(`Categories: ${catCreated} created, ${catSkipped} already existed`);

    // -------------------------------------------------------------------------
    // 2. Import rules
    // -------------------------------------------------------------------------
    let ruleCreated = 0;
    let ruleSkipped = 0;
    let ruleWarned = 0;

    for (const rule of data.rules) {
        // Skip if rule already exists
        const existing = await prisma.learnedRule.findFirst({
            where: { userId: user.id, matchType: rule.matchType, matchValue: rule.matchValue },
        });
        if (existing) {
            ruleSkipped++;
            continue;
        }

        // Resolve accountId by email
        let accountId: string | null = null;
        if (rule.accountEmail) {
            const account = await prisma.account.findFirst({
                where: { userId: user.id, emailAddress: rule.accountEmail },
            });
            if (!account) {
                console.warn(`  WARNING: account "${rule.accountEmail}" not found in prod — rule "${rule.matchType}:${rule.matchValue}" will be created without account filter`);
                ruleWarned++;
            } else {
                accountId = account.id;
            }
        }

        // Resolve targetCategoryId by name
        let targetCategoryId: string | null = null;
        if (rule.targetCategoryName) {
            const cat = await prisma.category.findFirst({
                where: { userId: user.id, name: rule.targetCategoryName },
            });
            if (!cat) {
                console.warn(`  WARNING: target category "${rule.targetCategoryName}" not found for rule "${rule.matchType}:${rule.matchValue}" — skipping rule`);
                ruleWarned++;
                continue;
            }
            targetCategoryId = cat.id;
        }

        // Resolve targetFolderId by account email + folder path/name
        let targetFolderId: string | null = null;
        if (rule.targetFolderPath && rule.targetFolderAccountEmail) {
            const folderAccount = await prisma.account.findFirst({
                where: { userId: user.id, emailAddress: rule.targetFolderAccountEmail },
            });
            if (!folderAccount) {
                console.warn(`  WARNING: folder account "${rule.targetFolderAccountEmail}" not found — rule "${rule.matchType}:${rule.matchValue}" will be created without folder target`);
                ruleWarned++;
            } else {
                const folder = await prisma.folder.findFirst({
                    where: {
                        accountId: folderAccount.id,
                        OR: [
                            { fullPath: rule.targetFolderPath },
                            { name: rule.targetFolderPath },
                        ],
                    },
                });
                if (!folder) {
                    console.warn(`  WARNING: folder "${rule.targetFolderPath}" not found yet on account "${rule.targetFolderAccountEmail}" — sync your accounts first, then re-run this script`);
                    ruleWarned++;
                } else {
                    targetFolderId = folder.id;
                }
            }
        }

        await prisma.learnedRule.create({
            data: {
                userId: user.id,
                accountId,
                matchType: rule.matchType,
                matchValue: rule.matchValue,
                targetCategoryId,
                targetFolderId,
                action: rule.action,
                priority: rule.priority,
                confidenceBoost: parseFloat(rule.confidenceBoost),
            },
        });
        console.log(`  Created rule: ${rule.matchType} = "${rule.matchValue}"`);
        ruleCreated++;
    }

    console.log(`Rules: ${ruleCreated} created, ${ruleSkipped} already existed, ${ruleWarned} warnings`);

    if (ruleWarned > 0) {
        console.log('\nTip: If rules had folder warnings, add your email accounts, let them sync, then run this script again — it will skip already-imported rules and fill in the missing folder targets.');
    }

    console.log('\nDone.');
}

main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
