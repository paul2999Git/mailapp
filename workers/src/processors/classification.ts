import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { ClassificationInput, ClassificationResult } from '@mailhub/shared';

const prisma = new PrismaClient();

interface ClassificationJobData {
    messageId: string;
}

import { aiService } from '../services/ai.service';

export async function processClassificationJob(job: Job<ClassificationJobData>) {
    console.log(`🤖 Processing classification for message: ${job.data.messageId}`);

    const message = await prisma.message.findUnique({
        where: { id: job.data.messageId },
        include: {
            account: {
                include: { user: true },
            },
        },
    });

    if (!message) {
        throw new Error(`Message ${job.data.messageId} not found`);
    }

    // Idempotency check: skip if already classified
    if (message.aiCategory) {
        console.log(`Message ${message.id} is already classified as "${message.aiCategory}". Skipping.`);
        return { success: true, skipped: true };
    }

    const user = message.account.user;
    const userSettings = user.settings as {
        aiProvider?: string;
        aiModel?: string;
        bodyPreviewChars?: number;
        classificationPrompt?: string;
    };

    // Build classification input
    const input: ClassificationInput = {
        messageId: message.id,
        accountId: message.accountId,
        provider: message.account.provider as any,
        headers: {
            subject: message.subject || '',
            from: {
                email: message.fromAddress || '',
                name: message.fromName || undefined,
            },
            to: (message.toAddresses as any[]) || [],
            cc: (message.ccAddresses as any[]) || undefined,
            date: message.dateReceived || new Date(),
        },
        bodyPreview: message.account.provider === 'proton'
            ? undefined  // Privacy: no body for Proton
            : message.bodyPreview?.slice(0, userSettings.bodyPreviewChars || 500),
        bodyPreviewCharCount: message.account.provider === 'proton'
            ? 0
            : (message.bodyPreview?.length || 0),
        existingLabels: (message.providerLabels as string[]) || [],
        isReply: !!message.inReplyTo,
        hasAttachments: message.hasAttachments,
        attachmentTypes: message.attachmentMetadata
            ? (message.attachmentMetadata as any[]).map(a => a.mimeType)
            : undefined,
    };

    // 1. Check for manual routing rules first (Highest priority)
    const learnedRule = await checkLearnedRules(user.id, input);
    if (learnedRule) {
        await applyLearnedRule(message.id, learnedRule);
        return { success: true, usedRule: true };
    }

    // 2. Fetch available categories for this user
    const categories = await prisma.category.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, description: true },
    });

    if (categories.length === 0) {
        console.warn(`No categories found for user ${user.id}. Skipping classification.`);
        return { success: false, error: 'NO_CATEGORIES' };
    }

    // 3. Call AI classification service
    const result = await aiService.classifyEmail(
        input,
        categories.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description || undefined,
        })),
        userSettings.classificationPrompt,
        userSettings.aiModel
    );

    // Store classification result
    await prisma.aiClassification.create({
        data: {
            messageId: message.id,
            categoryId: result.categoryId,
            confidence: result.confidence,
            explanation: result.explanation,
            reasoningFactors: result.factors as unknown as import('@prisma/client').Prisma.InputJsonValue,
            aiModel: userSettings.aiModel || userSettings.aiProvider || 'gemini',
            promptVersion: '1.0',
            usedBodyContent: !!input.bodyPreview,
            bodyCharsSent: input.bodyPreviewCharCount,
        },
    });

    // Update message with classification
    // Also find the category name for the aiCategory field
    const targetCategory = categories.find(c => c.id === result.categoryId);

    await prisma.message.update({
        where: { id: message.id },
        data: {
            aiCategory: targetCategory?.name || 'Uncategorized',
            aiConfidence: result.confidence,
            isQuarantined: result.needsHumanReview,
        },
    });

    // 4. Move message on provider if matching folder exists
    if (targetCategory && targetCategory.name !== 'Uncategorized' && targetCategory.name !== 'Quarantine') {
        try {
            // Find a folder with the same name for this account
            const folder = await prisma.folder.findFirst({
                where: {
                    accountId: message.accountId,
                    name: { equals: targetCategory.name, mode: 'insensitive' }
                }
            });

            if (folder) {
                console.log(`📦 Moving message ${message.providerMessageId} to folder "${folder.name}"`);
                const { AccountSyncService } = await import('../../../server/src/services/accountSync.service.js');
                const syncService = new AccountSyncService();
                const adapter = await syncService.getAdapterForAccount(message.accountId);

                try {
                    await adapter.moveToFolder(message.providerMessageId, folder.providerFolderId);

                    // Update the message's folder locally too
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { currentFolderId: folder.id }
                    });
                    console.log(`✅ Successfully moved message ${message.id}`);
                } catch (moveError: any) {
                    console.error(`❌ Failed to move message ${message.id} on provider:`, moveError.message);
                } finally {
                    await adapter.disconnect();
                }
            } else {
                console.log(`ℹ️ No matching folder found for category "${targetCategory.name}" on account ${message.accountId}`);
            }
        } catch (error: any) {
            console.error(`❌ Error during provider move logic:`, error.message);
        }
    }

    return { success: true, classification: result };
}

async function checkLearnedRules(userId: string, input: ClassificationInput) {
    // Check for sender email rule
    const emailRule = await prisma.learnedRule.findUnique({
        where: {
            userId_matchType_matchValue: {
                userId,
                matchType: 'sender_email',
                matchValue: input.headers.from.email,
            },
        },
    });

    if (emailRule) return emailRule;

    // Check for sender domain rule
    const domain = input.headers.from.email.split('@')[1];
    const domainRule = await prisma.learnedRule.findUnique({
        where: {
            userId_matchType_matchValue: {
                userId,
                matchType: 'sender_domain',
                matchValue: domain,
            },
        },
    });

    return domainRule;
}

async function applyLearnedRule(
    messageId: string,
    rule: {
        id: string;
        targetCategoryId: string | null;
        targetFolderId: string | null;
    }
) {
    const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { account: true },
    });

    if (!message) return;

    const updateData: any = {
        aiConfidence: 1.0, // Rule-based = 100% confidence
    };

    // Apply category if specified
    if (rule.targetCategoryId) {
        const category = await prisma.category.findUnique({
            where: { id: rule.targetCategoryId },
        });
        if (category) {
            updateData.aiCategory = category.name;
        }
    }

    // Apply folder routing if specified
    if (rule.targetFolderId) {
        const folder = await prisma.folder.findUnique({
            where: { id: rule.targetFolderId },
        });

        if (folder && folder.id !== message.currentFolderId) {
            console.log(`📦 Rule Match: Moving message ${message.providerMessageId} to folder "${folder.name}"`);

            const { AccountSyncService } = await import('../../../server/src/services/accountSync.service.js');
            const syncService = new AccountSyncService();
            const adapter = await syncService.getAdapterForAccount(message.accountId);

            try {
                await adapter.moveToFolder(message.providerMessageId, folder.providerFolderId);
                updateData.currentFolderId = folder.id;
                console.log(`✅ Successfully moved message ${message.id} by rule`);
            } catch (moveError: any) {
                console.error(`❌ Failed to move message ${message.id} by rule:`, moveError.message);
            } finally {
                await adapter.disconnect();
            }
        }
    }

    await prisma.message.update({
        where: { id: messageId },
        data: updateData,
    });

    // Update rule usage stats
    await prisma.learnedRule.update({
        where: { id: rule.id },
        data: {
            timesApplied: { increment: 1 },
            lastAppliedAt: new Date(),
        },
    });
}
