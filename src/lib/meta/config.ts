/**
 * Meta WhatsApp Cloud API Configuration
 * Phase R6.1A - Connection Security Foundation
 */

export interface MetaConfig {
  appId: string;
  appSecret: string;
  businessId: string;
  systemUserId: string;
  systemUserAccessToken: string;
  webhookVerifyToken: string;
  embeddedSignupConfigId: string;
  graphApiVersion: string;
  activeEncryptionKeyVersion: string;
}

export interface MetaReadiness {
  ready: boolean;
  isConfigured: boolean;
  missing: string[];
  graphApiVersion: string;
  activeKeyVersion: string;
  hasEncryptionKey: boolean;
}

const REQUIRED_CONFIG_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_BUSINESS_ID",
  "META_SYSTEM_USER_ID",
  "META_SYSTEM_USER_ACCESS_TOKEN",
  "META_WEBHOOK_VERIFY_TOKEN",
  "META_EMBEDDED_SIGNUP_CONFIG_ID",
  "META_CREDENTIAL_ENCRYPTION_KEY_V1",
] as const;

export function getMetaConfig(): MetaConfig {
  const appId = process.env.META_APP_ID || "";
  const appSecret = process.env.META_APP_SECRET || "";
  const businessId = process.env.META_BUSINESS_ID || "";
  const systemUserId = process.env.META_SYSTEM_USER_ID || "";
  const systemUserAccessToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN || "";
  const webhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
  const embeddedSignupConfigId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "";
  const graphApiVersion = process.env.META_GRAPH_API_VERSION || "v21.0";
  const activeEncryptionKeyVersion =
    process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION || "v1";

  return {
    appId,
    appSecret,
    businessId,
    systemUserId,
    systemUserAccessToken,
    webhookVerifyToken,
    embeddedSignupConfigId,
    graphApiVersion,
    activeEncryptionKeyVersion,
  };
}

export function getMetaReadiness(): MetaReadiness {
  const missing: string[] = [];

  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!process.env[key] || process.env[key]?.trim() === "") {
      missing.push(key);
    }
  }

  const activeKeyVersion =
    process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION || "v1";
  const keyEnvName = `META_CREDENTIAL_ENCRYPTION_KEY_${activeKeyVersion.toUpperCase()}`;
  const hasEncryptionKey = Boolean(process.env[keyEnvName]?.trim());

  return {
    ready: missing.length === 0,
    isConfigured: missing.length < REQUIRED_CONFIG_KEYS.length,
    missing,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "v21.0",
    activeKeyVersion,
    hasEncryptionKey,
  };
}

/**
 * Resolves 32-byte Buffer encryption key for a given key version.
 * Supports:
 * - 64-character Hex string (32 bytes)
 * - 44-character Base64 string (32 bytes)
 * - 32-character raw ASCII/UTF8 string (32 bytes)
 */
export function getEncryptionKey(version?: string): Buffer {
  const keyVersion =
    version || process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION || "v1";
  const envVarName = `META_CREDENTIAL_ENCRYPTION_KEY_${keyVersion.toUpperCase()}`;
  const rawKey = process.env[envVarName];

  if (!rawKey || rawKey.trim().length === 0) {
    throw new Error(
      `Meta encryption key not found for version '${keyVersion}' in env '${envVarName}'.`
    );
  }

  const trimmed = rawKey.trim();

  // 1. 64-char Hex (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // 2. Base64 encoded 32 bytes
  try {
    const b64Buf = Buffer.from(trimmed, "base64");
    if (b64Buf.length === 32) {
      return b64Buf;
    }
  } catch {
    // fallback
  }

  // 3. Raw 32-byte UTF8 string
  const utf8Buf = Buffer.from(trimmed, "utf8");
  if (utf8Buf.length === 32) {
    return utf8Buf;
  }

  throw new Error(
    `Meta encryption key in '${envVarName}' must be 32 bytes (64-char hex, base64-encoded 32 bytes, or 32 raw bytes).`
  );
}
