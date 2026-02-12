const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMetadata() {
    try {
        const userId = "74db6a3f-a61e-4f44-bad5-9f62607138bc"; // From previous log

        console.log('--- MESSAGE COUNTS ---');
        const totalMessages = await prisma.message.count();
        const unreadMessages = await prisma.message.count({ where: { isRead: false } });
        const inboxMessages = await prisma.message.count({
            where: {
                aiCategory: null,
                currentFolder: { folderType: 'inbox' },
                isHidden: false,
                neverShow: false
            }
        });
        const inboxMessagesUpper = await prisma.message.count({
            where: {
                aiCategory: null,
                currentFolder: { folderType: 'INBOX' },
                isHidden: false,
                neverShow: false
            }
        });

        console.log(`Total: ${totalMessages}`);
        console.log(`Unread: ${unreadMessages}`);
        console.log(`Inbox (lowercase): ${inboxMessages}`);
        console.log(`Inbox (uppercase): ${inboxMessagesUpper}`);

        console.log('\n--- THREAD COUNTS ---');
        const totalThreads = await prisma.thread.count();
        const threadsWithInboxMessages = await prisma.thread.count({
            where: {
                messages: {
                    some: {
                        aiCategory: null,
                        currentFolder: { folderType: 'inbox' },
                        isHidden: false,
                        neverShow: false
                    }
                }
            }
        });

        console.log(`Total Threads: ${totalThreads}`);
        console.log(`Threads with Inbox Messages: ${threadsWithInboxMessages}`);

        if (threadsWithInboxMessages === 0 && inboxMessages > 0) {
            console.log('\n--- DATA ANOMALY DETECTED ---');
            console.log('Messages exist in inbox but threads are not finding them in "some" query.');
            const sampleInboxMessage = await prisma.message.findFirst({
                where: {
                    aiCategory: null,
                    currentFolder: { folderType: 'inbox' }
                },
                select: { id: true, threadId: true, subject: true }
            });
            console.log('Sample Inbox Message:', sampleInboxMessage);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkMetadata();
