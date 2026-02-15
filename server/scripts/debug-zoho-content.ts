import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { decrypt } from '../src/lib/encryption';

const prisma = new PrismaClient();

async function main() {
    const acc = await prisma.account.findFirst({ where: { provider: 'zoho' } });
    if (!acc) return;

    const accessToken = decrypt(acc.accessTokenEncrypted!);
    const baseUrl = 'https://mail.zoho.com/api/v1';

    const accountsData = (await axios.get(`${baseUrl}/accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })).data;
    const zohoAccountId = accountsData.data[0].accountId;

    // Get the first message ID from list
    const foldersData = (await axios.get(`${baseUrl}/accounts/${zohoAccountId}/folders`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })).data;
    const inbox = foldersData.data.find((f: any) => f.folderName?.toLowerCase() === 'inbox');

    const listData = (await axios.get(
        `${baseUrl}/accounts/${zohoAccountId}/messages/view?folderId=${inbox.folderId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    )).data;
    const msgId = listData.data[0].messageId;
    const folderId = listData.data[0].folderId;
    console.log('Test message ID:', msgId);
    console.log('Folder ID:', folderId);

    // Try different endpoint patterns
    const endpoints = [
        `/accounts/${zohoAccountId}/messages/${msgId}`,
        `/accounts/${zohoAccountId}/messages/${msgId}/content`,
        `/accounts/${zohoAccountId}/folders/${folderId}/messages/${msgId}`,
        `/accounts/${zohoAccountId}/folders/${folderId}/messages/${msgId}/content`,
    ];

    for (const ep of endpoints) {
        console.log(`\n--- GET ${ep} ---`);
        try {
            const res = await axios.get(`${baseUrl}${ep}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                responseType: 'text',
            });
            const raw = res.data;
            console.log('Status: 200');
            console.log('Response (first 500 chars):', raw.substring(0, 500));

            // Check for content/body fields
            const parsed = JSON.parse(raw);
            if (parsed.data) {
                const d = parsed.data;
                const keys = Object.keys(d);
                console.log('Data keys:', keys);
                if (d.content) console.log('HAS content field:', d.content.length, 'chars');
                if (d.htmlContent) console.log('HAS htmlContent field:', d.htmlContent.length, 'chars');
                if (d.textContent) console.log('HAS textContent field:', d.textContent.length, 'chars');
            }
        } catch (err: any) {
            console.log('Status:', err.response?.status);
            console.log('Error:', JSON.stringify(err.response?.data));
        }
    }

    await prisma.$disconnect();
}

main();
