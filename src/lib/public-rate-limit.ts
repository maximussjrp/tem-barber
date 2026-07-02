type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

type ConsumeRateLimitInput = {
  bucket: string;
  key: string;
  max: number;
  windowMs: number;
};

type ConsumeRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __temBarberRateLimitStore: Map<string, RateLimitEntry> | undefined;
}

function getStore() {
  if (!globalThis.__temBarberRateLimitStore) {
    globalThis.__temBarberRateLimitStore = new Map<string, RateLimitEntry>();
  }
  return globalThis.__temBarberRateLimitStore;
}

function buildStoreKey(bucket: string, key: string) {
  return `${bucket}:${key}`;
}

function cleanupExpiredEntries(nowMs: number, store: Map<string, RateLimitEntry>) {
  for (const [storeKey, entry] of store.entries()) {
    if (entry.resetAtMs <= nowMs) {
      store.delete(storeKey);
    }
  }
}

export function resolveClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);

    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export function consumeRateLimit(input: ConsumeRateLimitInput): ConsumeRateLimitResult {
  const nowMs = Date.now();
  const store = getStore();

  if (store.size > 10_000) {
    cleanupExpiredEntries(nowMs, store);
  }

  const storeKey = buildStoreKey(input.bucket, input.key);
  const current = store.get(storeKey);

  if (!current || current.resetAtMs <= nowMs) {
    const resetAtMs = nowMs + input.windowMs;
    store.set(storeKey, { count: 1, resetAtMs });

    return {
      allowed: true,
      remaining: Math.max(0, input.max - 1),
      retryAfterSeconds: Math.max(1, Math.ceil(input.windowMs / 1000)),
    };
  }

  if (current.count >= input.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000)),
    };
  }

  current.count += 1;
  store.set(storeKey, current);

  return {
    allowed: true,
    remaining: Math.max(0, input.max - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000)),
  };
}

export function resetRateLimitStore() {
  getStore().clear();
}
