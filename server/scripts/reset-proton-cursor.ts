/**
 * Reset the sync cursor for Proton accounts so they re-sync from scratch.
 * Run with: npx tsx server/scripts/reset-proton-cursor.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const result = await prisma.account.updateMany({
        where: { provider: 'proton' },
        data: { syncCursor: null },
    });

    console.log(`Reset sync cursor for ${result.count} Proton account(s).`);
    console.log('Next sync will re-fetch all messages within the 14-day window.');

    await prisma.$disconnect();
}

main().catch(console.error);
