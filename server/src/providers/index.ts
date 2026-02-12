import type { ProviderType } from '@mailhub/shared';
import type { IProviderAdapter, ConnectionConfig, OAuthConfig, ImapConfig } from './types';
import { GmailAdapter } from './gmail.adapter';
import { ProtonAdapter, HoverAdapter, ImapAdapter } from './imap.adapter';
import { ZohoAdapter } from './zoho.adapter';

export * from './types';
export { GmailAdapter } from './gmail.adapter';
export { ProtonAdapter, HoverAdapter, ImapAdapter } from './imap.adapter';

/**
 * Creates the appropriate provider adapter based on provider type
 */
export function createProviderAdapter(
    provider: ProviderType,
    accountId: string,
    config: ConnectionConfig
): IProviderAdapter {
    switch (provider) {
        case 'gmail':
            if (config.type !== 'oauth') {
                throw new Error('Gmail requires OAuth configuration');
            }
            return new GmailAdapter(accountId, config);

        case 'proton':
            if (config.type !== 'imap') {
                throw new Error('Proton requires IMAP configuration (via Proton Bridge)');
            }
            return new ProtonAdapter(accountId, config);

        case 'hover':
            if (config.type !== 'imap') {
                throw new Error('Hover requires IMAP configuration');
            }
            return new HoverAdapter(accountId, config);

        case 'zoho':
            // Zoho supports both OAuth and IMAP
            if (config.type === 'oauth') {
                return new ZohoAdapter(accountId, config);
            }
            return new ImapAdapter('zoho', accountId, {
                ...config,
                host: config.host || 'imap.zoho.com',
                port: config.port || 993,
                tls: true,
            });

        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * Gets connection config from database account record
 */
export function getConnectionConfig(account: {
    provider: ProviderType;
    accessTokenEncrypted?: Buffer | null;
    refreshTokenEncrypted?: Buffer | null;
    tokenExpiresAt?: Date | null;
    imapHost?: string | null;
    imapPort?: number | null;
    imapUsername?: string | null;
    imapPasswordDecrypted: string | null;
}): ConnectionConfig {
    // OAuth providers
    if (account.provider === 'gmail') {
        if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted) {
            throw new Error('Gmail account missing OAuth tokens');
        }
        // Note: tokens should be decrypted before calling this
        return {
            type: 'oauth',
            accessToken: '', // Should be passed decrypted
            refreshToken: '',
            expiresAt: account.tokenExpiresAt || new Date(),
        };
    }

    // IMAP providers
    if (!account.imapHost || !account.imapUsername || !account.imapPasswordDecrypted) {
        throw new Error(`${account.provider} account missing IMAP credentials`);
    }

    return {
        type: 'imap',
        host: account.imapHost,
        port: account.imapPort || 993,
        username: account.imapUsername,
        password: account.imapPasswordDecrypted,
        tls: account.provider !== 'proton', // Proton Bridge uses STARTTLS
    };
}
