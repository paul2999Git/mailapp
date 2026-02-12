
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateModels() {
    console.log('🚀 Starting model migration to gemini-flash-latest...');

    const users = await prisma.user.findMany();
    let updatedCount = 0;

    for (const user of users) {
        const settings = (user.settings as any) || {};

        // Force model to gemini-flash-latest
        const newSettings = {
            ...settings,
            aiModel: 'gemini-flash-latest'
        };

        await prisma.user.update({
            where: { id: user.id },
            data: { settings: newSettings }
        });

        console.log(`✅ Updated user: ${user.email}`);
        updatedCount++;
    }

    console.log(`\n🎉 Migration complete. Updated ${updatedCount} users.`);
    await prisma.$disconnect();
}

migrateModels().catch(console.error);
