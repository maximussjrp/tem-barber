import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { tenantSubscription: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { createTrialSubscriptionInTransaction, getTenantSubscription } from "@/lib/subscription-utils";

const transaction = {
  plan: { findMany: vi.fn() },
  tenantSubscription: { upsert: vi.fn() },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  transaction.plan.findMany.mockResolvedValue([{ id: "plan-1", name: "Plano Tem Barber", price: 49.9, period: "MONTHLY", isActive: true }]);
  transaction.tenantSubscription.upsert.mockResolvedValue({ id: "sub-1", status: "TRIAL" });
  prismaMock.tenantSubscription.findUnique.mockResolvedValue({ id: "sub-1" });
});

describe("TenantSubscription uniqueness preparation", () => {
  it("uses the unique barbershop lookup", async () => {
    await getTenantSubscription("shop-1");
    expect(prismaMock.tenantSubscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: "shop-1" } })
    );
  });

  it("uses an upsert that does not overwrite an existing entitlement", async () => {
    await createTrialSubscriptionInTransaction(transaction, "shop-1", new Date("2026-08-26T12:00:00.000Z"));
    expect(transaction.tenantSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: "shop-1" }, update: {} })
    );
  });
});
