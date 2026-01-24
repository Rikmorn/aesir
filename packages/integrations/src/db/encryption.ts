/**
 * Credential Encryption Utilities
 *
 * AES-256-CBC encryption for OAuth tokens and sensitive credentials.
 * Uses unique IV per encryption for security.
 *
 * Key requirements:
 * - CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)
 * - Generate with: openssl rand -hex 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Error thrown when encryption key is missing or invalid
 */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

/**
 * Get and validate encryption key from environment
 * @throws EncryptionKeyError if key is missing or invalid
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new EncryptionKeyError(
      "CREDENTIAL_ENCRYPTION_KEY is required for credential storage. " +
        "Generate with: openssl rand -hex 32",
    );
  }

  if (keyHex.length !== 64) {
    throw new EncryptionKeyError(
      `CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes), got ${keyHex.length} chars`,
    );
  }

  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a token using AES-256-CBC
 *
 * Returns format: iv:ciphertext (both hex-encoded)
 * IV is unique per encryption for security.
 *
 * @param plaintext - Token to encrypt
 * @returns Encrypted string in format iv:ciphertext
 * @throws EncryptionKeyError if key is missing or invalid
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a token encrypted with encryptToken
 *
 * @param ciphertext - Encrypted string in format iv:ciphertext
 * @returns Decrypted plaintext
 * @throws EncryptionKeyError if key is missing or invalid
 * @throws Error if ciphertext format is invalid
 */
export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();

  const parts = ciphertext.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid ciphertext format: expected iv:ciphertext");
  }

  const [ivHex, encryptedHex] = parts;
  if (!ivHex || !encryptedHex) {
    throw new Error("Invalid ciphertext format: iv or ciphertext is empty");
  }

  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
