const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspectData() {
    try {
        console.log('--- SAMPLE MESSAGES ---');
        const samples = await prisma.message.findMany({
            where: {
                aiCategory: null,
                isHidden: false,
                neverShow: false
            },
            include: { currentFolder: true },
            take: 10
        });

        console.log(`Found ${samples.length} messages with aiCategory: null`);
        samples.forEach(m => {
            console.log(`- Subject: ${m.subject}`);
            console.log(`  Folder: ${m.currentFolder?.name} (Type: ${m.currentFolder?.folderType})`);
        });

        const folderTypes = await prisma.folder.groupBy({
            by: ['folderType'],
            _count: { id: true }
        });
        console.log('\n--- FOLDER TYPES IN DB ---');
        console.log(folderTypes);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

inspectData();
