export const PUSH_DEVICE_KEY_PREFIX = "tem-barber:push-device:";

const ELIGIBLE_AUTH_LEVELS = new Set(["admin", "verified_link", "verified_otp"]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StoredDeviceIdentity {
  v: number;
  id: string;
}

export function isValidDeviceUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val.trim());
}

export function getDeviceStorageKey(userId: string): string {
  return `${PUSH_DEVICE_KEY_PREFIX}${userId}`;
}

/**
 * Retrieves the persistent device instance ID for an eligible user.
 * If missing or invalid, generates a new cryptographically random UUID v4 and persists it.
 *
 * CRITICAL FAILURE POLICY:
 * If localStorage is inaccessible or write fails, returns null.
 * NEVER returns an unpersisted/ephemeral ID to avoid creating orphan PushDevice records on every reload.
 */
export function getOrGenerateDeviceInstanceId(
  userId?: string | null,
  authLevel?: string | null
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  let storage: Storage;
  try {
    storage = window.localStorage;
    if (!storage) {
      return null;
    }
  } catch {
    // Accessing window.localStorage can throw SecurityError in restricted sandboxes
    return null;
  }

  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return null;
  }

  if (!authLevel || !ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
    return null;
  }

  const storageKey = getDeviceStorageKey(userId);

  // 1. Attempt to read and validate existing persisted ID
  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
        if (parsed && parsed.v === 1 && isValidDeviceUuid(parsed.id)) {
          return parsed.id;
        }
      } catch {
        // Corrupted JSON - will regenerate below
      }
    }
  } catch {
    // storage read failed
    return null;
  }

  // 2. Generate new random UUID v4
  let newId: string;
  try {
    if (typeof window.crypto?.randomUUID === "function") {
      newId = window.crypto.randomUUID();
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (!isValidDeviceUuid(newId)) {
    return null;
  }

  const payload: StoredDeviceIdentity = {
    v: 1,
    id: newId,
  };

  // 3. Persist and immediately verify persistence (cross-tab / storage integrity)
  try {
    storage.setItem(storageKey, JSON.stringify(payload));
    const verifiedRaw = storage.getItem(storageKey);
    if (!verifiedRaw) {
      return null;
    }
    const verified = JSON.parse(verifiedRaw) as Partial<StoredDeviceIdentity>;
    if (verified && verified.v === 1 && isValidDeviceUuid(verified.id)) {
      return verified.id;
    }
    return null;
  } catch {
    // Storage quota or write failure -> fail-open (no ephemeral device ID)
    return null;
  }
}
