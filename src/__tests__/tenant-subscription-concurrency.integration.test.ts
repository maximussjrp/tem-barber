import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTrialSubscriptionInTransaction } from "@/lib/subscription-utils";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = testDatabaseUrl && /localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) ? describe : describe.skip;

let prisma: PrismaClient;
let shopId: string;

async function createTrial() {
  return prisma.$transaction((tx) =>
    createTrialSubscriptionInTransaction(tx, shopId, new Date("2026-08-26T12:00:00.000Z"))
  );
}

describeIf("TenantSubscription real PostgreSQL concurrency", () => {
  beforeAll(async () => {
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    await prisma.plan.upsert({
      where: { code: "pro_monthly" },
      update: { name: "Plano Tem Barber", price: "49.90", period: "MONTHLY", maxMembers: 20, isActive: true },
      create: { code: "pro_monthly", name: "Plano Tem Barber", price: "49.90", period: "MONTHLY", maxMembers: 20, isActive: true },
    });
    const shop = await prisma.barbershop.create({
      data: {
        name: "Concurrency Test Shop",
        slug: `concurrency-${Date.now()}`,
        phone: "11923456789",
        zipCode: "00000-000",
        street: "Rua Teste",
        number: "1",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
      },
    });
    shopId = shop.id;
  });

  afterAll(async () => {
    await prisma.barbershop.delete({ where: { id: shopId } });
    await prisma.$disconnect();
  });

  it("duas chamadas concorrentes criam uma única subscription", async () => {
    await Promise.all([createTrial(), createTrial()]);
    expect(await prisma.tenantSubscription.count({ where: { barbershopId: shopId } })).toBe(1);
  });

  it("repetição preserva trialEndsAt e ACTIVE não vira TRIAL", async () => {
    const original = await prisma.tenantSubscription.findUnique({ where: { barbershopId: shopId } });
    expect(original).not.toBeNull();
    await createTrial();
    const repeated = await prisma.tenantSubscription.findUnique({ where: { barbershopId: shopId } });
    expect(repeated?.trialEndsAt).toEqual(original?.trialEndsAt);

    const paidEnd = new Date("2026-09-30T00:00:00.000Z");
    await prisma.tenantSubscription.update({
      where: { barbershopId: shopId },
      data: { status: "ACTIVE", currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"), currentPeriodEnd: paidEnd, lastPaymentAt: new Date("2026-08-01T00:00:00.000Z") },
    });
    await Promise.all([createTrial(), createTrial()]);
    const active = await prisma.tenantSubscription.findUnique({ where: { barbershopId: shopId } });
    expect(active?.status).toBe("ACTIVE");
    expect(active?.currentPeriodEnd).toEqual(paidEnd);
    expect(active?.lastPaymentAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });
});
