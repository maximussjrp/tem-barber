import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: { barbershop: { findUnique: vi.fn() }, tenantSubscription: { findMany: vi.fn(), update: vi.fn() } },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { PUT as updateSubscriptionApi } from "@/app/api/admin/platform-subscriptions/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/platform-subscriptions", { method: "PUT", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" } });
  prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
  prismaMock.tenantSubscription.findMany.mockResolvedValue([{ id: "sub-1" }]);
  prismaMock.tenantSubscription.update.mockResolvedValue({ id: "sub-1", updatedBy: "admin@platform.com", internalNotes: "Nota" });
});

describe("Platform subscription support writes", () => {
  it("rejects unauthenticated users", async () => {
    getServerSessionMock.mockResolvedValue(null);
    expect((await updateSubscriptionApi(request({ barbershopId: "shop-1", internalNotes: "x" }))).status).toBe(401);
  });

  it("rejects non-platform users", async () => {
    getServerSessionMock.mockResolvedValue({ user: { email: "user@example.com", role: "OWNER" } });
    expect((await updateSubscriptionApi(request({ barbershopId: "shop-1", internalNotes: "x" }))).status).toBe(403);
  });

  it.each(["status", "planId", "currentPeriodStart", "currentPeriodEnd", "lastPaymentAt", "paymentMethod", "gracePeriodEndsAt", "monthlyPrice", "planName", "lastAccessPaymentId", "trialEndsAt"])("rejects financial field %s", async (field) => {
    const response = await updateSubscriptionApi(request({ barbershopId: "shop-1", [field]: "ACTIVE" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("PLATFORM_FINANCIAL_FIELDS_READ_ONLY");
    expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
  });

  it("allows internal notes only", async () => {
    const response = await updateSubscriptionApi(request({ barbershopId: "shop-1", internalNotes: "Nota de suporte" }));
    expect(response.status).toBe(200);
    expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { internalNotes: "Nota de suporte", updatedBy: "admin@platform.com" } }));
  });

  it("does not create when subscription is missing", async () => {
    prismaMock.tenantSubscription.findMany.mockResolvedValue([]);
    const response = await updateSubscriptionApi(request({ barbershopId: "shop-1", internalNotes: "x" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("SUBSCRIPTION_NOT_INITIALIZED");
  });

  it("requires reconciliation for multiple subscriptions", async () => {
    prismaMock.tenantSubscription.findMany.mockResolvedValue([{ id: "sub-1" }, { id: "sub-2" }]);
    const response = await updateSubscriptionApi(request({ barbershopId: "shop-1", internalNotes: "x" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TENANT_SUBSCRIPTION_RECONCILIATION_REQUIRED");
  });
});