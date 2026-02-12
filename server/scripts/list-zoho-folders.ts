
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function listZohoFolders() {
    try {
        const zohoAccount = await prisma.account.findFirst({
            where: { provider: 'zoho' }
        });

        if (!zohoAccount) {
            console.error('No zoho account found');
            process.exit(1);
        }

        const adapter = await accountSyncService.getAdapterForAccount(zohoAccount.id);
        const folders = await adapter.fetchFolders();
        console.log('--- Zoho Folders ---');
        console.log(JSON.stringify(folders, null, 2));
        await adapter.disconnect();
    } catch (error) {
        console.error('FAILED TO FETCH FOLDERS:');
        console.error(error);
    } finally {
        process.exit(0);
    }
}

listZohoFolders();
