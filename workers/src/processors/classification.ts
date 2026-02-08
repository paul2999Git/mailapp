import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { ClassificationInput, ClassificationResult } from '@mailhub/shared';

const prisma = new PrismaClient();

interface ClassificationJobData {
    messageId: string;
}

export async function processClassificationJob(job: Job<ClassificationJobData>) {
    console.log(`Processing classification job for message: ${job.data.messageId}`);

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

    const user = message.account.user;
    const userSettings = user.settings as { aiProvider?: string; bodyPreviewChars?: number };

    // Build classification input
    const input: ClassificationInput = {
        messageId: message.id,
        accountId: message.accountId,
        provider: message.account.provider,
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

    // Check for learned rules first
    const learnedRule = await checkLearnedRules(user.id, input);
    if (learnedRule) {
        await applyRuleClassification(message.id, learnedRule);
        return { success: true, usedRule: true };
    }

    // TODO: Call AI classification service
    // const result = await classifyWithAI(input, userSettings.aiProvider || 'gemini');

    // For now, use placeholder classification
    const result: ClassificationResult = {
        categoryId: 'inbox',
        confidence: 0.5,
        explanation: 'Default classification (AI not yet implemented)',
        factors: [],
        suggestedAction: 'inbox',
        needsHumanReview: true,
    };

    // Store classification result
    await prisma.aiClassification.create({
        data: {
            messageId: message.id,
            confidence: result.confidence,
            explanation: result.explanation,
            reasoningFactors: result.factors as unknown as import('@prisma/client').Prisma.InputJsonValue,
            aiModel: userSettings.aiProvider || 'gemini',
            promptVersion: '1.0',
            usedBodyContent: !!input.bodyPreview,
            bodyCharsSent: input.bodyPreviewCharCount,
        },
    });

    // Update message with classification
    await prisma.message.update({
        where: { id: message.id },
        data: {
            aiCategory: result.categoryId,
            aiConfidence: result.confidence,
            isQuarantined: result.needsHumanReview,
        },
    });

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

async function applyRuleClassification(
    messageId: string,
    rule: { targetCategoryId: string | null; id: string }
) {
    if (!rule.targetCategoryId) return;

    const category = await prisma.category.findUnique({
        where: { id: rule.targetCategoryId },
    });

    if (!category) return;

    await prisma.message.update({
        where: { id: messageId },
        data: {
            aiCategory: category.name,
            aiConfidence: 1.0, // Rule-based = 100% confidence
        },
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
