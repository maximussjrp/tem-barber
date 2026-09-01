import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ValidatedSubscribePayload, ValidatedUnsubscribePayload } from "./subscription-payload";

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
): Promise<{ success: boolean; conflict?: boolean }> {
  const { endpoint, expirationTime, p256dh, auth } = payload;

  const performConditionalWrite = async (
    snapshot: { id: string; userId: string; p256dh: string; auth: string }
  ): Promise<{ success: boolean; conflict?: boolean; retryNeeded?: boolean }> => {
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
        return { success: true };
      }
      return { success: false, retryNeeded: true };
    }

    if (snapshot.p256dh === p256dh && snapshot.auth === auth) {
      const res = await prisma.webPushSubscription.updateMany({
        where: {
          id: snapshot.id,
          endpoint,
          userId: snapshot.userId,
          p256dh,
          auth,
        },
        data: {
          userId,
          expirationTime,
          failureCount: 0,
          lastFailureAt: null,
        },
      });
      if (res.count === 1) {
        return { success: true };
      }
      return { success: false, retryNeeded: true };
    }

    return { success: false, conflict: true };
  };

  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
  });

  if (!existing) {
    try {
      await prisma.webPushSubscription.create({
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
      return { success: true };
    } catch (err: unknown) {
      if (isPrismaP2002Error(err)) {
        const reRead = await prisma.webPushSubscription.findUnique({
          where: { endpoint },
        });
        if (!reRead) {
          return { success: false };
        }
        const outcome = await performConditionalWrite(reRead);
        if (outcome.success) return { success: true };
        if (outcome.conflict) return { success: false, conflict: true };
        return { success: false };
      }
      throw err;
    }
  }

  const outcome = await performConditionalWrite(existing);
  if (outcome.success) return { success: true };
  if (outcome.conflict) return { success: false, conflict: true };

  // Single race re-read fallback
  const reRead = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
  });
  if (!reRead) {
    return { success: false };
  }

  const secondOutcome = await performConditionalWrite(reRead);
  if (secondOutcome.success) return { success: true };
  if (secondOutcome.conflict) return { success: false, conflict: true };

  return { success: false };
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
