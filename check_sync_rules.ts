import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    console.log('--- RECENT SYNC JOBS ---');
    const jobs = await prisma.syncJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { account: true }
    });
    jobs.forEach(j => {
        console.log(`[${j.createdAt.toISOString()}] Account: ${j.account.emailAddress} (${j.account.provider})`);
        console.log(`  Status: ${j.status}`);
        if (j.errorMessage) console.log(`  Error: ${j.errorMessage}`);
    });

    console.log('\n--- RULES ACCOUNT CHECK ---');
    const rules = await prisma.learnedRule.findMany({
        take: 10,
        include: { account: true }
    });
    rules.forEach(r => {
        console.log(`Rule: ${r.matchValue} (${r.matchType}) -> Account: ${r.account?.emailAddress || 'NULL'}`);
    });

    await prisma.$disconnect();
}

check();
