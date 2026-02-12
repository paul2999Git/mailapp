/**
 * Debug script: Check Proton Bridge INBOX vs other folders
 * Run with: npx tsx server/scripts/debug-proton-inbox.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ImapFlow } from 'imapflow';

const prisma = new PrismaClient();

async function main() {
    // Find all proton accounts
    const accounts = await prisma.account.findMany({
        where: { provider: 'proton' },
        select: {
            id: true,
            emailAddress: true,
            imapHost: true,
            imapPort: true,
            imapUsername: true,
            imapPasswordEncrypted: true,
            syncCursor: true,
            lastSyncAt: true,
        },
    });

    if (accounts.length === 0) {
        console.log('No Proton accounts found.');
        return;
    }

    for (const acc of accounts) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Account: ${acc.emailAddress}`);
        console.log(`Current sync cursor: ${acc.syncCursor}`);
        console.log(`Last sync: ${acc.lastSyncAt}`);
        console.log(`${'='.repeat(60)}`);

        // Decrypt password
        const { decrypt } = await import('../src/lib/encryption.js');
        if (!acc.imapPasswordEncrypted) {
            console.log('  No IMAP password - skipping');
            continue;
        }
        const password = decrypt(acc.imapPasswordEncrypted);

        const client = new ImapFlow({
            host: acc.imapHost || '127.0.0.1',
            port: acc.imapPort === 993 ? 1143 : (acc.imapPort || 1143),
            secure: false,
            tls: { rejectUnauthorized: false },
            auth: {
                user: acc.imapUsername || acc.emailAddress,
                pass: password,
            },
            logger: false,
        });

        try {
            await client.connect();
            console.log('  Connected to Proton Bridge');

            // List all folders and their message counts
            const mailboxes = await client.list();
            console.log(`\n  Folders found: ${mailboxes.length}`);

            for (const mb of mailboxes) {
                const status = await client.status(mb.path, { messages: true, unseen: true, uidNext: true, uidValidity: true });
                console.log(`  📁 ${mb.path.padEnd(25)} | msgs: ${String(status.messages).padStart(4)} | unseen: ${String(status.unseen).padStart(4)} | uidNext: ${status.uidNext} | uidValidity: ${status.uidValidity}`);
            }

            // Check INBOX specifically
            const inboxStatus = await client.status('INBOX', { messages: true, unseen: true, uidNext: true, uidValidity: true });
            console.log(`\n  INBOX Details:`);
            console.log(`    Messages: ${inboxStatus.messages}`);
            console.log(`    Unseen:   ${inboxStatus.unseen}`);
            console.log(`    UIDNext:  ${inboxStatus.uidNext}`);
            console.log(`    UIDValidity: ${inboxStatus.uidValidity}`);

            // Check cursor vs UIDNext
            const cursor = acc.syncCursor ? parseInt(acc.syncCursor, 10) : 0;
            if (cursor > 0 && inboxStatus.uidNext) {
                const gap = inboxStatus.uidNext - cursor;
                if (gap > 0) {
                    console.log(`\n  ⚠️  CURSOR GAP DETECTED: cursor=${cursor}, uidNext=${inboxStatus.uidNext}, gap=${gap} messages may be unfetched`);
                } else if (gap === 0) {
                    console.log(`\n  ✅ Cursor is up to date with INBOX`);
                } else {
                    console.log(`\n  ❌ CURSOR AHEAD OF UIDNEXT: cursor=${cursor} > uidNext=${inboxStatus.uidNext}`);
                    console.log(`     This means UIDVALIDITY likely changed! All previous UIDs are invalid.`);
                }
            }

            // Fetch the 5 most recent messages in INBOX to see what's there
            const lock = await client.getMailboxLock('INBOX');
            try {
                console.log(`\n  Last 5 messages in INBOX:`);
                let count = 0;
                for await (const msg of client.fetch({ seq: `${Math.max(1, inboxStatus.messages - 4)}:*` }, {
                    uid: true,
                    flags: true,
                    envelope: true,
                })) {
                    const from = msg.envelope?.from?.[0];
                    console.log(`    UID ${String(msg.uid).padStart(6)} | ${msg.envelope?.date?.toISOString().slice(0, 16)} | ${(from?.address || '?').padEnd(30)} | ${msg.envelope?.subject?.slice(0, 50)}`);
                    count++;
                }
                if (count === 0) console.log('    (empty)');
            } finally {
                lock.release();
            }

            // Check local DB message count
            const localCount = await prisma.message.count({ where: { accountId: acc.id } });
            console.log(`\n  Local DB messages: ${localCount}`);
            console.log(`  IMAP INBOX messages: ${inboxStatus.messages}`);

            await client.logout();
        } catch (err: any) {
            console.error(`  ❌ Connection failed: ${err.message}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
