import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AccountSyncService } from '../src/services/accountSync.service';

const prisma = new PrismaClient();
const svc = new AccountSyncService();

async function main() {
    const acc = await prisma.account.findFirst({ where: { provider: 'zoho' } });
    if (!acc) {
        console.log('No zoho account found');
        return;
    }

    console.log(`Zoho account: ${acc.emailAddress}`);
    console.log('Starting sync...\n');

    try {
        const result = await svc.syncAccount(acc.id);
        console.log('\nSync result:', result);

        // Check body content of synced messages
        const msgs = await prisma.message.findMany({
            where: { accountId: acc.id },
            select: {
                providerMessageId: true,
                subject: true,
                bodyText: true,
                bodyHtml: true,
                bodyPreview: true,
            },
            orderBy: { dateReceived: 'desc' },
            take: 5,
        });

        console.log(`\n--- ${msgs.length} most recent Zoho messages ---`);
        for (const m of msgs) {
            console.log(`  ID: ${m.providerMessageId}`);
            console.log(`  subject: ${(m.subject || '').slice(0, 50)}`);
            console.log(`  bodyText: ${m.bodyText ? m.bodyText.length + ' chars' : 'NULL'}`);
            console.log(`  bodyHtml: ${m.bodyHtml ? m.bodyHtml.length + ' chars' : 'NULL'}`);
            console.log(`  bodyPreview: ${m.bodyPreview ? m.bodyPreview.length + ' chars' : 'NULL'}`);
            console.log('');
        }
    } catch (err) {
        console.error('Sync failed:', err);
    }

    await prisma.$disconnect();
}

main();
