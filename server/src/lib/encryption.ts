import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY environment variable is not set');
    }
    return Buffer.from(key, 'hex');
}

/**
 * Encrypts sensitive data (e.g., OAuth tokens, IMAP passwords)
 * Uses AES-256-GCM for authenticated encryption
 */
export function encrypt(plaintext: string): Buffer {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: IV (16 bytes) + AuthTag (16 bytes) + Encrypted data
    return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts data encrypted with the encrypt function
 */
export function decrypt(encrypted: Buffer): string {
    const key = getEncryptionKey();

    const iv = encrypted.subarray(0, IV_LENGTH);
    const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}

/**
 * Generate a new encryption key (for setup)
 */
export function generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
}
