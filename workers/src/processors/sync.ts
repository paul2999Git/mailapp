import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SyncJobData {
    type: 'all-accounts' | 'single-account';
    accountId?: string;
}

export async function processSyncJob(job: Job<SyncJobData>) {
    console.log(`Processing sync job: ${job.id}`, job.data);

    if (job.data.type === 'all-accounts') {
        // Get all enabled accounts
        const accounts = await prisma.account.findMany({
            where: { isEnabled: true },
            select: {
                id: true,
                provider: true,
                emailAddress: true,
            },
        });

        for (const account of accounts) {
            await syncAccount(account.id);
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
        // TODO: Implement provider-specific sync logic
        // For now, just log a placeholder
        console.log(`Syncing account: ${account.emailAddress} (${account.provider})`);

        // Provider-specific sync would go here:
        // switch (account.provider) {
        //   case 'gmail':
        //     await syncGmailAccount(account);
        //     break;
        //   case 'proton':
        //     await syncImapAccount(account); // Via Proton Bridge
        //     break;
        //   case 'hover':
        //   case 'zoho':
        //     await syncImapAccount(account);
        //     break;
        // }

        // Update sync job status
        await prisma.syncJob.update({
            where: { id: syncJob.id },
            data: {
                status: 'completed',
                completedAt: new Date(),
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
