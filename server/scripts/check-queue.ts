
import Redis from 'ioredis';
import { Queue, Job } from 'bullmq';
import { QUEUE_NAMES } from '@mailhub/shared';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function checkQueue() {
    const queue = new Queue(QUEUE_NAMES.CLASSIFICATION, { connection });

    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    console.log('--- Classification Queue Counts ---');
    console.log(JSON.stringify(counts, null, 2));

    const failedJobs = await queue.getFailed(0, 5);
    if (failedJobs.length > 0) {
        console.log('\n--- Recent Failed Jobs Details ---');
        for (const job of failedJobs) {
            console.log(`Job ID: ${job.id}`);
            console.log(`Failed Reason: ${job.failedReason}`);
            console.log(`Stack Trace: \n${job.stacktrace?.join('\n') || 'No stack trace'}`);
            console.log('-----------------------------------');
        }
    }

    await connection.quit();
}

checkQueue().catch(console.error);
