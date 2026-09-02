import "server-only";

import prisma from "@/lib/prisma";
import { Prisma, PushDevice } from "@prisma/client";

export type PlatformEnum =
  | "ANDROID"
  | "IOS"
  | "WINDOWS"
  | "MACOS"
  | "LINUX"
  | "CHROMEOS"
  | "OTHER";

export type BrowserEnum =
  | "CHROME"
  | "EDGE"
  | "SAFARI"
  | "FIREFOX"
  | "OTHER";

export type DeviceClassEnum =
  | "MOBILE"
  | "TABLET"
  | "DESKTOP"
  | "OTHER";

export type NotificationPermissionEnum =
  | "GRANTED"
  | "DENIED"
  | "PROMPT"
  | "UNAVAILABLE";

export type PushPermissionEnum =
  | "GRANTED"
  | "DENIED"
  | "PROMPT"
  | "UNAVAILABLE";

export type ServiceWorkerStateEnum =
  | "UNSUPPORTED"
  | "REGISTRATION_MISSING"
  | "INSTALLING"
  | "WAITING"
  | "ACTIVE"
  | "REDUNDANT"
  | "UNKNOWN";

export type LocalReadinessEnum =
  | "UNSUPPORTED"
  | "IOS_INSTALL_REQUIRED"
  | "PERMISSION_PROMPT"
  | "PERMISSION_DENIED"
  | "LOCAL_SUBSCRIPTION_MISSING"
  | "READY";

export interface ValidatedDeviceHealthPayload {
  deviceInstanceId: string;
  platform: PlatformEnum;
  browser: BrowserEnum;
  deviceClass: DeviceClassEnum;
  notificationPermission: NotificationPermissionEnum;
  pushPermission: PushPermissionEnum;
  serviceWorkerState: ServiceWorkerStateEnum;
  localSubscriptionPresent: boolean;
  isStandalone: boolean;
}

export interface ReconciledSubscriptionSnapshot {
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function isPrismaP2002Error(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export function isPrismaRetryableConcurrencyError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2034" || err.code === "P2002")
  );
}

/**
 * Derives user-friendly display name from server-validated bounded platform and browser enums.
 * Arbitrary client strings are never accepted.
 */
export function deriveDeviceDisplayName(
  platform: PlatformEnum,
  browser: BrowserEnum
): string {
  const browserNames: Record<BrowserEnum, string> = {
    CHROME: "Chrome",
    EDGE: "Edge",
    SAFARI: "Safari",
    FIREFOX: "Firefox",
    OTHER: "Navegador",
  };

  const platformNames: Record<PlatformEnum, string> = {
    ANDROID: "Android",
    IOS: "iPhone/iPad",
    WINDOWS: "Windows",
    MACOS: "Mac",
    LINUX: "Linux",
    CHROMEOS: "ChromeOS",
    OTHER: "Dispositivo",
  };

  const b = browserNames[browser] || "Navegador";
  const p = platformNames[platform] || "Dispositivo";

  return `${b} no ${p}`;
}

/**
 * Computes canonical localReadiness server-side from bounded telemetry.
 * Precedence:
 * A. Unsupported capability / SW unsupported -> UNSUPPORTED
 * B. iOS not installed standalone -> IOS_INSTALL_REQUIRED
 * C. Notification DENIED or Push DENIED -> PERMISSION_DENIED
 * D. Notification PROMPT or Push PROMPT -> PERMISSION_PROMPT
 * E. Notification GRANTED: pushPermission must be GRANTED or UNAVAILABLE
 * F. SW ACTIVE and localSubscriptionPresent -> READY, otherwise LOCAL_SUBSCRIPTION_MISSING
 */
export function deriveServerLocalReadiness(
  payload: ValidatedDeviceHealthPayload
): LocalReadinessEnum {
  // A. Unsupported capability / SW unsupported
  if (payload.serviceWorkerState === "UNSUPPORTED") {
    return "UNSUPPORTED";
  }

  // B. iOS not installed standalone
  if (payload.platform === "IOS" && payload.isStandalone === false) {
    return "IOS_INSTALL_REQUIRED";
  }

  // C. Notification DENIED or Push DENIED
  if (payload.notificationPermission === "DENIED" || payload.pushPermission === "DENIED") {
    return "PERMISSION_DENIED";
  }

  // D. Notification PROMPT or Push PROMPT
  if (payload.notificationPermission === "PROMPT" || payload.pushPermission === "PROMPT") {
    return "PERMISSION_PROMPT";
  }

  // E & F. Notification must be GRANTED
  if (payload.notificationPermission === "GRANTED") {
    if (payload.serviceWorkerState !== "ACTIVE" || !payload.localSubscriptionPresent) {
      return "LOCAL_SUBSCRIPTION_MISSING";
    }
    return "READY";
  }

  return "UNSUPPORTED";
}

