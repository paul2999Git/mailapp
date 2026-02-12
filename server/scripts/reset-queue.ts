
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@mailhub/shared';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function resetQueue() {
    const queue = new Queue(QUEUE_NAMES.CLASSIFICATION, { connection });
    console.log('Clearing failed jobs...');
    await queue.clean(0, 1000, 'failed');
    console.log('Queue cleared.');
    await connection.quit();
}

resetQueue().catch(console.error);
