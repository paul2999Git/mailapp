import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { AccountSyncService } from '../../../server/src/services/accountSync.service.js';

const prisma = new PrismaClient();
const syncService = new AccountSyncService();

interface SyncJobData {
    type: 'all-accounts' | 'single-account';
    accountId?: string;
}

export async function processSyncJob(job: Job<SyncJobData>) {
    console.log(`Processing sync job: ${job.id}`, job.data);

    if (job.data.type === 'all-accounts') {
        // Get all enabled accounts with user settings for sync interval
        const accounts = await prisma.account.findMany({
            where: { isEnabled: true },
            select: {
                id: true,
                provider: true,
                emailAddress: true,
                lastSyncAt: true,
                user: { select: { settings: true } },
            },
        });

        const now = Date.now();

        for (const account of accounts) {
            try {
                const userSettings = account.user.settings as Record<string, any>;
                const intervalMinutes = Number(userSettings?.syncIntervalMinutes) || 5;
                const intervalMs = intervalMinutes * 60 * 1000;

                if (account.lastSyncAt && (now - account.lastSyncAt.getTime()) < intervalMs) {
                    const minutesAgo = Math.round((now - account.lastSyncAt.getTime()) / 60000);
                    console.log(`⏭️ Skipping ${account.emailAddress} — synced ${minutesAgo}m ago, interval is ${intervalMinutes}m`);
                    continue;
                }

                await syncAccount(account.id);
            } catch (err) {
                console.error(`⚠️ Sync failed for ${account.emailAddress} (${account.provider}), continuing with other accounts:`, err instanceof Error ? err.message : err);
            }
            await job.updateProgress((accounts.indexOf(account) + 1) / accounts.length * 100);
        }
    } else if (job.data.accountId) {
        await syncAccount(job.data.accountId);
    }

    return { success: true, timestamp: new Date().toISOString() };
}

async function syncAccount(accountId: string) {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        include: { user: true },
    });

    if (!account) {
        throw new Error(`Account ${accountId} not found`);
    }

    // Create sync job record
    const syncJob = await prisma.syncJob.create({
        data: {
            accountId,
            jobType: 'incremental',
            status: 'running',
            startedAt: new Date(),
        },
    });

    try {
        console.log(`Syncing account: ${account.emailAddress} (${account.provider})`);

        // Perform the actual sync using AccountSyncService
        const result = await syncService.syncAccount(accountId);

        console.log(`Sync completed for ${account.emailAddress}:`, {
            messagesNew: result.messagesNew,
            messagesUpdated: result.messagesUpdated,
            foldersUpdated: result.foldersUpdated,
        });

        // Update sync job status
        await prisma.syncJob.update({
            where: { id: syncJob.id },
            data: {
                status: 'completed',
                completedAt: new Date(),
                messagesProcessed: result.messagesNew + result.messagesUpdated,
            },
        });

        // Update account last sync time
        await prisma.account.update({
            where: { id: accountId },
            data: { lastSyncAt: new Date() },
        });

    } catch (error) {
        await prisma.syncJob.update({
            where: { id: syncJob.id },
            data: {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                retryCount: { increment: 1 },
            },
        });
        throw error;
    }
}
