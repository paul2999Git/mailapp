const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCategories() {
    try {
        console.log('--- SAMPLE MESSAGE CATEGORIES ---');
        const samples = await prisma.message.findMany({
            where: {
                isHidden: false,
                neverShow: false
            },
            select: { id: true, subject: true, aiCategory: true },
            take: 10
        });

        samples.forEach(m => {
            console.log(`- ${m.subject} => Category: [${m.aiCategory}]`);
        });

        console.log('\n--- EXISTING CATEGORY MODELS ---');
        const categories = await prisma.category.findMany();
        console.log(categories.map(c => c.name));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkCategories();
