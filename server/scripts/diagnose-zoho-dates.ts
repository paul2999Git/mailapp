
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function diagnoseZohoDates() {
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
            const m = messagesRes.data[0];
            console.log('--- Sample Message Dates ---');
            console.log(`sentDateInGMT: ${m.sentDateInGMT}`);
            console.log(`receivedTime: ${m.receivedTime}`);
            console.log(`sentDateInGMT parsed: ${new Date(m.sentDateInGMT).toString()}`);
            console.log(`receivedTime parsed: ${new Date(Number(m.receivedTime)).toString()}`);
        }

        await adapter.disconnect();
    } catch (error) {
        console.error('DIAGNOSTIC FAILED:', error);
    } finally {
        process.exit(0);
    }
}

diagnoseZohoDates();
