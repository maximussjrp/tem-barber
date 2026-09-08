/**
 * Meta Cryptographic Operations & Security Utilities
 * Phase R6.1A - Connection Security Foundation
 */

import crypto from "crypto";
import { getEncryptionKey } from "./config";

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export interface EncryptCredentialOptions {
  plaintext: string;
  barbershopId: string;
  metaConnectionId: string;
  credentialType: "REGISTRATION_PIN" | string;
  keyVersion?: string;
}

export interface DecryptCredentialOptions {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  barbershopId: string;
  metaConnectionId: string;
  credentialType: "REGISTRATION_PIN" | string;
}

/**
 * Builds the Additional Authenticated Data (AAD) string for AES-256-GCM.
 * Binding barbershopId, metaConnectionId, credentialType, and keyVersion prevents
 * ciphertext swap / cross-tenant / cross-connection replay attacks.
 */
export function buildCredentialAad(
  barbershopId: string,
  metaConnectionId: string,
  credentialType: string,
  keyVersion: string
): string {
  return `${barbershopId}:${metaConnectionId}:${credentialType}:${keyVersion}`;
}

/**
 * Encrypts a sensitive credential using AES-256-GCM with AAD binding.
 */
export function encryptMetaCredential(
  options: EncryptCredentialOptions
): EncryptedCredential {
  const {
    plaintext,
    barbershopId,
    metaConnectionId,
    credentialType,
    keyVersion = process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION || "v1",
  } = options;

  const key = getEncryptionKey(keyVersion);
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const aad = buildCredentialAad(
    barbershopId,
    metaConnectionId,
    credentialType,
    keyVersion
  );

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertextBuf = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertextBuf.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion,
  };
}

/**
 * Decrypts a sensitive credential using AES-256-GCM with AAD validation.
 * Throws an error if ciphertext was tampered with or AAD does not match.
 */
export function decryptMetaCredential(
  options: DecryptCredentialOptions
): string {
  const {
    ciphertext,
    iv,
    authTag,
    keyVersion,
    barbershopId,
    metaConnectionId,
    credentialType,
  } = options;

  const key = getEncryptionKey(keyVersion);
  const aad = buildCredentialAad(
    barbershopId,
    metaConnectionId,
    credentialType,
    keyVersion
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  const decryptedBuf = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);

  return decryptedBuf.toString("utf8");
}

/**
 * Generates a cryptographically secure 6-digit numeric PIN ("000000" to "999999")
 * for WhatsApp Business Account phone number registration.
 */
export function generateRegistrationPin(): string {
  const pinInt = crypto.randomInt(0, 1000000);
  return pinInt.toString().padStart(6, "0");
}

/**
 * Generates a secure random 32-byte hex nonce for onboarding sessions.
 */
export function generateOnboardingNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes SHA-256 hex hash of a nonce to store in database.
 */
export function hashOnboardingNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce, "utf8").digest("hex");
}

/**
 * Verifies the X-Hub-Signature-256 header sent by Meta webhooks.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyMetaWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const signatureHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(signatureHex)) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", appSecret);
  hmac.update(rawBody);
  const expectedHex = hmac.digest("hex");

  const sigBuffer = Buffer.from(signatureHex, "utf8");
  const expectedBuffer = Buffer.from(expectedHex, "utf8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Computes appsecret_proof for Meta Graph API calls.
 */
export function generateAppSecretProof(
  accessToken: string,
  appSecret: string
): string {
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
}
