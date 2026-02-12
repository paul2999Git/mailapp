const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkThreads() {
    try {
        const threadCount = await prisma.thread.count();
        const messageCount = await prisma.message.count();
        console.log(`Total Threads: ${threadCount}`);
        console.log(`Total Messages: ${messageCount}`);

        const sampleThreads = await prisma.thread.findMany({
            take: 5,
            include: {
                _count: {
                    select: { messages: true }
                }
            }
        });

        console.log('Sample Threads:', JSON.stringify(sampleThreads, null, 2));

        const inboxThreads = await prisma.thread.findMany({
            where: {
                messages: {
                    some: {
                        aiCategory: null,
                        currentFolder: { folderType: 'inbox' }
                    }
                }
            },
            take: 5
        });

        console.log('Inbox Threads:', JSON.stringify(inboxThreads, null, 2));

    } catch (error) {
        console.error('Error checking threads:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkThreads();
