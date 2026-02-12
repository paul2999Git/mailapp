
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const messageCount = await prisma.message.count();
    const classifiedCount = await prisma.message.count({
        where: { aiCategory: { not: null } }
    });
    const classificationRecordCount = await prisma.aiClassification.count();
    const categories = await prisma.category.findMany();
    const rules = await prisma.learnedRule.count();

    console.log('--- Stats ---');
    console.log(`Total Messages: ${messageCount}`);
    console.log(`Classified Messages (aiCategory != null): ${classifiedCount}`);
    console.log(`Classification Records: ${classificationRecordCount}`);
    console.log(`Total Categories: ${categories.length}`);
    console.log(`Learned Rules: ${rules}`);
    console.log('Categories:', categories.map(c => c.name).join(', '));
}

main().catch(console.error).finally(() => prisma.$disconnect());
