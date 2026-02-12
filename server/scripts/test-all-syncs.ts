
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function testAllSyncs() {
    const accounts = await prisma.account.findMany();

    for (const account of accounts) {
        console.log(`\n--- Testing Sync for ${account.provider}: ${account.emailAddress} ---`);
        try {
            const result = await accountSyncService.syncAccount(account.id);
            console.log('✅ Sync Success:', result);
        } catch (error) {
            console.error('❌ Sync Failed:', error.message);
            if (error.stack && error.message.includes('not a function')) {
                console.error(error.stack);
            }
        }
    }
    process.exit(0);
}

testAllSyncs();
