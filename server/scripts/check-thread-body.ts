import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Get the 3 most recent threads
    const threads = await prisma.thread.findMany({
        orderBy: { lastMessageDate: 'desc' },
        take: 3,
        include: {
            messages: {
                orderBy: { dateReceived: 'asc' },
                include: {
                    account: {
                        select: { emailAddress: true, provider: true },
                    },
                },
            },
        },
    });

    for (const t of threads) {
        console.log(`\nThread: "${t.subjectNormalized}" (${t.messages.length} messages)`);
        for (const m of t.messages) {
            console.log(`  [${m.account.provider}] ${m.fromAddress?.slice(0, 30).padEnd(30)} | bodyHtml: ${m.bodyHtml ? m.bodyHtml.length + ' chars' : 'NULL'} | bodyText: ${m.bodyText ? m.bodyText.length + ' chars' : 'NULL'}`);
        }
    }

    // Also check: are there threads where ALL messages have null body?
    const allThreads = await prisma.thread.findMany({
        include: {
            messages: {
                select: { id: true, bodyHtml: true, bodyText: true },
            },
        },
    });

    const emptyBodyThreads = allThreads.filter(t =>
        t.messages.length > 0 && t.messages.every(m => !m.bodyHtml && !m.bodyText)
    );

    console.log(`\nThreads with ALL messages missing body: ${emptyBodyThreads.length} / ${allThreads.length}`);
    for (const t of emptyBodyThreads) {
        console.log(`  "${t.subjectNormalized}" (${t.messages.length} messages)`);
    }

    await prisma.$disconnect();
}

main();
