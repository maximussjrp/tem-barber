import "server-only";

import prisma from "@/lib/prisma";
import { Notification } from "@prisma/client";
import { configureWebPush } from "./web-push.server";

export type DeliveryClassification =
  | "SUCCESS"
  | "INVALID_SUBSCRIPTION"
  | "RATE_LIMITED"
  | "RATE_LIMITED_DEFERRED"
  | "RETRYABLE_SERVER"
  | "RETRYABLE_NETWORK"
  | "CONFIG_ERROR"
  | "CONFIG_OR_AUTH_ERROR"
  | "OTHER_PERMANENT"
  | "INTERNAL_PAYLOAD_ERROR"
  | "NO_SUBSCRIPTIONS"
  | "STORAGE_ERROR"
  | "METADATA_STALE";

export interface DeviceDeliveryResult {
  subscriptionId: string;
  classification: DeliveryClassification;
  attempts: number;
}

export interface NotificationDeliveryResult {
  notificationId: string;
  recipientUserId: string;
  deviceCount: number;
  results: DeviceDeliveryResult[];
}

const ALLOWED_TARGETS = new Set([
  "MEMBER_AGENDA",
  "CLIENT_APPOINTMENTS",
  "WAITLIST",
]);

interface SubscriptionSnapshot {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
}

/**
 * Parses HTTP Retry-After header (either seconds integer or HTTP-date string).
 * Returns delay in seconds or null if invalid.
 */
export function parseRetryAfterHeader(headerValue?: string | null): number | null {
  if (!headerValue || typeof headerValue !== "string") return null;
  const trimmed = headerValue.trim();

  // Try integer seconds
  const seconds = Number(trimmed);
  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds;
  }

  // Try HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diffSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSeconds >= 0 ? diffSeconds : 0;
  }

  return null;
}