/**
 * Resolves an existing PushDevice or creates a shell row using composite unique (userId, deviceInstanceId).
 * Bounded single-reread concurrency on P2002.
 * Does NOT fabricate telemetry fields during shell creation.
 */
export async function resolveOrCreatePushDevice(
  userId: string,
  deviceInstanceId: string
): Promise<PushDevice> {
  try {
    const existing = await prisma.pushDevice.findUnique({
      where: {
        userId_deviceInstanceId: {
          userId,
          deviceInstanceId,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return await prisma.pushDevice.create({
      data: {
        userId,
        deviceInstanceId,
      },
    });
  } catch (err: unknown) {
    if (isPrismaP2002Error(err)) {
      // Bounded single reread on unique race
      const reRead = await prisma.pushDevice.findUnique({
        where: {
          userId_deviceInstanceId: {
            userId,
            deviceInstanceId,
          },
        },
      });
      if (reRead) {
        return reRead;
      }
    }
    throw err;
  }
}

/**
 * Processes an authenticated device health report.
 * Strictly uses server now() timestamps for lastSeenAt and lastHealthCheckAt.
 */
export async function recordDeviceHealthReport(
  userId: string,
  payload: ValidatedDeviceHealthPayload
): Promise<{ success: boolean; deviceId: string }> {
  const device = await resolveOrCreatePushDevice(userId, payload.deviceInstanceId);

  const displayName = deriveDeviceDisplayName(payload.platform, payload.browser);
  const localReadiness = deriveServerLocalReadiness(payload);
  const serverNow = new Date();

  const updated = await prisma.pushDevice.update({
    where: { id: device.id },
    data: {
      platform: payload.platform,
      browser: payload.browser,
      deviceClass: payload.deviceClass,
      displayName,
      localReadiness,
      notificationPermission: payload.notificationPermission,
      pushPermission: payload.pushPermission,
      serviceWorkerState: payload.serviceWorkerState,
      lastSeenAt: serverNow,
      lastHealthCheckAt: serverNow,
    },
  });

  return { success: true, deviceId: updated.id };
}

/**
 * Links a safely-reconciled WebPushSubscription to a PushDevice.
 *
 * Rules:
 * 1. Executes inside a single interactive transaction with Serializable isolation.
 * 2. If endpoint rotated for this device (old subscription currently linked to this device),
 *    conditionally deletes the old row using (id, userId, deviceId).
 * 3. Exact capability-guarded link of target WPS using (id, userId, endpoint, p256dh, auth).
 *    If count !== 1, throws and transaction rolls back (restoring old row).
 * 4. Touches PushDevice.lastSubscriptionReconciledAt and lastSeenAt inside the same transaction.
 * 5. Bounded retry (max 2 total attempts) for recognized concurrency conflicts (P2034, P2002).
 * 6. ZERO writes outside transaction.
 */
export async function linkSubscriptionToPushDevice(
  userId: string,
  snapshot: ReconciledSubscriptionSnapshot,
  deviceInstanceId: string
): Promise<{ success: boolean }> {
  const device = await resolveOrCreatePushDevice(userId, deviceInstanceId);

  const executeLinkTransaction = async (): Promise<boolean> => {
    const serverNow = new Date();
    await prisma.$transaction(
      async (tx) => {
        // 1. Identify any old subscription currently linked to this device
        const currentlyLinked = await tx.webPushSubscription.findFirst({
          where: {
            deviceId: device.id,
            userId,
          },
          select: { id: true },
        });

        // 2. If endpoint rotated, delete old subscription row conditionally
        if (currentlyLinked && currentlyLinked.id !== snapshot.subscriptionId) {
          await tx.webPushSubscription.deleteMany({
            where: {
              id: currentlyLinked.id,
              userId,
              deviceId: device.id,
            },
          });
        }

        // 3. Exact capability-guarded link of target subscription
        const linkResult = await tx.webPushSubscription.updateMany({
          where: {
            id: snapshot.subscriptionId,
            userId,
            endpoint: snapshot.endpoint,
            p256dh: snapshot.p256dh,
            auth: snapshot.auth,
          },
          data: {
            deviceId: device.id,
          },
        });

        if (linkResult.count !== 1) {
          throw new Error("FAILED_TO_LINK_SUBSCRIPTION");
        }

        // 4. Update PushDevice timestamps inside the same transaction
        await tx.pushDevice.update({
          where: { id: device.id },
          data: {
            lastSubscriptionReconciledAt: serverNow,
            lastSeenAt: serverNow,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    return true;
  };

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ok = await executeLinkTransaction();
      if (ok) return { success: true };
    } catch (err: unknown) {
      if (attempt < MAX_ATTEMPTS && isPrismaRetryableConcurrencyError(err)) {
        continue;
      }
      return { success: false };
    }
  }

  return { success: false };
}
