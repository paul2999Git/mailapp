
const { ImapFlow } = require('imapflow');
const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('./dist/lib/encryption');

async function testHoverDirect() {
    const prisma = new PrismaClient();
    const account = await prisma.account.findFirst({ where: { provider: 'hover' } });

    if (!account) {
        console.error('No Hover account found');
        process.exit(1);
    }

    console.log(`Testing Hover IMAP for ${account.emailAddress}...`);
    console.log(`Host: ${account.imapHost}:${account.imapPort}`);

    const client = new ImapFlow({
        host: account.imapHost || 'mail.hover.com',
        port: account.imapPort || 993,
        secure: true,
        auth: {
            user: account.imapUsername,
            pass: decrypt(account.imapPasswordEncrypted)
        },
        logger: {
            debug: console.log,
            info: console.log,
            warn: console.warn,
            error: console.error
        }
    });

    try {
        await client.connect();
        console.log('✅ CONNECTED SUCCESS!');
        await client.logout();
    } catch (error) {
        console.error('❌ CONNECTION FAILED:');
        console.error(error);
    } finally {
        process.exit(0);
    }
}

testHoverDirect();
