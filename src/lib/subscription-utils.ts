import prisma from "@/lib/prisma";
import {
  deriveTenantSubscriptionAccess,
  SubscriptionInput,
} from "@/lib/billing/subscription-access";

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
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 dias
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
