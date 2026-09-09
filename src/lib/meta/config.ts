/**
 * Meta WhatsApp Cloud API Configuration
 * Phase R6.1B - Pre-Live Config Hardening
 */

export type MetaWabaSystemUserTask = "MANAGE" | "DEVELOP";

export interface MetaConfig {
  appId: string;
  appSecret: string;
  businessId: string;
  systemUserId: string;
  systemUserAccessToken: string;
  webhookVerifyToken: string;
  embeddedSignupConfigId: string;
  graphApiVersion: string;
  wabaSystemUserTask: MetaWabaSystemUserTask | "";
  activeEncryptionKeyVersion: string;
}

export interface MetaReadiness {
  ready: boolean;
  isConfigured: boolean;
  missing: string[];
  graphApiVersion: string;
  wabaSystemUserTask: string;
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
  "META_GRAPH_API_VERSION",
  "META_WABA_SYSTEM_USER_TASK",
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
  const graphApiVersion = process.env.META_GRAPH_API_VERSION || "";
  const rawWabaTask = (process.env.META_WABA_SYSTEM_USER_TASK || "").trim().toUpperCase();
  const wabaSystemUserTask: MetaWabaSystemUserTask | "" =
    rawWabaTask === "MANAGE" || rawWabaTask === "DEVELOP"
      ? (rawWabaTask as MetaWabaSystemUserTask)
      : "";
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
    wabaSystemUserTask,
    activeEncryptionKeyVersion,
  };
}

export function getMetaReadiness(): MetaReadiness {
  const missing: string[] = [];

  for (const key of REQUIRED_CONFIG_KEYS) {
    const val = process.env[key];
    if (!val || val.trim() === "") {
      missing.push(key);
    }
  }

  // Explicit validation for META_WABA_SYSTEM_USER_TASK values
  const rawWabaTask = (process.env.META_WABA_SYSTEM_USER_TASK || "").trim().toUpperCase();
  if (rawWabaTask && rawWabaTask !== "MANAGE" && rawWabaTask !== "DEVELOP") {
    if (!missing.includes("META_WABA_SYSTEM_USER_TASK")) {
      missing.push("META_WABA_SYSTEM_USER_TASK");
    }
  }

  const activeKeyVersion =
    process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION || "v1";
  let hasEncryptionKey = false;
  try {
    const keyBuf = getEncryptionKey(activeKeyVersion);
    hasEncryptionKey = keyBuf.length === 32;
  } catch {
    hasEncryptionKey = false;
  }

  const keyEnvName = `META_CREDENTIAL_ENCRYPTION_KEY_${activeKeyVersion.toUpperCase()}`;
  if (!hasEncryptionKey && !missing.includes(keyEnvName)) {
    missing.push(keyEnvName);
  }

  return {
    ready: missing.length === 0,
    isConfigured: missing.length < REQUIRED_CONFIG_KEYS.length,
    missing,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "",
    wabaSystemUserTask: rawWabaTask,
    activeKeyVersion,
    hasEncryptionKey,
  };
}

/**
 * Resolves 32-byte Buffer encryption key for a given key version.
 * Supports exclusively explicit encodings:
 * - 64-character Hex string (32 bytes)
 * - Base64 string decoding to exactly 32 bytes
 *
 * Rejects raw/arbitrary UTF-8 strings.
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

  // 2. Base64 encoded 32 bytes (must match standard base64 format and decode to 32 bytes)
  const isBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    trimmed
  );
  if (isBase64Pattern) {
    try {
      const b64Buf = Buffer.from(trimmed, "base64");
      if (b64Buf.length === 32) {
        return b64Buf;
      }
    } catch {
      // invalid base64
    }
  }

  throw new Error(
    `Meta encryption key in '${envVarName}' must be explicitly encoded as a 64-char Hex string (32 bytes) or a Base64 string decoding to 32 bytes. Raw UTF-8 strings are prohibited.`
  );
}
