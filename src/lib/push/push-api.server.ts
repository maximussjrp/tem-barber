import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ValidatedSubscribePayload, ValidatedUnsubscribePayload } from "./subscription-payload";
import { linkSubscriptionToPushDevice } from "./device-health.server";

export interface CustomAuthUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string;
  authLevel?: string;
  role?: string;
}

export const PUSH_SUBSCRIBE_ELIGIBLE_AUTH_LEVELS = new Set([
  "admin",
  "verified_link",
  "verified_otp",
]);

export const PUSH_DELETE_ELIGIBLE_AUTH_LEVELS = new Set([
  "admin",
  "verified_link",
  "verified_otp",
  "phone_lookup",
]);

export function isPushEligibleAuthLevel(authLevel?: string): boolean {
  if (!authLevel) return false;
  return PUSH_SUBSCRIBE_ELIGIBLE_AUTH_LEVELS.has(authLevel);
}

export function isPushDeleteEligibleAuthLevel(authLevel?: string): boolean {
  if (!authLevel) return false;
  return PUSH_DELETE_ELIGIBLE_AUTH_LEVELS.has(authLevel);
}

export async function getAuthenticatedPushSession() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return { session: null, user: null };
  }
  const user = session.user as CustomAuthUser;
  if (!user.id || typeof user.id !== "string" || user.id.trim() === "") {
    return { session: null, user: null };
  }
  return { session, user };
}

export function validateCanonicalOrigin(req: Request): {
  valid: boolean;
  statusCode: number;
  errorCode?: string;
} {
  const rawNextAuthUrl = process.env.NEXTAUTH_URL;
  if (!rawNextAuthUrl || typeof rawNextAuthUrl !== "string") {
    return { valid: false, statusCode: 500, errorCode: "INTERNAL_ERROR" };
  }

  let canonicalOrigin: string;
  try {
    canonicalOrigin = new URL(rawNextAuthUrl).origin;
  } catch {
    return { valid: false, statusCode: 500, errorCode: "INTERNAL_ERROR" };
  }

  const requestOriginHeader = req.headers.get("origin");
  if (!requestOriginHeader || typeof requestOriginHeader !== "string") {
    return { valid: false, statusCode: 403, errorCode: "ORIGIN_NOT_ALLOWED" };
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(requestOriginHeader).origin;
  } catch {
    return { valid: false, statusCode: 403, errorCode: "ORIGIN_NOT_ALLOWED" };
  }

  if (requestOrigin !== canonicalOrigin) {
    return { valid: false, statusCode: 403, errorCode: "ORIGIN_NOT_ALLOWED" };
  }

  return { valid: true, statusCode: 200 };
}

export function isPrismaP2002Error(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export async function reconcileServerSubscription(
  userId: string,
  payload: ValidatedSubscribePayload
): Promise<{ success: boolean; conflict?: boolean; subscriptionId?: string; deviceLinked: boolean }> {
  const { endpoint, expirationTime, p256dh, auth, deviceInstanceId } = payload;

  const performConditionalWrite = async (
    snapshot: { id: string; userId: string; p256dh: string; auth: string }
  ): Promise<{ success: boolean; conflict?: boolean; retryNeeded?: boolean; subscriptionId?: string }> => {
    if (snapshot.userId === userId) {
      const res = await prisma.webPushSubscription.updateMany({
        where: {
          id: snapshot.id,
          endpoint,
          userId: snapshot.userId,
          p256dh: snapshot.p256dh,
          auth: snapshot.auth,
        },
        data: {
          p256dh,
          auth,
          expirationTime,
          failureCount: 0,
          lastFailureAt: null,
        },
      });
      if (res.count === 1) {
        return { success: true, subscriptionId: snapshot.id };
      }
      return { success: false, retryNeeded: true };
    }

    if (snapshot.p256dh === p256dh && snapshot.auth === auth) {
      // Critical Section 9: Cross-user rebind atomically clears old user's deviceId
      const res = await prisma.webPushSubscription.updateMany({
        where: {
          id: snapshot.id,
          endpoint,
          userId: snapshot.userId,
          p256dh: snapshot.p256dh,
          auth: snapshot.auth,
        },
        data: {
          userId,
          deviceId: null,
          expirationTime,
          failureCount: 0,
          lastFailureAt: null,
        },
      });
      if (res.count === 1) {
        return { success: true, subscriptionId: snapshot.id };
      }
      return { success: false, retryNeeded: true };
    }

    return { success: false, conflict: true };
  };

  let reconciledSubId: string | null = null;

  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
  });

  if (!existing) {
    try {
      const created = await prisma.webPushSubscription.create({
        data: {
          endpoint,
          userId,
          p256dh,
          auth,
          expirationTime,
          failureCount: 0,
          lastFailureAt: null,
        },
      });
      reconciledSubId = created.id;
    } catch (err: unknown) {
      if (isPrismaP2002Error(err)) {
        const reRead = await prisma.webPushSubscription.findUnique({
          where: { endpoint },
        });
        if (!reRead) {
          return { success: false, deviceLinked: false };
        }
        const outcome = await performConditionalWrite(reRead);
        if (outcome.success && outcome.subscriptionId) {
          reconciledSubId = outcome.subscriptionId;
        } else if (outcome.conflict) {
          return { success: false, conflict: true, deviceLinked: false };
        } else {
          return { success: false, deviceLinked: false };
        }
      } else {
        throw err;
      }
    }
  } else {
    const outcome = await performConditionalWrite(existing);
    if (outcome.success && outcome.subscriptionId) {
      reconciledSubId = outcome.subscriptionId;
    } else if (outcome.conflict) {
      return { success: false, conflict: true, deviceLinked: false };
    } else {
      // Single race re-read fallback
      const reRead = await prisma.webPushSubscription.findUnique({
        where: { endpoint },
      });
      if (!reRead) {
        return { success: false, deviceLinked: false };
      }

      const secondOutcome = await performConditionalWrite(reRead);
      if (secondOutcome.success && secondOutcome.subscriptionId) {
        reconciledSubId = secondOutcome.subscriptionId;
      } else if (secondOutcome.conflict) {
        return { success: false, conflict: true, deviceLinked: false };
      } else {
        return { success: false, deviceLinked: false };
      }
    }
  }

  if (!reconciledSubId) {
    return { success: false, deviceLinked: false };
  }

  // If deviceInstanceId is present, link WebPushSubscription -> PushDevice
  let deviceLinked = false;
  if (deviceInstanceId) {
    const linkRes = await linkSubscriptionToPushDevice(
      userId,
      {
        subscriptionId: reconciledSubId,
        endpoint,
        p256dh,
        auth,
      },
      deviceInstanceId
    );
    if (!linkRes.success) {
      return { success: false, deviceLinked: false };
    }
    deviceLinked = true;
  }

  return { success: true, subscriptionId: reconciledSubId, deviceLinked };
}

export async function detachServerSubscription(
  payload: ValidatedUnsubscribePayload
): Promise<void> {
  const { endpoint, p256dh, auth } = payload;
  await prisma.webPushSubscription.deleteMany({
    where: {
      endpoint,
      p256dh,
      auth,
    },
  });
}
