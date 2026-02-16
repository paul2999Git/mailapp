import { app } from './app';
import { prisma } from './lib/db';
import { redis } from './lib/redis';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
    // Test database connection
    try {
        await prisma.$connect();
        console.log('✅ Database connected');
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }

    // Test Redis connection
    try {
        await redis.ping();
        console.log('✅ Redis connected');
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
        process.exit(1);
    }

    // Start server
	app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
});

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
