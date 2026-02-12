import { prisma } from '../src/lib/db';
import { updateThreadStats } from '../src/services/threadHelper';

async function cleanup() {
    console.log('🧹 Starting thread and participant cleanup...');

    // 1. Find all threads
    const threads = await prisma.thread.findMany({
        select: { id: true }
    });

    console.log(`🧵 Found ${threads.length} threads to process.`);

    for (const thread of threads) {
        try {
            await updateThreadStats(thread.id);
        } catch (error) {
            console.error(`❌ Failed to update thread ${thread.id}:`, error);
        }
    }

    console.log('✅ Cleanup complete!');
    process.exit(0);
}

cleanup();
