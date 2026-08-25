import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, sessionMock, registerPaymentMock } = vi.hoisted(() => ({
  prismaMock: {
    comanda: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  sessionMock: vi.fn(),
  registerPaymentMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return { ...original, requireOperationalSession: sessionMock };
});
vi.mock("@/lib/operations/payments", () => ({ registerPayment: registerPaymentMock }));
vi.mock("@/lib/operations/comandas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/comandas")>();
  return {
    ...original,
    addAdjustmentItem: vi.fn(),
    addProductItem: vi.fn(),
    addServiceItem: vi.fn(),
    upsertDiscountItem: vi.fn(),
  };
});

import { POST as pay } from "@/app/api/admin/comandas/[id]/payments/route";
import { POST as addItem } from "@/app/api/admin/comandas/[id]/items/route";

function operationalSession(role: "OWNER" | "MANAGER" | "BARBER", memberId = "barber-a") {
  return {
    error: null,
    data: { userId: `${memberId}-user`, role, memberId, barbershopId: "shop-a" },
  };
}

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) =>
    callback(prismaMock)
  );
  registerPaymentMock.mockResolvedValue({ id: "payment-1" });
});

describe("legacy comanda OWN scope on payments", () => {
  it("allows BARBER payment when the appointment belongs to the member", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));
    prismaMock.comanda.findFirst.mockResolvedValue({
      appointment: { memberId: "barber-a" },
      items: [],
    });

    const response = await pay(
      request("/api/admin/comandas/a/payments", { method: "PIX", amount: 20 }),
      context("a")
    );

    expect(response.status).toBe(201);
    expect(registerPaymentMock).toHaveBeenCalled();
  });

  it("allows BARBER payment when an item belongs to the member", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));
    prismaMock.comanda.findFirst.mockResolvedValue({
      appointment: null,
      items: [{ executorId: "barber-a" }],
    });

    const response = await pay(
      request("/api/admin/comandas/a/payments", { method: "CASH", amount: 20 }),
      context("a")
    );

    expect(response.status).toBe(201);
  });

  it("blocks BARBER payment on another barber comanda", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));
    prismaMock.comanda.findFirst.mockResolvedValue({
      appointment: { memberId: "barber-b" },
      items: [{ executorId: "barber-b" }],
    });

    const response = await pay(
      request("/api/admin/comandas/b/payments", { method: "PIX", amount: 20 }),
      context("b")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "COMANDA_SCOPE_FORBIDDEN" });
    expect(registerPaymentMock).not.toHaveBeenCalled();
  });

  it("does not grant BARBER ownership over an empty standalone comanda", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));
    prismaMock.comanda.findFirst.mockResolvedValue({ appointment: null, items: [] });

    const response = await pay(
      request("/api/admin/comandas/empty/payments", { method: "PIX", amount: 20 }),
      context("empty")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "COMANDA_SCOPE_FORBIDDEN" });
  });

  it.each(["OWNER", "MANAGER"] as const)("keeps %s TEAM payment behavior", async (role) => {
    sessionMock.mockResolvedValue(operationalSession(role, `${role.toLowerCase()}-member`));

    const response = await pay(
      request("/api/admin/comandas/team/payments", { method: "PIX", amount: 20 }),
      context("team")
    );

    expect(response.status).toBe(201);
    expect(prismaMock.comanda.findFirst).not.toHaveBeenCalled();
  });

  it("returns safe 404 when BARBER targets a cross-tenant comanda", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));
    prismaMock.comanda.findFirst.mockResolvedValue(null);

    const response = await pay(
      request("/api/admin/comandas/foreign/payments", { method: "PIX", amount: 20 }),
      context("foreign")
    );

    expect(response.status).toBe(404);
    expect(registerPaymentMock).not.toHaveBeenCalled();
  });
});

describe("temporary BARBER discount policy", () => {
  beforeEach(() => {
    prismaMock.comanda.findFirst.mockResolvedValue({
      appointment: { memberId: "barber-a" },
      items: [],
    });
  });

  it.each([
    { type: "DISCOUNT", amount: 1, description: "Manual" },
    { type: "SERVICE", serviceId: "service-1", executorId: "barber-a", discountAmount: 1 },
    { type: "PRODUCT", productId: "product-1", discountAmount: 1 },
  ])("blocks BARBER discount surface %#", async (body) => {
    sessionMock.mockResolvedValue(operationalSession("BARBER"));

    const response = await addItem(
      request("/api/admin/comandas/a/items", body),
      context("a")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "DISCOUNT_PERMISSION_REQUIRED" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "MANAGER"] as const)("does not block %s discount", async (role) => {
    sessionMock.mockResolvedValue(operationalSession(role));

    await addItem(
      request("/api/admin/comandas/a/items", {
        type: "DISCOUNT",
        amount: 1,
        description: "Autorizado",
      }),
      context("a")
    );

    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});
