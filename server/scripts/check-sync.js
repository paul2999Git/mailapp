
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSyncStatus() {
    const accounts = await prisma.account.findMany({
        select: {
            id: true,
            emailAddress: true,
            provider: true,
            lastSyncAt: true,
            syncCursor: true,
            tokenExpiresAt: true
        }
    });

    console.log('--- Account Sync Status ---');
    accounts.forEach(acc => {
        console.log(`- [${acc.provider}] ${acc.emailAddress}:`);
        console.log(`  Last Sync: ${acc.lastSyncAt}`);
        console.log(`  Cursor: ${acc.syncCursor}`);
        console.log(`  Token Expires: ${acc.tokenExpiresAt}`);
    });

    const messageCount = await prisma.message.count();
    console.log(`\nTotal Messages in DB: ${messageCount}`);

    // Check recent errors in logs if any (assuming we had a log table, but we don't)

    process.exit(0);
}

checkSyncStatus();
