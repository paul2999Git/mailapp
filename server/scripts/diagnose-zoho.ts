
import { PrismaClient } from '@prisma/client';
import { accountSyncService } from '../src/services/accountSync.service';
const prisma = new PrismaClient();

async function diagnoseZoho() {
    try {
        const zoho = await prisma.account.findFirst({
            where: { provider: 'zoho' }
        });

        if (!zoho) {
            console.log('No Zoho account found');
            return;
        }

        console.log('--- Database Check ---');
        const dbMessages = await prisma.message.findMany({
            where: { accountId: zoho.id },
            select: { id: true, subject: true, dateReceived: true },
            orderBy: { dateReceived: 'desc' }
        });
        console.log(`Total messages in DB for Zoho: ${dbMessages.length}`);
        dbMessages.slice(0, 5).forEach(m => console.log(`- [${m.dateReceived}] ${m.subject}`));

        console.log('\n--- API Check ---');
        const adapter = await accountSyncService.getAdapterForAccount(zoho.id);
        const accountsRes = await (adapter as any).apiRequest('GET', '/accounts');
        const zohoAccountId = accountsRes.data[0].accountId;
        console.log(`Zoho Account ID from API: ${zohoAccountId} (${accountsRes.data[0].mailboxAddress})`);

        const folders = await adapter.fetchFolders();
        const inbox = folders.find(f => f.name.toLowerCase() === 'inbox');
        console.log(`Inbox ID: ${inbox?.providerFolderId}, Total Count in API: ${inbox?.messageCount}`);

        const messagesRes = await (adapter as any).apiRequest('GET', `/accounts/${zohoAccountId}/messages/view?folderId=${inbox?.providerFolderId}`);
        // Zoho response structure check
        const rawData = messagesRes.data;
        console.log(`API Raw Data Length: ${Array.isArray(rawData) ? rawData.length : 'NOT AN ARRAY'}`);

        if (Array.isArray(rawData)) {
            rawData.slice(0, 5).forEach((m: any) => console.log(`- [${m.receivedTime}] ${m.subject} (ID: ${m.messageId})`));
        } else {
            console.log('Raw Data sample:', JSON.stringify(rawData).slice(0, 200));
        }

        await adapter.disconnect();
    } catch (error) {
        console.error('DIAGNOSTIC FAILED:', error);
    } finally {
        process.exit(0);
    }
}

diagnoseZoho();
