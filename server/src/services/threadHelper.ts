import { prisma } from '../lib/db';
import type { NormalizedMessage } from '../providers/types';

/**
 * Find or create a thread for a message
 */
export async function findOrCreateThread(accountId: string, userId: string, msg: NormalizedMessage) {
    // Normalize subject (remove Re:, Fwd:, etc.)
    const normalizedSubject = msg.subject
        ?.replace(/^(Re|Fwd|Fw):\s*/i, '')
        .trim() || '(no subject)';

    // Try to find existing thread by subject AND accountId
    let thread = await prisma.thread.findFirst({
        where: {
            userId,
            subjectNormalized: normalizedSubject,
            accountIds: { has: accountId },
        },
        orderBy: { lastMessageDate: 'desc' },
    });

    // Create new thread if none found
    if (!thread) {
        thread = await prisma.thread.create({
            data: {
                userId,
                subjectNormalized: normalizedSubject,
                participantEmails: Array.from(new Set([
                    msg.from.email,
                    ...msg.to.map((t: any) => t.email),
                    ...(msg.cc || []).map((t: any) => t.email)
                ])),
                firstMessageDate: msg.dateReceived || new Date(),
                lastMessageDate: msg.dateReceived || new Date(),
                messageCount: 1,
                unreadCount: msg.isRead ? 0 : 1,
                accountIds: [accountId],
                hasAttachments: msg.hasAttachments,
            },
        });
    } else {
        // Update thread stats
        await prisma.thread.update({
            where: { id: thread.id },
            data: {
                lastMessageDate: msg.dateReceived || new Date(),
                messageCount: { increment: 1 },
                unreadCount: msg.isRead ? undefined : { increment: 1 },
                hasAttachments: thread.hasAttachments || msg.hasAttachments,
            },
        });
    }

    // We don't call updateThreadStats(thread.id) here anymore because for new messages,
    // the message hasn't been created yet so the stats would be wrong (0).
    // The caller (accountSync.service.ts) must call it AFTER creating the message.

    return thread;
}

/**
 * Recalculate and update thread stats (messageCount, unreadCount, participants)
 */
export async function updateThreadStats(threadId: string) {
    const messages = await prisma.message.findMany({
        where: {
            threadId,
            isHidden: false,
        },
        select: {
            isRead: true,
            fromAddress: true,
            toAddresses: true,
            ccAddresses: true,
        },
    });

    const messageCount = messages.length;
    const unreadCount = messages.filter(m => !m.isRead).length;

    // Recalculate participants
    const participants = new Set<string>();
    for (const msg of messages) {
        if (msg.fromAddress) participants.add(msg.fromAddress.toLowerCase());

        const toList = msg.toAddresses as any[];
        if (Array.isArray(toList)) {
            toList.forEach(p => {
                const email = (typeof p === 'string' ? p : p.email)?.toLowerCase();
                if (email) participants.add(email);
            });
        }

        const ccList = msg.ccAddresses as any[];
        if (Array.isArray(ccList)) {
            ccList.forEach(p => {
                const email = (typeof p === 'string' ? p : p.email)?.toLowerCase();
                if (email) participants.add(email);
            });
        }
    }

    // Update the thread with new counts and participants
    await prisma.thread.update({
        where: { id: threadId },
        data: {
            messageCount,
            unreadCount,
            participantEmails: Array.from(participants),
        },
    });

    console.log(`Updated thread ${threadId} stats: ${messageCount} msgs, ${unreadCount} unread, ${participants.size} participants`);
}
