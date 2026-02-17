/**
 * Backfill script: Assign accountId to LearnedRules that are missing it.
 * 
 * Strategy: For each rule without an accountId, find a Message whose fromAddress
 * matches the rule's matchValue (sender_email) or whose fromAddress domain matches
 * (sender_domain). Use that message's accountId to fill in the rule.
 * 
 * Usage: node backfill_rule_accounts.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const rules = await prisma.learnedRule.findMany({
        where: { accountId: null },
    });

    console.log(`Found ${rules.length} rules without an accountId.`);

    let updated = 0;
    for (const rule of rules) {
        let message;

        if (rule.matchType === 'sender_email') {
            // Find a message from this exact sender
            message = await prisma.message.findFirst({
                where: {
                    fromAddress: { equals: rule.matchValue, mode: 'insensitive' },
                    accountId: { not: null },
                },
                select: { accountId: true },
                orderBy: { receivedAt: 'desc' },
            });
        } else if (rule.matchType === 'sender_domain') {
            // Find a message from this domain
            message = await prisma.message.findFirst({
                where: {
                    fromAddress: { endsWith: `@${rule.matchValue}`, mode: 'insensitive' },
                    accountId: { not: null },
                },
                select: { accountId: true },
                orderBy: { receivedAt: 'desc' },
            });
        }

        if (message?.accountId) {
            await prisma.learnedRule.update({
                where: { id: rule.id },
                data: { accountId: message.accountId },
            });
            console.log(`  ✅ Rule "${rule.matchValue}" (${rule.matchType}) → account ${message.accountId}`);
            updated++;
        } else {
            console.log(`  ⚠️  Rule "${rule.matchValue}" (${rule.matchType}) → no matching message found`);
        }
    }

    console.log(`\nDone. Updated ${updated} of ${rules.length} rules.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
