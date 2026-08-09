import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from './paths';

/**
 * Secrets (Claude token, GitHub App private key, webhook tokens) are stored
 * encrypted at rest so a stolen app.db alone is not enough to act on GitHub.
 *
 * The master key comes from APP_SECRET when set; otherwise one is generated
 * on first boot and kept in the data volume next to the database.
 */
function loadMasterKey(): Buffer {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    return crypto.createHash('sha256').update(fromEnv).digest();
  }
  ensureDirs();
  const keyFile = path.join(DATA_DIR, 'master.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(fs.readFileSync(keyFile, 'utf8').trim()).digest();
}

let cachedKey: Buffer | null = null;
function masterKey(): Buffer {
  if (!cachedKey) cachedKey = loadMasterKey();
  return cachedKey;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Format de secret chiffré invalide');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    masterKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt.${salt.toString('base64url')}.${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('.');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Constant-time compare of a plaintext bearer token against its SHA-256. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomId(bytes = 12): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomToken(): string {
  return `cog_${crypto.randomBytes(24).toString('base64url')}`;
}

/** HMAC-signed session cookie value: <payload>.<signature>. */
export function signSession(payload: string): string {
  const sig = crypto.createHmac('sha256', masterKey()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifySession(cookie: string): string | null {
  const [payloadB64, sig] = cookie.split('.');
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', masterKey()).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  return payload;
}
