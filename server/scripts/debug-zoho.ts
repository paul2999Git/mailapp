import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AccountSyncService } from '../src/services/accountSync.service';

const prisma = new PrismaClient();
const svc = new AccountSyncService();

async function main() {
    // Find the Zoho account
    const acc = await prisma.account.findFirst({ where: { provider: 'zoho' } });
    if (!acc) {
        console.log('No zoho account found');
        return;
    }

    console.log(`Zoho account: ${acc.emailAddress} (id: ${acc.id})`);

    // Check existing messages in DB
    const msgs = await prisma.message.findMany({
        where: { accountId: acc.id },
        select: {
            id: true,
            providerMessageId: true,
            subject: true,
            bodyText: true,
            bodyHtml: true,
            bodyPreview: true,
        },
        orderBy: { dateReceived: 'desc' },
        take: 5,
    });

    console.log(`\n--- ${msgs.length} most recent Zoho messages in DB ---`);
    for (const m of msgs) {
        console.log(`  providerMsgId: ${m.providerMessageId}`);
        console.log(`  subject: ${(m.subject || '').slice(0, 50)}`);
        console.log(`  bodyText: ${m.bodyText ? m.bodyText.length + ' chars' : 'NULL'}`);
        console.log(`  bodyHtml: ${m.bodyHtml ? m.bodyHtml.length + ' chars' : 'NULL'}`);
        console.log(`  bodyPreview: ${m.bodyPreview ? m.bodyPreview.length + ' chars' : 'NULL'}`);
        console.log('');
    }

    // Now test the Zoho API directly
    console.log('--- Testing Zoho API directly ---');
    const adapter = await svc.getAdapterForAccount(acc.id);

    // Use fetchMessage on the first message to see what we get
    if (msgs.length > 0) {
        const testMsgId = msgs[0].providerMessageId;
        console.log(`\nFetching message content for providerMessageId: ${testMsgId}`);
        try {
            const fetched = await adapter.fetchMessage(testMsgId);
            if (fetched) {
                console.log('  bodyText:', fetched.bodyText ? fetched.bodyText.length + ' chars' : 'NULL');
                console.log('  bodyHtml:', fetched.bodyHtml ? fetched.bodyHtml.length + ' chars' : 'NULL');
                console.log('  bodyPreview:', fetched.bodyPreview ? fetched.bodyPreview.length + ' chars' : 'NULL');
                if (fetched.bodyHtml) {
                    console.log('  bodyHtml preview:', fetched.bodyHtml.substring(0, 200));
                }
                if (fetched.bodyText) {
                    console.log('  bodyText preview:', fetched.bodyText.substring(0, 200));
                }
            } else {
                console.log('  fetchMessage returned null');
            }
        } catch (err) {
            console.error('  fetchMessage error:', err);
        }
    }

    // Also test the raw API response
    console.log('\n--- Testing raw Zoho API content endpoint ---');
    try {
        const axios = require('axios');
        const { decrypt } = require('../src/lib/encryption');
        const accessToken = decrypt(acc.accessTokenEncrypted!);

        const baseUrl = 'https://mail.zoho.com/api/v1';
        const accountsRes = await axios.get(`${baseUrl}/accounts`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const zohoAccountId = accountsRes.data.data[0].accountId;
        console.log('Zoho account ID:', zohoAccountId);

        if (msgs.length > 0) {
            const testMsgId = msgs[0].providerMessageId;

            // Test the content endpoint
            console.log(`\nGET /accounts/${zohoAccountId}/messages/${testMsgId}/content`);
            const contentRes = await axios.get(
                `${baseUrl}/accounts/${zohoAccountId}/messages/${testMsgId}/content`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            console.log('Content response status:', contentRes.status);
            console.log('Content response keys:', Object.keys(contentRes.data));
            if (contentRes.data.data) {
                console.log('data keys:', Object.keys(contentRes.data.data));
                console.log('data.content exists:', !!contentRes.data.data.content);
                if (contentRes.data.data.content) {
                    console.log('data.content length:', contentRes.data.data.content.length);
                    console.log('data.content preview:', contentRes.data.data.content.substring(0, 300));
                }
            }
            console.log('\nFull response.data (first 500 chars):', JSON.stringify(contentRes.data).substring(0, 500));
        }
    } catch (err: any) {
        console.error('Raw API error:', err.response?.status, err.response?.data || err.message);
    }

    await adapter.disconnect();
    await prisma.$disconnect();
}

main();
