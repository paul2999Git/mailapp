
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspectAccounts() {
    const accounts = await prisma.account.findMany();
    console.log(JSON.stringify(accounts.map(a => ({
        provider: a.provider,
        email: a.emailAddress,
        host: a.imapHost,
        port: a.imapPort,
        expiresAt: a.tokenExpiresAt
    })), null, 2));
    process.exit(0);
}

inspectAccounts();
