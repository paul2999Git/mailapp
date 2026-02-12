
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUserSettings() {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            settings: true
        }
    });

    console.log('--- User Settings ---');
    users.forEach(user => {
        console.log(`User: ${user.email} (${user.id})`);
        console.log('Settings:', JSON.stringify(user.settings, null, 2));
        console.log('---------------------');
    });

    await prisma.$disconnect();
}

checkUserSettings().catch(console.error);
