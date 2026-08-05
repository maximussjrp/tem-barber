import { ClubPlanBenefitType, ClubSubscriptionStatus, type PrismaClient } from "@prisma/client";

const VALID_PHONE_DIGITS = "23456789";

export function validTestPhone(seed: string, salt = "") {
  const input = `${seed}:${salt}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += VALID_PHONE_DIGITS[(hash + index * 17) % VALID_PHONE_DIGITS.length];
    hash = ((hash >>> 3) ^ (hash << 5)) >>> 0;
  }

  return `119${suffix}`;
}

export async function createActiveTenantSubscription(
  prisma: PrismaClient,
  barbershopId: string,
  options: { now?: Date; label?: string } = {}
) {
  const now = options.now ?? new Date();
  const plan = await prisma.plan.create({
    data: {
      name: `Plano Teste ${options.label ?? barbershopId}`,
      price: "49.90",
      maxMembers: 20,
      isActive: true,
    },
  });

  return prisma.tenantSubscription.create({
    data: {
      barbershopId,
      planId: plan.id,
      status: "ACTIVE",
      planName: plan.name,
      monthlyPrice: plan.price,
      currentPeriodStart: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function createIncludedServiceClubBenefit(
  prisma: PrismaClient,
  input: {
    barbershopId: string;
    customerId: string;
    serviceId: string;
    now?: Date;
    label?: string;
  }
) {
  const now = input.now ?? new Date();
  const clubPlan = await prisma.clubPlan.create({
    data: {
      barbershopId: input.barbershopId,
      name: `Plano Clube Teste ${input.label ?? input.serviceId}`,
      monthlyPrice: "80.00",
      shopSharePercent: "50.00",
      barberPoolPercent: "50.00",
      isActive: true,
    },
  });

  const benefit = await prisma.clubPlanBenefit.create({
    data: {
      clubPlanId: clubPlan.id,
      benefitType: ClubPlanBenefitType.INCLUDED_SERVICE,
      serviceId: input.serviceId,
      includedQty: 1,
    },
  });

  const subscription = await prisma.customerClubSubscription.create({
    data: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      clubPlanId: clubPlan.id,
      status: ClubSubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
      gracePeriodEnd: new Date(now.getTime() + 26 * 24 * 60 * 60 * 1000),
    },
  });

  return { clubPlan, benefit, subscription };
}
