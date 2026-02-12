
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@mailhub/shared';

// Use same env as app
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function debugFailures() {
    console.log('Connecting to Redis:', redisUrl);
    const queue = new Queue(QUEUE_NAMES.CLASSIFICATION, { connection });

    try {
        const failedCount = await queue.getJobCounts('failed');
        console.log('Total failed jobs:', failedCount.failed);

        const failedJobs = await queue.getFailed(0, 20);
        console.log(`Analyzing last ${failedJobs.length} failures:`);

        const errorSummary: Record<string, number> = {};

        for (const job of failedJobs) {
            const reason = job.failedReason || 'Unknown error';
            errorSummary[reason] = (errorSummary[reason] || 0) + 1;

            if (Object.keys(errorSummary).length < 5) {
                console.log(`\nJob ${job.id} failed with: ${reason}`);
                if (job.stacktrace && job.stacktrace.length > 0) {
                    console.log('Stack snippet:', job.stacktrace[0].split('\n').slice(0, 3).join('\n'));
                }
            }
        }

        console.log('\n--- Error Summary ---');
        Object.entries(errorSummary).forEach(([error, count]) => {
            console.log(`${count}x: ${error}`);
        });

    } catch (err) {
        console.error('Debug script error:', err);
    } finally {
        await connection.quit();
    }
}

debugFailures();
