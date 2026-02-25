/**
 * Export categories and rules from dev DB to a portable JSON file.
 *
 * Usage (from server/ directory):
 *   npx tsx src/scripts/export-dev-data.ts <user-email> > migration-export.json
 *
 * Example:
 *   npx tsx src/scripts/export-dev-data.ts you@example.com > migration-export.json
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const userEmail = process.argv[2];
    if (!userEmail) {
        console.error('Usage: npx tsx src/scripts/export-dev-data.ts <user-email>');
        process.exit(1);
    }

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
        console.error(`User not found: ${userEmail}`);
        process.exit(1);
    }

    // Export user-created (non-system) categories
    const categories = await prisma.category.findMany({
        where: { userId: user.id, isSystem: false },
        include: { parent: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
    });

    const exportedCategories = categories.map(cat => ({
        name: cat.name,
        parentName: cat.parent?.name ?? null,
        description: cat.description,
        color: cat.color,
        icon: cat.icon,
        priority: cat.priority,
    }));

    // Export learned rules with resolved names instead of IDs
    const rules = await prisma.learnedRule.findMany({
        where: { userId: user.id },
        include: {
            targetCategory: { select: { name: true } },
            targetFolder: {
                select: {
                    name: true,
                    fullPath: true,
                    account: { select: { emailAddress: true } },
                },
            },
            account: { select: { emailAddress: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    const exportedRules = rules.map(rule => ({
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        action: rule.action,
        priority: rule.priority,
        confidenceBoost: rule.confidenceBoost.toString(),
        targetCategoryName: rule.targetCategory?.name ?? null,
        targetFolderPath: rule.targetFolder?.fullPath ?? rule.targetFolder?.name ?? null,
        targetFolderAccountEmail: rule.targetFolder?.account?.emailAddress ?? null,
        accountEmail: rule.account?.emailAddress ?? null,
    }));

    const output = {
        exportedAt: new Date().toISOString(),
        userEmail: user.email,
        categories: exportedCategories,
        rules: exportedRules,
    };

    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    console.error(`Exported ${exportedCategories.length} categories and ${exportedRules.length} rules for ${user.email}`);
}

main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
