import { prisma } from '../lib/db';
import { DEFAULT_CATEGORIES } from '@mailhub/shared';

export class ClassificationService {
    /**
     * Seed default system categories for a user if they don't exist
     */
    async seedCategoriesForUser(userId: string) {
        // We check each default category to ensure it exists for the user
        // This allows us to "lazy-add" new system categories to existing users

        const existingCategories = await prisma.category.findMany({
            where: { userId },
            select: { name: true }
        });

        const existingNames = new Set(existingCategories.map(c => c.name));

        for (const cat of DEFAULT_CATEGORIES) {
            if (!existingNames.has(cat.name)) {
                console.log(`Seeding missing category "${cat.name}" for user: ${userId}`);
                await prisma.category.create({
                    data: {
                        userId,
                        name: cat.name,
                        description: cat.description,
                        priority: cat.priority,
                        isSystem: false,
                    },
                });
            }
        }
    }

    /**
     * Create a new category for a user
     */
    async createCategory(userId: string, data: { name: string; description?: string; color?: string; icon?: string; priority?: number }) {
        return prisma.category.create({
            data: {
                userId,
                ...data,
            },
        });
    }

    /**
     * List all categories for a user
     */
    async listCategories(userId: string) {
        // Ensure categories are seeded first (lazy seeding)
        await this.seedCategoriesForUser(userId);

        const categories = await prisma.category.findMany({
            where: { userId },
            orderBy: { priority: 'asc' },
        });

        // Calculate unread counts for each category
        const categoriesWithCounts = await Promise.all(
            categories.map(async (cat) => {
                const unreadCount = await prisma.message.count({
                    where: {
                        account: { userId },
                        aiCategory: cat.name,
                        isRead: false,
                        isHidden: false,
                    },
                });
                return {
                    ...cat,
                    unreadCount,
                };
            })
        );

        return categoriesWithCounts;
    }

    /**
     * Delete a category for a user
     */
    async deleteCategory(userId: string, categoryId: string) {
        return prisma.category.delete({
            where: {
                id: categoryId,
                userId, // Security check
            },
        });
    }

    /**
     * Move a message on the provider based on its category
     */
    async moveMessageOnProvider(messageId: string, categoryName: string) {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: { account: true }
        });

        if (!message) return;

        // Find a folder with the same name for this account
        const folder = await prisma.folder.findFirst({
            where: {
                accountId: message.accountId,
                name: { equals: categoryName, mode: 'insensitive' }
            }
        });

        if (folder && folder.id !== message.currentFolderId) {
            console.log(`📦 Moving message ${message.providerMessageId} to folder "${folder.name}" on provider`);

            // Dynamic import to avoid circular dependency
            const { accountSyncService } = await import('./accountSync.service.js');
            const adapter = await accountSyncService.getAdapterForAccount(message.accountId);

            try {
                await adapter.moveToFolder(message.providerMessageId, folder.providerFolderId);

                // Update the message's folder locally too
                await prisma.message.update({
                    where: { id: message.id },
                    data: { currentFolderId: folder.id }
                });
                console.log(`✅ Successfully moved message ${message.id} to ${folder.name}`);
            } catch (moveError: any) {
                console.error(`❌ Failed to move message ${message.id} on provider:`, moveError.message);
            } finally {
                await adapter.disconnect();
            }
        }
    }
}

export const classificationService = new ClassificationService();
