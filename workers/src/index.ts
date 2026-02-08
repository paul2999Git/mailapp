import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: path.join(process.cwd(), '..', envFile) });
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '@mailhub/shared';
import { processSyncJob } from './processors/sync';
import { processClassificationJob } from './processors/classification';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

console.log('🔧 Starting MailHub workers...');

// Email Sync Worker
const syncWorker = new Worker(
    QUEUE_NAMES.EMAIL_SYNC,
    processSyncJob,
    {
        connection,
        concurrency: 2,
        limiter: {
            max: 10,
            duration: 60000,
        },
    }
);

syncWorker.on('completed', (job) => {
    console.log(`✅ Sync job ${job.id} completed`);
});

syncWorker.on('failed', (job, err) => {
    console.error(`❌ Sync job ${job?.id} failed:`, err.message);
});

// Classification Worker
const classificationWorker = new Worker(
    QUEUE_NAMES.CLASSIFICATION,
    processClassificationJob,
    {
        connection,
        concurrency: 5,
    }
);

classificationWorker.on('completed', (job) => {
    console.log(`✅ Classification job ${job.id} completed`);
});

classificationWorker.on('failed', (job, err) => {
    console.error(`❌ Classification job ${job?.id} failed:`, err.message);
});

// Queues for scheduling
export const syncQueue = new Queue(QUEUE_NAMES.EMAIL_SYNC, { connection });
export const classificationQueue = new Queue(QUEUE_NAMES.CLASSIFICATION, { connection });

// Schedule recurring sync jobs (every hour)
async function setupRecurringJobs() {
    await syncQueue.add(
        'hourly-sync',
        { type: 'all-accounts' },
        {
            repeat: {
                every: 60 * 60 * 1000, // 1 hour
            },
            removeOnComplete: 100,
            removeOnFail: 50,
        }
    );
    console.log('📅 Scheduled hourly sync job');
}

setupRecurringJobs().catch(console.error);

// Graceful shutdown
const shutdown = async () => {
    console.log('Shutting down workers...');
    await syncWorker.close();
    await classificationWorker.close();
    await connection.quit();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('✅ Workers started successfully');
