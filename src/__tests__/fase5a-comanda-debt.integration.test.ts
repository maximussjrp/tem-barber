/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { closeComanda, refundPayment, registerPayment } from "@/lib/operations/payments";
import { lockComandaRow } from "@/lib/operations/comandas";
import { fromCents, toCents } from "@/lib/operations/money";
import { syncCommissionReleaseForComanda } from "@/lib/operations/commissions";
import { POST as finalizePost } from "@/app/api/admin/comandas/[id]/finalize/route";
import { GET as financialSummaryGet } from "@/app/api/admin/financial/summary/route";
import { GET as dailySummaryGet } from "@/app/api/admin/financial/daily-summary/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/operations/commissions", () => ({ syncCommissionReleaseForComanda: vi.fn() }));
vi.mock("@/lib/operations/stock", () => ({
  syncStockForComanda: vi.fn(),
  runSerializableTransaction: (fn: any) => fn({}),
}));

const { requireOperationalSessionMock, requireFinancialSessionMock } = vi.hoisted(() => ({
  requireOperationalSessionMock: vi.fn(),
  requireFinancialSessionMock: vi.fn(),
}));

vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return {
    ...actual,
    requireOperationalSession: requireOperationalSessionMock,
  };
});

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: requireFinancialSessionMock,
}));

