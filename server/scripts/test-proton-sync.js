
const { PrismaClient } = require('@prisma/client');
const { accountSyncService } = require('./dist/services/accountSync.service');
const prisma = new PrismaClient();

async function testProtonSync() {
    try {
        const protonAccount = await prisma.account.findFirst({
            where: { provider: 'proton' }
        });

        if (!protonAccount) {
            console.error('No proton account found');
            process.exit(1);
        }

        console.log(`Starting manual sync for ${protonAccount.emailAddress}...`);
        const result = await accountSyncService.syncAccount(protonAccount.id);
        console.log('Sync result:', result);
    } catch (error) {
        console.error('CRASH DURING SYNC:');
        console.error(error);
    } finally {
        process.exit(0);
    }
}

testProtonSync();
