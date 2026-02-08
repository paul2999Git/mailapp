import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET!;
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sign a userId + timestamp into a tamper-proof, base64url-encoded state string.
 * Format: <base64url(payload)>.<base64url(hmac)>
 */
export function signState(userId: string): string {
    const payload = JSON.stringify({ userId, ts: Date.now() });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto
        .createHmac('sha256', SECRET)
        .update(payloadB64)
        .digest('base64url');
    return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed state string. Returns { userId } on success, null on
 * invalid signature or expiry (>10 min).
 */
export function verifyState(state: string): { userId: string } | null {
    const dot = state.indexOf('.');
    if (dot === -1) return null;

    const payloadB64 = state.slice(0, dot);
    const sig = state.slice(dot + 1);

    const expectedSig = crypto
        .createHmac('sha256', SECRET)
        .update(payloadB64)
        .digest('base64url');

    // Constant-time comparison — bail if lengths differ
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    try {
        const { userId, ts } = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString(),
        );
        if (typeof userId !== 'string' || typeof ts !== 'number') return null;
        if (Date.now() - ts > MAX_AGE_MS) return null;
        return { userId };
    } catch {
        return null;
    }
}