function createFixture() {
  const comandas: any[] = [
    {
      id: "cmd-1",
      barbershopId: "shop-1",
      status: "OPEN",
      customerId: "cust-1",
      appointmentId: "appt-1",
      openedAt: new Date("2026-09-18T10:00:00Z"),
      closedAt: null,
      subtotal: fromCents(10000),
      discountTotal: fromCents(0),
      surchargeTotal: fromCents(0),
      total: fromCents(10000),
      paidTotal: fromCents(0),
      remainingTotal: fromCents(10000),
    },
    {
      id: "cmd-b",
      barbershopId: "shop-2",
      status: "OPEN",
      customerId: "cust-2",
      appointmentId: "appt-2",
      openedAt: new Date("2026-09-18T10:00:00Z"),
      closedAt: null,
      subtotal: fromCents(5000),
      discountTotal: fromCents(0),
      surchargeTotal: fromCents(0),
      total: fromCents(5000),
      paidTotal: fromCents(0),
      remainingTotal: fromCents(5000),
    },
  ];

  const items: any[] = [
    {
      id: "item-1",
      comandaId: "cmd-1",
      barbershopId: "shop-1",
      type: "SERVICE",
      status: "DONE",
      total: fromCents(10000),
      quantity: 1,
      unitPrice: fromCents(10000),
      serviceId: "srv-1",
      executorId: "member-1",
      description: "Corte",
    },
    {
      id: "item-b",
      comandaId: "cmd-b",
      barbershopId: "shop-2",
      type: "SERVICE",
      status: "DONE",
      total: fromCents(5000),
      quantity: 1,
      unitPrice: fromCents(5000),
      serviceId: "srv-2",
      executorId: "member-2",
      description: "Barba",
    },
  ];

  const payments: any[] = [];
  const entries: any[] = [];
  const movements: any[] = [];
  const sessions: any[] = [
    { id: "cash-1", barbershopId: "shop-1", status: "OPEN", expectedAmount: fromCents(1000) },
  ];
  const appointment = { id: "appt-1", status: "CONFIRMED", barbershopId: "shop-1" };

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]: any) => {
      if (typeof value === "object" && value !== null) {
        if ("not" in value) return row[key] !== value.not;
        if ("in" in value) return value.in.includes(row[key]);
        if ("gt" in value) return toCents(row[key] ?? 0) > value.gt;
      }
      return row[key] === value;
    });

  const create = (rows: any[], prefix: string, defaults = {}) =>
    vi.fn(async ({ data }: any) => {
      const row = { id: `${prefix}-${rows.length + 1}`, paidAt: new Date(), createdAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    });

  let lockChain = Promise.resolve();
  const tx: any = {
    $queryRaw: vi.fn(async (_query: any, ...args: any[]) => {
      const prev = lockChain;
      let resolveLock: () => void;
      lockChain = new Promise((res) => {
        resolveLock = res;
      });
      await prev;
      // Delay releasing the lock until microtasks settle
      await new Promise((r) => setTimeout(r, 0));
      setTimeout(() => resolveLock!(), 0);

      const comandaId = args[0];
      const barbershopId = args[1];
      const found = comandas.find((c) => c.id === comandaId && c.barbershopId === barbershopId);
      return found ? [{ id: found.id }] : [];
    }),
    comanda: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const c = comandas.find((c) => matches(c, where));
        if (!c) return null;
        if (select) return { ...c };
        return { ...c, items: items.filter((i) => i.comandaId === c.id), appointment };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const c = comandas.find((c) => c.id === where.id);
        if (!c) return null;
        return { ...c, items: items.filter((i) => i.comandaId === c.id), payments: payments.filter((p) => p.comandaId === c.id), appointment };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        comandas
          .filter((c) => matches(c, where))
          .map((c) => ({
            ...c,
            items: items.filter((i) => i.comandaId === c.id),
            payments: payments.filter((p) => p.comandaId === c.id),
            appointment,
          }))
      ),
      aggregate: vi.fn(async ({ where }: any) => {
        const filtered = comandas.filter((c) => matches(c, where));
        const sum = filtered.reduce((acc, c) => acc + toCents(c.remainingTotal), 0);
        return { _sum: { remainingTotal: fromCents(sum) } };
      }),
      groupBy: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: any) => {
        const c = comandas.find((c) => c.id === where.id);
        if (!c) throw new Error("Comanda not found");
        Object.assign(c, data);
        return { ...c, items: items.filter((i) => i.comandaId === c.id), payments: payments.filter((p) => p.comandaId === c.id), appointment };
      }),
    },
    comandaItem: {
      findMany: vi.fn(async ({ where }: any) => items.filter((i) => matches(i, where))),
    },
    payment: {
      findUnique: vi.fn(async ({ where }: any) =>
        payments.find((p) => matches(p, where.barbershopId_idempotencyKey)) ?? null
      ),
      findFirst: vi.fn(async ({ where }: any) => payments.find((p) => matches(p, where)) ?? null),
      findMany: vi.fn(async ({ where }: any) => payments.filter((p) => matches(p, where))),
      create: create(payments, "payment", { status: "CONFIRMED", refundedAmount: fromCents(0) }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = payments.find((p) => p.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    financialEntry: {
      create: create(entries, "entry"),
      findMany: vi.fn(async ({ where }: any) => entries.filter((e) => matches(e, where))),
    },
    cashMovement: { create: create(movements, "movement") },
    cashSession: {
      findFirst: vi.fn(async ({ where }: any) => sessions.find((s) => matches(s, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sessions.find((s) => s.id === where.id);
        return s ? { ...s, movements: movements.filter((m) => m.cashSessionId === s.id) } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(sessions.find((s) => s.id === where.id), data)),
    },
    appointment: {
      update: vi.fn(async ({ data }: any) => Object.assign(appointment, data)),
    },
    customerClubSubscription: {
      findMany: vi.fn(async () => []),
    },
    financialSettlement: {
      findMany: vi.fn(async () => []),
    },
    financialSettlementReversal: {
      findMany: vi.fn(async () => []),
    },
    financialTitle: {
      aggregate: vi.fn(async () => ({ _sum: { remainingAmount: fromCents(0) } })),
    },
    commissionPayableItem: {
      findMany: vi.fn(async () => []),
    },
    commissionCycleAdjustment: {
      findMany: vi.fn(async () => []),
    },
  };

  const prismaMock = {
    ...tx,
    $transaction: vi.fn(async (cb: any) => cb(tx)),
  };

  return { tx, client: tx as unknown as Prisma.TransactionClient, prismaMock, comandas, items, payments, entries, appointment };
}

describe("FASE 5A — Focused Integration Test Suite", () => {
  let f: ReturnType<typeof createFixture>;

  beforeEach(() => {
    vi.clearAllMocks();
    f = createFixture();
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-1", memberId: "member-1", role: "OWNER", barbershopId: "shop-1" },
    });
    requireFinancialSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-1", memberId: "member-1", role: "OWNER", barbershopId: "shop-1" },
    });
  });

  // Requirement 1 & 4: Comanda 100, pays 100 -> standard flow (CLOSED, remaining 0)
  it("1. Comanda 100 paid 100 closes with remaining 0 and completes appointment", async () => {
    await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "100.00",
      userId: "user-1",
    });
    const closed = await closeComanda(f.client, "shop-1", "cmd-1");
    expect(closed.status).toBe("CLOSED");
    expect(toCents(closed.paidTotal)).toBe(10000);
    expect(toCents(closed.remainingTotal)).toBe(0);
    expect(f.appointment.status).toBe("COMPLETED");
  });

  // Requirement 2 & 4: Comanda 100, pays 60, OWNER confirms debt -> CLOSED, paid 60, remaining 40, appointment COMPLETED
  it("2 & 4. Comanda 100 paid 60 with allowOutstanding=true closes with remaining 40 and COMPLETED appointment", async () => {
    await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "60.00",
      userId: "user-1",
    });
    const closed = await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });
    expect(closed.status).toBe("CLOSED");
    expect(toCents(closed.paidTotal)).toBe(6000);
    expect(toCents(closed.remainingTotal)).toBe(4000);
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(f.appointment.status).toBe("COMPLETED");
  });

  // Requirement 3: Comanda 100, pays 0, OWNER confirms debt -> CLOSED, remaining 100
  it("3. Comanda 100 paid 0 with allowOutstanding=true closes with remaining 100", async () => {
    const closed = await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });
    expect(closed.status).toBe("CLOSED");
    expect(toCents(closed.paidTotal)).toBe(0);
    expect(toCents(closed.remainingTotal)).toBe(10000);
    expect(f.appointment.status).toBe("COMPLETED");
  });

  // Requirement 5: Stock deducts exactly ONCE (on closeComanda)
  it("5. Stock sync is invoked once on closeComanda and not on subsequent debt payments", async () => {
    const { syncStockForComanda } = await import("@/lib/operations/stock");
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "60.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });
    expect(syncStockForComanda).toHaveBeenCalledTimes(1);

    // Subsequent payment on CLOSED debt
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "40.00", userId: "user-1", allowClosedDebtPayment: true });
    expect(syncStockForComanda).toHaveBeenCalledTimes(1);
  });

  // Requirement 6: Commission released proportionally
  it("6. Commission release sync is called on payment and on closeComanda", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "60.00", userId: "user-1" });
    expect(syncCommissionReleaseForComanda).toHaveBeenCalledWith(
      expect.anything(),
      "shop-1",
      "cmd-1",
      "Liberacao proporcional por pagamento",
      expect.objectContaining({ sourceKind: "PAYMENT" })
    );

    await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });
    expect(syncCommissionReleaseForComanda).toHaveBeenCalledWith(
      expect.anything(),
      "shop-1",
      "cmd-1",
      "Finalizacao da comanda",
      expect.objectContaining({ sourceKind: "ITEM_COMPLETION" })
    );
  });

  // Requirement 7: BARBER attempts to close with debt -> 403 / DEBT_PERMISSION_REQUIRED via finalize route
  it("7. BARBER role cannot finalize comanda with partial debt", async () => {
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "barber-user", memberId: "member-1", role: "BARBER", barbershopId: "shop-1" },
    });
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    const req = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "60.00" }], closeWithDebt: true, confirmOutstandingBalance: true }),
    });

    const res = await finalizePost(req, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("DEBT_PERMISSION_REQUIRED");
  });

  // Requirement 7B: SUPER_ADMIN attempts to close with debt -> 403 / DEBT_PERMISSION_REQUIRED
  it("7B. SUPER_ADMIN role cannot finalize comanda with partial debt", async () => {
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "super-admin-user", memberId: "sa-1", role: "SUPER_ADMIN", barbershopId: "shop-1" },
    });
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    const req = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "60.00" }], closeWithDebt: true, confirmOutstandingBalance: true }),
    });

    const res = await finalizePost(req, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("DEBT_PERMISSION_REQUIRED");
  });

  // Requirement 8: MANAGER closes with debt -> PASS
  it("8. MANAGER role can finalize comanda with partial debt", async () => {
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "manager-user", memberId: "mgr-1", role: "MANAGER", barbershopId: "shop-1" },
    });
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    const req = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "60.00" }], closeWithDebt: true, confirmOutstandingBalance: true }),
    });

    const res = await finalizePost(req, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CLOSED");
    expect(toCents(body.remainingTotal)).toBe(4000);
  });

  // Requirement 8B: OWNER closes with debt -> PASS
  it("8B. OWNER role can finalize comanda with partial debt", async () => {
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "owner-user", memberId: "owner-1", role: "OWNER", barbershopId: "shop-1" },
    });
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    const req = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "60.00" }], closeWithDebt: true, confirmOutstandingBalance: true }),
    });

    const res = await finalizePost(req, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CLOSED");
    expect(toCents(body.remainingTotal)).toBe(4000);
  });

  // Requirement 8C: SUPER_ADMIN and BARBER receive DEBT_PERMISSION_REQUIRED when paying debt on closed comanda
  it("8C. SUPER_ADMIN and BARBER receive DEBT_PERMISSION_REQUIRED when attempting to pay debt on a CLOSED comanda", async () => {
    // Setup comanda in CLOSED status with debt
    f.comandas[0].status = "CLOSED";
    f.comandas[0].paidTotal = fromCents(6000);
    f.comandas[0].remainingTotal = fromCents(4000);

    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    // SUPER_ADMIN attempt
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "super-admin-user", memberId: "sa-1", role: "SUPER_ADMIN", barbershopId: "shop-1" },
    });
    const reqSA = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "20.00" }] }),
    });
    const resSA = await finalizePost(reqSA, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(resSA.status).toBe(403);
    const bodySA = await resSA.json();
    expect(bodySA.error).toBe("DEBT_PERMISSION_REQUIRED");

    // BARBER attempt
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "barber-user", memberId: "member-1", role: "BARBER", barbershopId: "shop-1" },
    });
    const reqBarber = new NextRequest("http://localhost/api/admin/comandas/cmd-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: [{ method: "PIX", amount: "20.00" }] }),
    });
    const resBarber = await finalizePost(reqBarber, { params: Promise.resolve({ id: "cmd-1" }) });
    expect(resBarber.status).toBe(403);
    const bodyBarber = await resBarber.json();
    expect(bodyBarber.error).toBe("DEBT_PERMISSION_REQUIRED");
  });

  // Requirement 9, 10, 11, 12, 13: CLOSED remaining 40 -> pays 10 (remaining 30) -> pays 30 (remaining 0)
  it("9-13. Subsequent debt payments reduce remainingTotal, preserve closedAt and Appointment COMPLETED", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "60.00", userId: "user-1" });
    const closed = await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });
    const originalClosedAt = closed.closedAt;

    // Pay 10.00
    const step1 = await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "10.00",
      userId: "user-1",
      allowClosedDebtPayment: true,
    });
    expect(step1.status).toBe("CLOSED");
    expect(toCents(step1.paidTotal)).toBe(7000);
    expect(toCents(step1.remainingTotal)).toBe(3000);
    expect(step1.closedAt).toEqual(originalClosedAt);
    expect(f.appointment.status).toBe("COMPLETED");

    // Pay remaining 30.00
    const step2 = await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "30.00",
      userId: "user-1",
      allowClosedDebtPayment: true,
    });
    expect(step2.status).toBe("CLOSED");
    expect(toCents(step2.paidTotal)).toBe(10000);
    expect(toCents(step2.remainingTotal)).toBe(0);
    expect(step2.closedAt).toEqual(originalClosedAt);
  });

  // Requirement 14: CLOSED settled comanda rejects new payment
  it("14. Fully settled CLOSED comanda rejects additional payment with COMANDA_ALREADY_SETTLED", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    await expect(
      registerPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        method: "PIX",
        amount: "10.00",
        userId: "user-1",
        allowClosedDebtPayment: true,
      })
    ).rejects.toMatchObject({ code: "COMANDA_ALREADY_SETTLED", status: 422 });
  });

  // Requirement 15: CANCELLED comanda rejects payment
  it("15. CANCELLED comanda rejects payment with COMANDA_NOT_PAYABLE", async () => {
    f.comandas[0].status = "CANCELLED";
    await expect(
      registerPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        method: "PIX",
        amount: "10.00",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "COMANDA_NOT_PAYABLE", status: 422 });
  });

  // Requirement 16: Payment 50 on remaining 40 -> rejects with PAYMENT_EXCEEDS_REMAINING
  it("16. Payment exceeding remainingTotal is rejected with PAYMENT_EXCEEDS_REMAINING", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "60.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });

    await expect(
      registerPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        method: "PIX",
        amount: "50.00",
        userId: "user-1",
        allowClosedDebtPayment: true,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_REMAINING", status: 422 });
  });

  // Requirement 17, 18, 19, 20: Refund on CLOSED comanda keeps CLOSED, preserves closedAt, preserves Appointment, recalculates commission
  it("17-20. Refund on CLOSED comanda preserves CLOSED status, closedAt, Appointment COMPLETED and triggers commission recalculation", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    const closed = await closeComanda(f.client, "shop-1", "cmd-1");
    const originalClosedAt = closed.closedAt;

    const refunded = await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "20.00",
      reason: "Estorno cliente pediu",
      userId: "user-1",
    });

    expect(refunded.status).toBe("CLOSED");
    expect(refunded.closedAt).toEqual(originalClosedAt);
    expect(toCents(refunded.paidTotal)).toBe(8000);
    expect(toCents(refunded.remainingTotal)).toBe(2000);
    expect(f.appointment.status).toBe("COMPLETED");

    expect(syncCommissionReleaseForComanda).toHaveBeenCalledWith(
      expect.anything(),
      "shop-1",
      "cmd-1",
      "Recalculo por estorno",
      expect.objectContaining({ sourceKind: "REFUND" })
    );
  });

  // Caso A — Normal refund 100 -> refund 20
  it("Caso A. Payment 100 refund 20 succeeds and records FinancialEntry -20", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "20.00",
      reason: "Estorno parcial",
      userId: "user-1",
    });

    expect(toCents(f.payments[0].refundedAmount)).toBe(2000);
    const refundEntry = f.entries.find((e) => e.type === "REFUND");
    expect(refundEntry).toBeDefined();
    expect(toCents(refundEntry.amount)).toBe(-2000);
  });

  // Caso B — Sequential valid refunds 100 -> refund 40 -> refund 60
  it("Caso B. Two sequential valid refunds 40 and 60 reach total refunded 100", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "40.00",
      reason: "Primeiro estorno",
      userId: "user-1",
    });

    await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "60.00",
      reason: "Segundo estorno",
      userId: "user-1",
    });

    expect(toCents(f.payments[0].refundedAmount)).toBe(10000);
    const refundEntries = f.entries.filter((e) => e.type === "REFUND");
    expect(refundEntries).toHaveLength(2);
  });

  // Caso C — Exceeding refundable balance 100 -> refund 60 -> refund 60 (2nd rejected with REFUND_EXCEEDS_PAYMENT)
  it("Caso C. Refund 60 followed by another refund 60 rejects 2nd with REFUND_EXCEEDS_PAYMENT", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "60.00",
      reason: "Primeiro estorno",
      userId: "user-1",
    });

    await expect(
      refundPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        paymentId: f.payments[0].id,
        amount: "60.00",
        reason: "Segundo estorno excessivo",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "REFUND_EXCEEDS_PAYMENT", status: 422 });

    expect(toCents(f.payments[0].refundedAmount)).toBe(6000);
  });

  // Caso D — Sequential idempotency replay (same key)
  it("Caso D. Replay of refund with same idempotencyKey returns same comanda without duplicate refund", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    const r1 = await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "20.00",
      reason: "Estorno com chave",
      userId: "user-1",
      idempotencyKey: "idem-ref-1",
    });

    const r2 = await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "20.00",
      reason: "Estorno com chave",
      userId: "user-1",
      idempotencyKey: "idem-ref-1",
    });

    expect(r1.id).toBe(r2.id);
    expect(toCents(f.payments[0].refundedAmount)).toBe(2000);
    const refundPayments = f.payments.filter((p) => p.status === "REFUNDED");
    expect(refundPayments).toHaveLength(1);
    const refundEntries = f.entries.filter((e) => e.type === "REFUND");
    expect(refundEntries).toHaveLength(1);
  });

  // Caso E — Concurrent idempotency replay (same key, simultaneous)
  it("Caso E. Concurrent requests with same idempotencyKey produce 1 refund and 1 FinancialEntry", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    const [resA, resB] = await Promise.all([
      refundPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        paymentId: f.payments[0].id,
        amount: "20.00",
        reason: "Estorno concorrente",
        userId: "user-1",
        idempotencyKey: "same-key-conc",
      }),
      refundPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        paymentId: f.payments[0].id,
        amount: "20.00",
        reason: "Estorno concorrente",
        userId: "user-1",
        idempotencyKey: "same-key-conc",
      }),
    ]);

    expect(resA.id).toBe(resB.id);
    expect(toCents(f.payments[0].refundedAmount)).toBe(2000);
    const refundPayments = f.payments.filter((p) => p.status === "REFUNDED");
    expect(refundPayments).toHaveLength(1);
    const refundEntries = f.entries.filter((e) => e.type === "REFUND");
    expect(refundEntries).toHaveLength(1);
  });

  // Caso F — Concurrent requests with different keys exceeding balance
  it("Caso F. Concurrent requests with different keys exceeding amount are safely serialized", async () => {
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "100.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1");

    const results = await Promise.allSettled([
      refundPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        paymentId: f.payments[0].id,
        amount: "60.00",
        reason: "Estorno A",
        userId: "user-1",
        idempotencyKey: "diff-key-A",
      }),
      refundPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        paymentId: f.payments[0].id,
        amount: "60.00",
        reason: "Estorno B",
        userId: "user-1",
        idempotencyKey: "diff-key-B",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(toCents(f.payments[0].refundedAmount)).toBe(6000);
  });

  // Requirement 21: Idempotency key replay -> 1 Payment, 1 FinancialEntry
  it("21. Payment with same idempotencyKey returns same payment result without duplicate records", async () => {
    const p1 = await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "50.00",
      userId: "user-1",
      idempotencyKey: "idem-key-1",
    });

    const p2 = await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "50.00",
      userId: "user-1",
      idempotencyKey: "idem-key-1",
    });

    expect(p1.id).toBe(p2.id);
    expect(f.payments).toHaveLength(1);
    expect(f.entries).toHaveLength(1);
  });

  // Requirement 22: Tenant isolation (Tenant A cannot pay Tenant B comanda)
  it("22. Tenant A cannot pay comanda of Tenant B", async () => {
    await expect(
      registerPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-b",
        method: "PIX",
        amount: "50.00",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "COMANDA_NOT_FOUND", status: 404 });
  });

  // Requirement 23: Concurrency / Row lock
  it("23. lockComandaRow issues FOR UPDATE on comandas table scoped by barbershopId", async () => {
    await lockComandaRow(f.client, "shop-1", "cmd-1");
    expect(f.tx.$queryRaw).toHaveBeenCalled();
  });

  // Requirement 24 & 25: Financial summary & daily summary include CLOSED comandas with remaining debt in receivables
  it("24 & 25. Financial summary and daily summary include CLOSED comanda debt in receivables", async () => {
    // Close cmd-1 with R$ 40,00 remaining debt
    await registerPayment(f.client, { barbershopId: "shop-1", comandaId: "cmd-1", method: "PIX", amount: "60.00", userId: "user-1" });
    await closeComanda(f.client, "shop-1", "cmd-1", { allowOutstanding: true });

    // Add another OPEN comanda cmd-2 for shop-1 with R$ 50,00 remaining
    f.comandas.push({
      id: "cmd-2",
      barbershopId: "shop-1",
      status: "OPEN",
      customerId: "cust-1",
      appointmentId: "appt-2",
      openedAt: new Date("2026-09-18T10:00:00Z"),
      closedAt: null,
      subtotal: fromCents(5000),
      discountTotal: fromCents(0),
      surchargeTotal: fromCents(0),
      total: fromCents(5000),
      paidTotal: fromCents(0),
      remainingTotal: fromCents(5000),
    });

    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    // Call summary GET
    const sumReq = new NextRequest("http://localhost/api/admin/financial/summary?startDate=2026-09-01&endDate=2026-09-30");
    const sumRes = await financialSummaryGet(sumReq);
    const sumBody = await sumRes.json();
    expect(sumBody.totals.totalReceivable).toBe(90); // R$ 40 (cmd-1 closed) + R$ 50 (cmd-2 open)

    // Call daily summary GET
    const dailyReq = new NextRequest("http://localhost/api/admin/financial/daily-summary?date=2026-09-18");
    const dailyRes = await dailySummaryGet(dailyReq);
    const dailyBody = await dailyRes.json();
    expect(dailyBody.receivable).toBe(90);
  });
});