
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function testTargetedSyncs() {
    const accounts = await prisma.account.findMany({
        where: {
            provider: { in: ['hover', 'zoho'] }
        }
    });

    for (const account of accounts) {
        console.log(`\n--- Testing Sync for ${account.provider}: ${account.emailAddress} ---`);
        try {
            const result = await accountSyncService.syncAccount(account.id);
            console.log('✅ Sync Success:', result);
        } catch (error: any) {
            console.error('❌ Sync Failed:', error.message);
            if (error.response) {
                console.error('Data:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }
    process.exit(0);
}

testTargetedSyncs();
