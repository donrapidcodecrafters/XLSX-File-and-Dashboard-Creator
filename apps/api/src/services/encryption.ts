import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = "enc1:"; // versioned prefix so we can detect + later rotate

function deriveKey(rawKey: string): Buffer {
  // Accept a hex string (64 chars = 32 bytes) or any string — SHA-256 normalises length.
  const hex = /^[0-9a-f]{64}$/i.test(rawKey.trim())
    ? rawKey.trim()
    : createHash("sha256").update(rawKey).digest("hex");
  return Buffer.from(hex, "hex").subarray(0, KEY_BYTES);
}

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) return null;
  return deriveKey(raw);
}

/**
 * Encrypts a UTF-8 plaintext string.
 * Returns a compact base64 string: `enc1:<b64(iv + tag + ciphertext)>`.
 * Returns the original value unchanged if ENCRYPTION_KEY is not configured.
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + combined.toString("base64");
}

/**
 * Decrypts a value produced by encryptField.
 * Returns the original value unchanged if ENCRYPTION_KEY is not configured
 * or the value is not an encrypted blob.
 */
export function decryptField(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith(PREFIX)) return ciphertext;
  const key = getKey();
  if (!key) return ciphertext;
  try {
    const combined = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
    const iv = combined.subarray(0, IV_BYTES);
    const tag = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = combined.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return ciphertext;
  }
}

/** Returns true when ENCRYPTION_KEY is configured and encryption is active. */
export function isEncryptionEnabled(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY);
}

/** Encrypts an arbitrary object to a compact string. */
export function encryptJson(value: unknown): string {
  return encryptField(JSON.stringify(value));
}

/** Decrypts and parses a JSON object produced by encryptJson. */
export function decryptJson<T = unknown>(ciphertext: string): T {
  const raw = decryptField(ciphertext);
  return JSON.parse(raw) as T;
}