function getEventTtlAndUrgency(type: string): { TTL: number; urgency: "high" | "normal" } {
  switch (type) {
    case "WAITLIST_CALLED":
      return { TTL: 300, urgency: "high" };
    case "APPOINTMENT_CANCELLED_BY_CUSTOMER":
    case "APPOINTMENT_CANCELLED_BY_STAFF":
      return { TTL: 3600, urgency: "high" };
    case "APPOINTMENT_CREATED":
    default:
      return { TTL: 3600, urgency: "normal" };
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delivers a single logical Notification to all WebPushSubscription rows for the recipient user.
 */
export async function deliverSingleNotification(
  notification: Notification
): Promise<NotificationDeliveryResult> {
  const recipientUserId = notification.userId;

  // 1. Validate Payload Bounds
  const title = notification.title?.trim() ?? "";
  const body = notification.content?.trim() ?? "";
  const target = notification.target?.trim() ?? "";
  const tag = `tem-barber:${notification.id}`;

  if (
    title.length < 1 ||
    title.length > 80 ||
    body.length < 1 ||
    body.length > 180 ||
    tag.length < 1 ||
    tag.length > 128 ||
    !ALLOWED_TARGETS.has(target)
  ) {
    return {
      notificationId: notification.id,
      recipientUserId,
      deviceCount: 0,
      results: [
        {
          subscriptionId: "none",
          classification: "INTERNAL_PAYLOAD_ERROR",
          attempts: 0,
        },
      ],
    };
  }

  const payloadString = JSON.stringify({
    v: 1,
    title,
    body,
    tag,
    target,
  });

  // 2. Query Subscriptions (NO fictional active column check!)
  let subscriptions: SubscriptionSnapshot[] = [];
  try {
    const rows = await prisma.webPushSubscription.findMany({
      where: { userId: recipientUserId },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        expirationTime: true,
      },
    });
    subscriptions = rows;
  } catch {
    return {
      notificationId: notification.id,
      recipientUserId,
      deviceCount: 0,
      results: [
        {
          subscriptionId: "none",
          classification: "STORAGE_ERROR",
          attempts: 0,
        },
      ],
    };
  }

  if (subscriptions.length === 0) {
    return {
      notificationId: notification.id,
      recipientUserId,
      deviceCount: 0,
      results: [
        {
          subscriptionId: "none",
          classification: "NO_SUBSCRIPTIONS",
          attempts: 0,
        },
      ],
    };
  }

  // 3. Configure web-push wrapper
  let webpushModule: ReturnType<typeof configureWebPush>;
  try {
    webpushModule = configureWebPush();
  } catch {
    // Config failure: return CONFIG_ERROR without deleting subscriptions or mutating metadata
    return {
      notificationId: notification.id,
      recipientUserId,
      deviceCount: subscriptions.length,
      results: subscriptions.map((s) => ({
        subscriptionId: s.id,
        classification: "CONFIG_ERROR",
        attempts: 0,
      })),
    };
  }

  const { TTL, urgency } = getEventTtlAndUrgency(notification.type);
  const options = {
    TTL,
    urgency,
    timeout: 5000,
  };

  // 4. Fanout to all devices independently via Promise.allSettled
  const devicePromises = subscriptions.map(async (snapshot): Promise<DeviceDeliveryResult> => {
    const pushSubscription = {
      endpoint: snapshot.endpoint,
      keys: {
        p256dh: snapshot.p256dh,
        auth: snapshot.auth,
      },
    };

    let attempts = 0;
    const maxAttempts = 3;
    let finalClassification: DeliveryClassification = "OTHER_PERMANENT";

    while (attempts < maxAttempts) {
      attempts++;
      try {
        await webpushModule.sendNotification(
          pushSubscription,
          payloadString,
          options
        );
        finalClassification = "SUCCESS";
        break;
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : null;

        if (statusCode === 404 || statusCode === 410) {
          finalClassification = "INVALID_SUBSCRIPTION";
          break; // Terminal
        }

        if (statusCode === 401 || statusCode === 403) {
          finalClassification = "CONFIG_OR_AUTH_ERROR";
          break; // Terminal
        }

        if (statusCode === 429) {
          const headers =
            err && typeof err === "object" && "headers" in err
              ? (err as { headers?: Record<string, string> }).headers
              : undefined;
          const retryAfterHeader =
            headers?.["retry-after"] || headers?.["Retry-After"];
          const retrySeconds = parseRetryAfterHeader(retryAfterHeader);

          if (retrySeconds !== null && retrySeconds > 5) {
            finalClassification = "RATE_LIMITED_DEFERRED";
            break; // Exceeds 5s immediate threshold
          }

          finalClassification = "RATE_LIMITED";
          if (attempts < maxAttempts) {
            const delayMs =
              retrySeconds !== null && retrySeconds <= 5
                ? retrySeconds * 1000
                : attempts === 1
                ? 250
                : 1000;
            await sleep(delayMs);
            continue;
          }
          break;
        }

        if (statusCode && statusCode >= 500 && statusCode <= 599) {
          finalClassification = "RETRYABLE_SERVER";
          if (attempts < maxAttempts) {
            await sleep(attempts === 1 ? 250 : 1000);
            continue;
          }
          break;
        }

        // Network or Socket timeout
        const errName = (err as Error)?.name ?? "";
        const errCode = (err as { code?: string })?.code ?? "";
        if (
          errName.includes("Timeout") ||
          errCode.includes("TIMEOUT") ||
          errCode.includes("ECONN") ||
          errCode.includes("ENOTFOUND") ||
          !statusCode
        ) {
          finalClassification = "RETRYABLE_NETWORK";
          if (attempts < maxAttempts) {
            await sleep(attempts === 1 ? 250 : 1000);
            continue;
          }
          break;
        }

        finalClassification = "OTHER_PERMANENT";
        break;
      }
    }

    // 5. Update Exact Subscription Snapshot Metadata
    const exactWhere = {
      id: snapshot.id,
      userId: snapshot.userId,
      endpoint: snapshot.endpoint,
      p256dh: snapshot.p256dh,
      auth: snapshot.auth,
    };

    if (finalClassification === "SUCCESS") {
      const now = new Date();
      try {
        const updateRes = await prisma.webPushSubscription.updateMany({
          where: exactWhere,
          data: {
            lastSuccessfulAt: now,
            failureCount: 0,
            lastFailureAt: null,
          },
        });
        if (updateRes.count === 0) {
          finalClassification = "METADATA_STALE";
        }
      } catch {
        // Contained DB error
      }
    } else if (finalClassification === "INVALID_SUBSCRIPTION") {
      try {
        await prisma.webPushSubscription.deleteMany({
          where: exactWhere,
        });
      } catch {
        // Contained DB error
      }
    } else if (
      finalClassification === "RATE_LIMITED" ||
      finalClassification === "RATE_LIMITED_DEFERRED" ||
      finalClassification === "RETRYABLE_SERVER" ||
      finalClassification === "RETRYABLE_NETWORK" ||
      finalClassification === "OTHER_PERMANENT"
    ) {
      const now = new Date();
      try {
        await prisma.webPushSubscription.updateMany({
          where: exactWhere,
          data: {
            failureCount: { increment: 1 },
            lastFailureAt: now,
          },
        });
      } catch {
        // Contained DB error
      }
    }
    // Note: CONFIG_ERROR, CONFIG_OR_AUTH_ERROR (401/403), and INTERNAL_PAYLOAD_ERROR
    // intentionally do NOT mutate device failure metadata.

    return {
      subscriptionId: snapshot.id,
      classification: finalClassification,
      attempts,
    };
  });

  const settled = await Promise.allSettled(devicePromises);
  const results: DeviceDeliveryResult[] = settled.map((res, i) => {
    if (res.status === "fulfilled") {
      return res.value;
    }
    return {
      subscriptionId: subscriptions[i]?.id ?? "unknown",
      classification: "OTHER_PERMANENT",
      attempts: 1,
    };
  });

  return {
    notificationId: notification.id,
    recipientUserId,
    deviceCount: subscriptions.length,
    results,
  };
}

/**
 * Delivers a batch of logical Notifications created in post-commit handlers.
 */
export async function deliverCreatedNotifications(
  notifications: Notification[]
): Promise<NotificationDeliveryResult[]> {
  if (!notifications || notifications.length === 0) {
    return [];
  }

  const results: NotificationDeliveryResult[] = [];
  for (const notif of notifications) {
    const res = await deliverSingleNotification(notif);
    results.push(res);
  }
  return results;
}
