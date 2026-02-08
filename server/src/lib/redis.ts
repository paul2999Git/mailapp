import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

redis.on('error', (error) => {
    console.error('Redis connection error:', error);
});

redis.on('connect', () => {
    console.log('Redis client connected');
});
