export interface PushKeysPayload {
  p256dh: string;
  auth: string;
}

export interface SubscribeRequestBody {
  endpoint: string;
  expirationTime?: number | null;
  keys: PushKeysPayload;
  deviceInstanceId?: string | null;
}

export interface UnsubscribeRequestBody {
  endpoint: string;
  keys: PushKeysPayload;
}

export interface ValidatedSubscribePayload {
  endpoint: string;
  expirationTime: Date | null;
  p256dh: string;
  auth: string;
  deviceInstanceId?: string | null;
}

export interface ValidatedUnsubscribePayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isValidBase64Url(str: string): boolean {
  if (typeof str !== "string" || str.length === 0 || str.length > 256) {
    return false;
  }
  const unpadded = str.replace(/=+$/, "");
  return BASE64URL_REGEX.test(unpadded);
}

function validateEndpoint(endpoint: unknown): string | null {
  if (typeof endpoint !== "string") return null;
  const trimmed = endpoint.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function validateKeys(keys: unknown): PushKeysPayload | null {
  if (!isObject(keys)) return null;

  const allowedKeys = new Set(["p256dh", "auth"]);
  for (const k of Object.keys(keys)) {
    if (!allowedKeys.has(k)) return null;
  }

  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || !isValidBase64Url(p256dh)) return null;
  if (typeof auth !== "string" || !isValidBase64Url(auth)) return null;

  return { p256dh, auth };
}

function parseExpirationTime(expirationTime: unknown): Date | null | "INVALID" {
  if (expirationTime === undefined || expirationTime === null) {
    return null;
  }
  if (typeof expirationTime !== "number" || !Number.isFinite(expirationTime) || expirationTime < 0) {
    return "INVALID";
  }
  const date = new Date(expirationTime);
  if (isNaN(date.getTime())) {
    return "INVALID";
  }
  return date;
}

export function parseSubscribeBody(body: unknown): ValidatedSubscribePayload | null {
  if (!isObject(body)) return null;

  const allowedTopLevel = new Set(["endpoint", "expirationTime", "keys", "deviceInstanceId"]);
  for (const k of Object.keys(body)) {
    if (!allowedTopLevel.has(k)) return null;
  }

  const endpoint = validateEndpoint(body.endpoint);
  if (!endpoint) return null;

  const keys = validateKeys(body.keys);
  if (!keys) return null;

  const expDate = parseExpirationTime(body.expirationTime);
  if (expDate === "INVALID") return null;

  let deviceInstanceId: string | null = null;
  if (body.deviceInstanceId !== undefined && body.deviceInstanceId !== null) {
    if (typeof body.deviceInstanceId !== "string") return null;
    const trimmed = body.deviceInstanceId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
      return null;
    }
    deviceInstanceId = trimmed;
  }

  return {
    endpoint,
    expirationTime: expDate,
    p256dh: keys.p256dh,
    auth: keys.auth,
    deviceInstanceId,
  };
}

export function parseUnsubscribeBody(body: unknown): ValidatedUnsubscribePayload | null {
  if (!isObject(body)) return null;

  const allowedTopLevel = new Set(["endpoint", "keys"]);
  for (const k of Object.keys(body)) {
    if (!allowedTopLevel.has(k)) return null;
  }

  const endpoint = validateEndpoint(body.endpoint);
  if (!endpoint) return null;

  const keys = validateKeys(body.keys);
  if (!keys) return null;

  return {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  };
}
