import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { decrypt } from '../src/lib/encryption';

const prisma = new PrismaClient();

async function main() {
    const acc = await prisma.account.findFirst({ where: { provider: 'zoho' } });
    if (!acc) {
        console.log('No zoho account found');
        return;
    }

    const accessToken = decrypt(acc.accessTokenEncrypted!);
    const baseUrl = 'https://mail.zoho.com/api/v1';

    // Get account ID
    const accountsRes = await axios.get(`${baseUrl}/accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'text',  // Get raw text
    });
    console.log('=== RAW /accounts response (first 500 chars) ===');
    console.log(accountsRes.data.substring(0, 500));

    const accountsData = JSON.parse(accountsRes.data);
    const zohoAccountId = accountsData.data[0].accountId;
    console.log('\nParsed accountId:', zohoAccountId, typeof zohoAccountId);

    // Get folders to find inbox
    const foldersRes = await axios.get(`${baseUrl}/accounts/${zohoAccountId}/folders`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'text',
    });
    const foldersData = JSON.parse(foldersRes.data);
    const inbox = foldersData.data.find((f: any) => f.folderName?.toLowerCase() === 'inbox');
    console.log('\nInbox folderId:', inbox?.folderId, typeof inbox?.folderId);

    // Get messages list - RAW response
    const messagesRes = await axios.get(
        `${baseUrl}/accounts/${zohoAccountId}/messages/view?folderId=${inbox.folderId}`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            responseType: 'text',
        }
    );
    const rawMessages = messagesRes.data;
    console.log('\n=== RAW /messages/view response (first 1000 chars) ===');
    console.log(rawMessages.substring(0, 1000));

    // Check if messageId appears as number or string in raw JSON
    const msgIdMatch = rawMessages.match(/"messageId"\s*:\s*"?(\d+)"?/);
    if (msgIdMatch) {
        console.log('\nFirst messageId in raw JSON:', msgIdMatch[0]);
        console.log('Is quoted?', msgIdMatch[0].includes('"' + msgIdMatch[1] + '"'));
    }

    // Test the regex
    const testFixed = rawMessages.replace(/:(\s*)(\d{16,})/g, ':$1"$2"');
    const firstMsgMatch = testFixed.match(/"messageId"\s*:\s*"?(\d+)"?/);
    console.log('\nAfter regex fix, first messageId:', firstMsgMatch?.[0]);

    // Parse after fix and check
    const parsedFixed = JSON.parse(testFixed);
    if (parsedFixed.data?.[0]) {
        console.log('\nParsed messageId after fix:', parsedFixed.data[0].messageId, typeof parsedFixed.data[0].messageId);
    }

    // Now test content endpoint with the correct ID
    const parsedRaw = JSON.parse(rawMessages.replace(/:(\s*)(\d{16,})/g, ':$1"$2"'));
    if (parsedRaw.data?.[0]) {
        const correctId = parsedRaw.data[0].messageId;
        console.log('\n=== Testing content endpoint with ID:', correctId, '===');
        try {
            const contentRes = await axios.get(
                `${baseUrl}/accounts/${zohoAccountId}/messages/${correctId}/content`,
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    responseType: 'text',
                }
            );
            console.log('Content response (first 500 chars):');
            console.log(contentRes.data.substring(0, 500));
        } catch (err: any) {
            console.log('Content fetch failed:', err.response?.status, JSON.stringify(err.response?.data));
        }
    }

    await prisma.$disconnect();
}

main();
