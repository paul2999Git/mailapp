import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const acc = await prisma.account.findFirst({ where: { provider: 'zoho' } });
    if (!acc) {
        console.log('No zoho account found');
        return;
    }

    console.log(`Zoho account: ${acc.emailAddress}`);

    // Count existing messages
    const count = await prisma.message.count({ where: { accountId: acc.id } });
    console.log(`Existing messages with corrupted IDs: ${count}`);

    // Delete all Zoho messages (they have corrupted providerMessageIds)
    const deleted = await prisma.message.deleteMany({ where: { accountId: acc.id } });
    console.log(`Deleted ${deleted.count} messages`);

    // Clean up orphaned threads
    const orphanedThreads = await prisma.thread.findMany({
        where: {
            userId: acc.userId,
            messages: { none: {} },
        },
        select: { id: true },
    });

    if (orphanedThreads.length > 0) {
        await prisma.thread.deleteMany({
            where: { id: { in: orphanedThreads.map(t => t.id) } },
        });
        console.log(`Cleaned up ${orphanedThreads.length} orphaned threads`);
    }

    // Reset sync cursor
    await prisma.account.update({
        where: { id: acc.id },
        data: { syncCursor: null },
    });
    console.log('Reset sync cursor');

    console.log('\nDone. Run a sync to re-fetch messages with correct IDs.');
    await prisma.$disconnect();
}

main();
