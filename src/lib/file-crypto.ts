/**
 * Encryption for sensitive stored files (tenant documents, tenant photos, expense bills).
 *
 * Files are encrypted with AES-256-GCM before they are written to MongoDB GridFS, so a copy of
 * the database alone is useless: the key lives only in the FILES_ENCRYPTION_KEY environment
 * variable (Render + local .env), never in the database.
 *
 * Stored format:  "RENC" | version (1 byte = 1) | IV (12 bytes) | auth tag (16 bytes) | ciphertext
 * Files without the "RENC" header are older, unencrypted uploads and are returned as-is, so
 * existing data keeps working until `scripts/encrypt-files.ts` converts it.
 *
 * Losing the key means encrypted files can never be opened again — keep a backup of it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("RENC", "ascii");
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES + TAG_BYTES;

/** Minimum length of FILES_ENCRYPTION_KEY (use 32+ random characters, e.g. from `openssl rand -base64 32`). */
export const MIN_KEY_CHARS = 32;

/** Derives the 256-bit AES key from the configured secret string. */
export function keyFromSecret(secret: string): Buffer {
  if (secret.length < MIN_KEY_CHARS) throw new Error(`FILES_ENCRYPTION_KEY must be at least ${MIN_KEY_CHARS} characters`);
  return createHash("sha256").update(`rentee-files:${secret}`, "utf8").digest();
}

export function isEncrypted(data: Uint8Array): boolean {
  return data.length >= HEADER_BYTES && Buffer.from(data.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function encryptBytes(plain: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Decrypts an encrypted file; returns unencrypted (legacy) data unchanged. Throws on a wrong key or tampering. */
export function decryptBytes(data: Buffer, key: Buffer | null): Buffer {
  if (!isEncrypted(data)) return data;
  if (!key) throw new Error("This file is encrypted but FILES_ENCRYPTION_KEY is not set");
  const version = data[MAGIC.length];
  if (version !== VERSION) throw new Error(`Unsupported encrypted file version ${version}`);
  const ivStart = MAGIC.length + 1;
  const iv = data.subarray(ivStart, ivStart + IV_BYTES);
  const tag = data.subarray(ivStart + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(HEADER_BYTES)), decipher.final()]);
}

let cached: { secret: string; key: Buffer } | null = null;

/** The configured key, or null when FILES_ENCRYPTION_KEY is unset. */
export function configuredFilesKey(): Buffer | null {
  const secret = process.env.FILES_ENCRYPTION_KEY?.trim();
  if (!secret) return null;
  if (cached?.secret !== secret) cached = { secret, key: keyFromSecret(secret) };
  return cached.key;
}

/**
 * Bytes to store for a sensitive file. Encrypts when a key is configured. Without a key,
 * production refuses (so sensitive files are never stored in the clear by accident) and
 * development stores them as-is with a warning.
 */
export function sealForStorage(plain: Buffer): Buffer {
  const key = configuredFilesKey();
  if (key) return encryptBytes(plain, key);
  if (process.env.NODE_ENV === "production") {
    throw new Error("FILES_ENCRYPTION_KEY is not set: refusing to store a sensitive file unencrypted");
  }
  console.warn("[files] FILES_ENCRYPTION_KEY is not set — storing a sensitive file unencrypted (development only)");
  return plain;
}

/** Plain bytes of a stored file (decrypting when needed). */
export function openFromStorage(stored: Buffer): Buffer {
  return decryptBytes(stored, configuredFilesKey());
}
