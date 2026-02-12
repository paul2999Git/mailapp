import { Queue } from 'bullmq';
import { redis } from './redis';
import { QUEUE_NAMES } from '@mailhub/shared';

// Create the classification queue
export const classificationQueue = new Queue(QUEUE_NAMES.CLASSIFICATION, {
    connection: redis
});

// Create the sync queue (in case the server needs to trigger syncs)
export const syncQueue = new Queue(QUEUE_NAMES.EMAIL_SYNC, {
    connection: redis
});
