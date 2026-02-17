const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function check() {
    console.log('--- DATABASE STATUS ---');
    console.log(process.env.DATABASE_URL ? 'URL exists' : 'URL NOT FOUND');

    try {
        console.log('\n--- RECENT SYNC JOBS ---');
        const jobs = await prisma.syncJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { account: true }
        });

        if (jobs.length === 0) {
            console.log('No sync jobs found.');
        }

        jobs.forEach(j => {
            console.log(`[${j.createdAt.toLocaleString()}] ${j.account.emailAddress} (${j.account.provider})`);
            console.log(`  Status: ${j.status}`);
            if (j.errorMessage) console.log(`  Error: ${j.errorMessage}`);
        });

        console.log('\n--- RULES ACCOUNT CHECK ---');
        const rules = await prisma.learnedRule.findMany({
            take: 20,
            include: { account: true }
        });
        rules.forEach(r => {
            console.log(`Rule: ${r.matchValue} (${r.matchType}) -> Account: ${r.account?.emailAddress || 'NULL'}`);
        });
    } catch (err) {
        console.error('ERROR during check:', err.message);
    } finally {
        await prisma.$disconnect();
    }
}

check();
