import prisma from "@/lib/prisma";

export function isPlatformAdmin(email?: string | null): boolean {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  const adminEmailsEnv = process.env.PLATFORM_ADMIN_EMAILS || "max.guarinieri@gmail.com";
  const adminEmails = adminEmailsEnv.split(",").map(e => e.trim().toLowerCase());
  return adminEmails.includes(cleanEmail);
}

export function isSubscriptionActive(subscription: {
  status: string;
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  gracePeriodEndsAt?: Date | string | null;
}): boolean {
  const now = new Date();

  const toDate = (val: any) => {
    if (!val) return null;
    return val instanceof Date ? val : new Date(val);
  };

  const trialEnds = toDate(subscription.trialEndsAt);
  const periodEnd = toDate(subscription.currentPeriodEnd);
  const gracePeriodEnds = toDate(subscription.gracePeriodEndsAt);

  if (subscription.status === "TRIAL") {
    return !trialEnds || trialEnds > now;
  }

  if (subscription.status === "ACTIVE") {
    return !periodEnd || periodEnd > now;
  }

  if (subscription.status === "PAST_DUE") {
    return !!gracePeriodEnds && gracePeriodEnds > now;
  }

  return false;
}

export async function getOrCreateSubscription(barbershopId: string) {
  if (!prisma.tenantSubscription) {
    return {
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  // 1. Indempotent read first
  const subscription = await prisma.tenantSubscription.findFirst({
    where: { barbershopId },
    include: { plan: true },
  });

  if (subscription) {
    return subscription;
  }

  // 2. Fetch default plan
  let plan = await prisma.plan.findFirst();
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        name: "Plano Bronze",
        description: "Ideal para barbearias pequenas e profissionais individuais.",
        price: 49.90,
        maxMembers: 3,
        isActive: true,
      },
    });
  }

  // 3. Create new trial subscription, catching race conditions
  try {
    const newSubscription = await prisma.tenantSubscription.create({
      data: {
        barbershopId,
        planId: plan.id,
        status: "TRIAL",
        planName: plan.name,
        monthlyPrice: plan.price,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
      include: { plan: true },
    });
    return newSubscription;
  } catch (err) {
    const retrySub = await prisma.tenantSubscription.findFirst({
      where: { barbershopId },
      include: { plan: true },
    });
    if (retrySub) return retrySub;
    throw err;
  }
}
