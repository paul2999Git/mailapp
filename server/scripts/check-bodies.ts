import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Check all providers
    const msgs = await prisma.message.findMany({
        select: {
            id: true,
            subject: true,
            bodyText: true,
            bodyHtml: true,
            account: { select: { provider: true, emailAddress: true } },
        },
        orderBy: { dateReceived: 'desc' },
        take: 10,
    });

    for (const m of msgs) {
        console.log(
            `[${m.account.provider}] ${m.account.emailAddress}`,
            `| ${(m.subject || '(no subject)').slice(0, 40).padEnd(40)}`,
            `| text: ${m.bodyText ? String(m.bodyText.length).padStart(5) + ' chars' : '  NULL'}`,
            `| html: ${m.bodyHtml ? String(m.bodyHtml.length).padStart(5) + ' chars' : '  NULL'}`,
        );
    }

    // Summary counts
    const total = await prisma.message.count();
    const noBody = await prisma.message.count({
        where: { bodyText: null, bodyHtml: null },
    });
    console.log(`\nTotal messages: ${total}, Missing both bodyText and bodyHtml: ${noBody}`);

    await prisma.$disconnect();
}

main();
