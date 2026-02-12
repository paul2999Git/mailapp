/**
 * Run a sync for the Proton account.
 * Run with: npx tsx server/scripts/run-proton-sync.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AccountSyncService } from '../src/services/accountSync.service';

const prisma = new PrismaClient();
const svc = new AccountSyncService();

async function main() {
    const acc = await prisma.account.findFirst({ where: { provider: 'proton' } });
    if (!acc) {
        console.log('No proton account found');
        return;
    }

    console.log(`Account: ${acc.emailAddress}`);
    console.log(`Current cursor: ${acc.syncCursor}`);
    console.log(`Last sync: ${acc.lastSyncAt}`);
    console.log('Starting sync...\n');

    try {
        const result = await svc.syncAccount(acc.id);
        console.log('\nSync result:', result);

        const updated = await prisma.account.findUnique({ where: { id: acc.id }, select: { syncCursor: true, lastSyncAt: true } });
        console.log('New cursor:', updated?.syncCursor);
        console.log('Last sync:', updated?.lastSyncAt);

        const localCount = await prisma.message.count({ where: { accountId: acc.id } });
        console.log('Total local messages:', localCount);
    } catch (err) {
        console.error('Sync failed:', err);
    }

    await prisma.$disconnect();
}

main();
