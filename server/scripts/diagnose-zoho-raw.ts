
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function diagnoseZohoKeys() {
    try {
        const zoho = await prisma.account.findFirst({
            where: { provider: 'zoho' }
        });

        const adapter = await accountSyncService.getAdapterForAccount(zoho!.id);
        const accountsRes = await (adapter as any).apiRequest('GET', '/accounts');
        const zohoAccountId = accountsRes.data[0].accountId;

        const folders = await adapter.fetchFolders();
        const inbox = folders.find(f => f.name.toLowerCase() === 'inbox');

        const messagesRes = await (adapter as any).apiRequest('GET', `/accounts/${zohoAccountId}/messages/view?folderId=${inbox?.providerFolderId}`);

        if (messagesRes.data && messagesRes.data.length > 0) {
            console.log('--- Raw Message Keys ---');
            console.log(Object.keys(messagesRes.data[0]));
            console.log('Sample data for key fields:');
            const m = messagesRes.data[0];
            ['sentTime', 'receivedTime', 'date', 'time'].forEach(k => console.log(`${k}: ${m[k]}`));
        }

        await adapter.disconnect();
    } catch (error) {
        console.error('DIAGNOSTIC FAILED:', error);
    } finally {
        process.exit(0);
    }
}

diagnoseZohoKeys();
