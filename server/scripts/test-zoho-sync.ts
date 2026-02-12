
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function testZohoSync() {
    try {
        const zohoAccount = await prisma.account.findFirst({
            where: { provider: 'zoho' }
        });

        if (!zohoAccount) {
            console.error('No zoho account found');
            process.exit(1);
        }

        console.log(`Starting manual sync for ${zohoAccount.emailAddress}...`);
        // Force refresh
        await accountSyncService.refreshTokensIfNeeded(zohoAccount.id, true);

        const result = await accountSyncService.syncAccount(zohoAccount.id);
        console.log('✅ Sync Success:', result);
    } catch (error) {
        console.error('❌ Sync Failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    } finally {
        process.exit(0);
    }
}

testZohoSync();
