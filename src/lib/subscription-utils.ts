import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getActiveBillingPlan } from "@/lib/billing/plans";
import { assertCommercialConsistency, getActivePlanByCode } from "@/lib/billing/plans-db";
import {
  deriveTenantSubscriptionAccess,
  SubscriptionInput,
} from "@/lib/billing/subscription-access";

export const TRIAL_DURATION_DAYS = 14;

function isUniqueConstraintError(error: unknown): boolean {
  return (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002");
}

export function isPlatformAdmin(email?: string | null): boolean {
  if (!email) return false;

  const adminEnv = process.env.PLATFORM_ADMIN_EMAILS || "";
  const allowedEmails = adminEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowedEmails.includes(email.trim().toLowerCase());
}

export function isSubscriptionActive(sub: SubscriptionInput | null | undefined): boolean {
  return deriveTenantSubscriptionAccess(sub).accessAllowed;
}

/**
 * Retorna a assinatura do tenant pelo barbershopId.
 */
export async function getTenantSubscription(barbershopId: string) {
  if (!prisma || !prisma.tenantSubscription) {
    return null;
  }
  return await prisma.tenantSubscription.findUnique({
    where: { barbershopId },
    include: { plan: true },
  });
}

export async function createTrialSubscriptionInTransaction(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  updatedByEmailOrNow?: string | Date | null,
  now = new Date()
) {
  let updatedByEmail: string | null = null;
  let effectiveNow = now;

  if (updatedByEmailOrNow instanceof Date) {
    effectiveNow = updatedByEmailOrNow;
  } else if (typeof updatedByEmailOrNow === "string") {
    updatedByEmail = updatedByEmailOrNow;
  }

  const billingPlan = getActiveBillingPlan();
  const plan = await getActivePlanByCode(tx as any, billingPlan.code);
  assertCommercialConsistency(billingPlan, plan);

  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${barbershopId}, 0))`;
  }
  return tx.tenantSubscription.upsert({
    where: { barbershopId },
    update: {},
    create: {
      barbershopId,
      planId: plan.id,
      status: "TRIAL",
      planName: plan.name,
      monthlyPrice: plan.price,
      trialEndsAt: new Date(effectiveNow.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      gracePeriodEndsAt: null,
      updatedBy: updatedByEmail,
    },
    include: { plan: true },
  });
}

/**
 * Criação EXPLÍCITA de trial para uma barbearia.
 * Wrapper sobre createTrialSubscriptionInTransaction executado em transação Prisma.
 */
export async function createTrialSubscription(barbershopId: string, updatedByEmail?: string) {
  if (!prisma || !prisma.tenantSubscription) {
    throw new Error("Prisma Client indisponível.");
  }

  return prisma.$transaction(async (tx) => {
    return createTrialSubscriptionInTransaction(tx, barbershopId, updatedByEmail);
  });
}
