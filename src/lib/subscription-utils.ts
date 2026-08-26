import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getActiveBillingPlan } from "@/lib/billing/plans";
import {
  deriveTenantSubscriptionAccess,
  SubscriptionInput,
} from "@/lib/billing/subscription-access";

export const TRIAL_DURATION_DAYS = 14;

export function isPlatformAdmin(email?: string | null): boolean {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  const adminEmailsEnv = process.env.PLATFORM_ADMIN_EMAILS || "max.guarinieri@gmail.com";
  const adminEmails = adminEmailsEnv.split(",").map((e) => e.trim().toLowerCase());
  return adminEmails.includes(cleanEmail);
}

export function isSubscriptionActive(subscription?: SubscriptionInput | null): boolean {
  if (process.env.DISABLE_TENANT_SUBSCRIPTION_CHECK === "true") {
    return true;
  }
  if (!subscription) return false;
  const access = deriveTenantSubscriptionAccess(subscription);
  return access.accessAllowed;
}

/**
 * Consulta somente de leitura da assinatura mais recente de uma barbearia.
 * NUNCA executa INSERT/UPDATE ou cria trials automaticamente.
 */
export async function getTenantSubscription(barbershopId: string) {
  if (!prisma || !prisma.tenantSubscription) {
    return null;
  }
  return await prisma.tenantSubscription.findFirst({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

export async function createTrialSubscriptionInTransaction(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  now = new Date()
) {
  const billingPlan = getActiveBillingPlan();
  const matchingPlans = await tx.plan.findMany({
    where: {
      name: billingPlan.name,
      price: billingPlan.value,
      period: billingPlan.cycle,
      isActive: true,
    },
    orderBy: { id: "asc" },
  });

  if (matchingPlans.length !== 1) {
    throw new Error("Plano oficial de trial nao configurado de forma univoca.");
  }

  const plan = matchingPlans[0];
  return tx.tenantSubscription.create({
    data: {
      barbershopId,
      planId: plan.id,
      status: "TRIAL",
      planName: plan.name,
      monthlyPrice: plan.price,
      trialEndsAt: new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      gracePeriodEndsAt: null,
      updatedBy: null,
    },
    include: { plan: true },
  });
}

/**
 * Criação EXPLÍCITA de trial para uma barbearia.
 * Deve ser chamada apenas após uma ação deliberada do usuário ou administrador.
 * Define currentPeriodStart = null e currentPeriodEnd = null (apenas trialEndsAt + 14 dias).
 */
export async function createTrialSubscription(barbershopId: string, updatedByEmail?: string) {
  if (!prisma || !prisma.tenantSubscription) {
    throw new Error("Prisma Client indisponível.");
  }

  const existing = await prisma.tenantSubscription.findFirst({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });

  if (existing) {
    return existing;
  }

  let plan = await prisma.plan.findFirst();
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        name: "Plano Tem Barber",
        description: "Plano completo de gestão para sua barbearia.",
        price: 49.90,
        maxMembers: 20,
        isActive: true,
      },
    });
  }

  try {
    const newSubscription = await prisma.tenantSubscription.create({
      data: {
        barbershopId,
        planId: plan.id,
        status: "TRIAL",
        planName: plan.name,
        monthlyPrice: plan.price,
        trialEndsAt: new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
        currentPeriodStart: null,
        currentPeriodEnd: null,
        updatedBy: updatedByEmail || null,
      },
      include: { plan: true },
    });
    return newSubscription;
  } catch (err) {
    const retrySub = await prisma.tenantSubscription.findFirst({
      where: { barbershopId },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
    if (retrySub) return retrySub;
    throw err;
  }
}
