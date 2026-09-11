/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { closeComanda, refundPayment, registerPayment } from "@/lib/operations/payments";
import { fromCents, toCents } from "@/lib/operations/money";
import { registerManualClubSubscriptionPayment } from "@/lib/operations/club";
import { syncCommissionReleaseForComanda } from "@/lib/operations/commissions";

// Only the commission domain is isolated. Payments, totals and cash arithmetic
// execute production code. This repository double does NOT prove DB rollback,
// foreign keys, uniqueness or concurrency; those belong to PostgreSQL tests.
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/operations/commissions", () => ({ syncCommissionReleaseForComanda: vi.fn() }));

function fixture() {
  const comandas: any[] = [
    { id: "command-a", barbershopId: "shop-a", status: "OPEN", customerId: null, appointmentId: "appointment-a", closedAt: null, openedAt: new Date(), paidTotal: fromCents(0), remainingTotal: fromCents(10100) },
    { id: "command-b", barbershopId: "shop-b", status: "OPEN", customerId: null, closedAt: null, openedAt: new Date(), paidTotal: fromCents(0), remainingTotal: fromCents(10100) },
  ];
  const items = comandas.map(c => ({ id: `item-${c.id}`, comandaId: c.id, barbershopId: c.barbershopId, type: "SERVICE", status: "DONE", total: fromCents(10100) }));
  const payments: any[] = [], entries: any[] = [], movements: any[] = [];
  const sessions: any[] = [{ id: "cash-a", barbershopId: "shop-a", status: "OPEN", openingAmount: fromCents(1000), expectedAmount: fromCents(1000) }];
  const appointment = { id: "appointment-a", status: "CONFIRMED" };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) =>
    typeof value === "object" && value !== null ? row[key] !== value.not : row[key] === value);
  const create = (rows: any[], prefix: string, defaults = {}) => vi.fn(async ({ data }: any) => {
    const row = { id: `${prefix}-${rows.length + 1}`, ...defaults, ...data };
    rows.push(row);
    return row;
  });
  const tx = {
    comanda: {
      findFirst: vi.fn(async ({ where }: any) => { const c = comandas.find(c => matches(c, where)); return c ? { ...c, items: items.filter(i => i.comandaId === c.id) } : null; }),
      findUnique: vi.fn(async ({ where }: any) => comandas.find(c => c.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(comandas.find(c => c.id === where.id), data)),
    },
    comandaItem: { findMany: vi.fn(async ({ where }: any) => items.filter(i => matches(i, where))) },
    payment: {
      findUnique: vi.fn(async ({ where }: any) => payments.find(p => matches(p, where.barbershopId_idempotencyKey)) ?? null),
      findFirst: vi.fn(async ({ where }: any) => payments.find(p => matches(p, where)) ?? null),
      findMany: vi.fn(async ({ where }: any) => payments.filter(p => matches(p, where))),
      create: create(payments, "payment", { status: "CONFIRMED", refundedAmount: fromCents(0) }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(payments.find(p => p.id === where.id), data)),
    },
    financialEntry: { create: create(entries, "entry") },
    cashMovement: { create: create(movements, "movement") },
    cashSession: {
      findFirst: vi.fn(async ({ where }: any) => sessions.find(s => matches(s, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => { const s = sessions.find(s => s.id === where.id); return s ? { ...s, movements: movements.filter(m => m.cashSessionId === s.id) } : null; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(sessions.find(s => s.id === where.id), data)),
    },
    appointment: { update: vi.fn(async ({ data }: any) => Object.assign(appointment, data)) },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient, comandas, payments, entries, movements, sessions, appointment };
}

describe("Phase 0: current payment, refund and physical cash contracts", () => {
  let db: ReturnType<typeof fixture>;
  beforeEach(() => { db = fixture(); });
  const input = { barbershopId: "shop-a", comandaId: "command-a", userId: "user-a", amount: "101.00", idempotencyKey: "payment-key" };
  const pay = (method: PaymentMethod = "PIX", overrides = {}) => registerPayment(db.client, { ...input, method, ...overrides });
  const refund = (overrides = {}) => refundPayment(db.client, { barbershopId: "shop-a", comandaId: "command-a", paymentId: db.payments[0].id, userId: "user-a", amount: "10.10", reason: "Baseline refund", idempotencyKey: "refund-key", ...overrides });

  it.each(["CASH", "PIX", "DEBIT", "CREDIT", "OTHER"] as const)("%s creates one linked revenue; retry creates no duplicate effects", async method => {
    await pay(method);
    await pay(method);
    expect(db.payments).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]).toMatchObject({ barbershopId: "shop-a", comandaId: "command-a", paymentId: db.payments[0].id, type: "COMMAND_REVENUE", category: method, amount: fromCents(10100) });
    expect(db.payments[0]).toMatchObject({ barbershopId: "shop-a", method, amount: fromCents(10100), status: "CONFIRMED" });
    expect(db.movements).toHaveLength(method === "CASH" ? 1 : 0);
    expect(toCents(db.sessions[0].expectedAmount)).toBe(method === "CASH" ? 11100 : 1000);
    if (method === "CASH") expect(db.movements[0]).toMatchObject({ barbershopId: "shop-a", cashSessionId: "cash-a", paymentId: db.payments[0].id, amount: fromCents(10100) });
  });

  it("partial payment preserves OPEN and close rejects the outstanding balance", async () => {
    const partial = await pay("PIX", { amount: "10.10" });
    expect(toCents(partial.paidTotal)).toBe(1010);
    expect(toCents(partial.remainingTotal)).toBe(9090);
    expect(partial.status).toBe("OPEN");
    await expect(closeComanda(db.client, "shop-a", "command-a")).rejects.toMatchObject({ code: "COMANDA_NOT_PAID", status: 422, message: "Comanda ainda possui valor em aberto." });
    expect(db.comandas[0].closedAt).toBeNull();
    expect(db.appointment.status).toBe("CONFIRMED");
  });

  it("full payment requires explicit close, which completes the linked appointment", async () => {
    await pay();
    expect(db.comandas[0].status).toBe("OPEN");
    const closed = await closeComanda(db.client, "shop-a", "command-a");
    expect(closed.status).toBe("CLOSED");
    expect(toCents(closed.paidTotal)).toBe(10100);
    expect(toCents(closed.remainingTotal)).toBe(0);
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(db.appointment.status).toBe("COMPLETED");
    await closeComanda(db.client, "shop-a", "command-a");
    expect(db.payments).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
  });

  it("mixed payment methods sum exactly to the command balance", async () => {
    await pay("CASH", { amount: "10.10", idempotencyKey: "cash-part" });
    await pay("PIX", { amount: "90.90", idempotencyKey: "pix-part" });
    await closeComanda(db.client, "shop-a", "command-a");
    expect(db.payments.map(p => p.method)).toEqual(["CASH", "PIX"]);
    expect(db.payments.reduce((sum, p) => sum + toCents(p.amount), 0)).toBe(10100);
    expect(db.entries.map(e => [e.paymentId, e.category, toCents(e.amount)])).toEqual([[db.payments[0].id, "CASH", 1010], [db.payments[1].id, "PIX", 9090]]);
    expect(toCents(db.comandas[0].remainingTotal)).toBe(0);
    expect(toCents(db.sessions[0].expectedAmount)).toBe(2010);
  });

  it("CASH requires an OPEN session of the same tenant before any writes", async () => {
    db.sessions[0].barbershopId = "shop-b";
    await expect(pay("CASH")).rejects.toMatchObject({ code: "CASH_SESSION_REQUIRED", status: 422 });
    expect(db.payments).toHaveLength(0);
    expect(db.entries).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
  });

  it.each(["PIX", "CASH"] as const)("%s refund preserves original, records negatives once and reopens CLOSED", async method => {
    await pay(method);
    await closeComanda(db.client, "shop-a", "command-a");
    const originalId = db.payments[0].id;
    await refund();
    await refund();
    expect(db.payments).toHaveLength(2);
    expect(db.payments[0]).toMatchObject({ id: originalId, status: "CONFIRMED", amount: fromCents(10100), refundedAmount: fromCents(1010) });
    expect(db.payments[1]).toMatchObject({ refundOfId: originalId, status: "REFUNDED", amount: fromCents(-1010), method });
    expect(db.entries).toHaveLength(2);
    expect(db.entries[1]).toMatchObject({ type: "REFUND", amount: fromCents(-1010), paymentId: db.payments[1].id, barbershopId: "shop-a" });
    expect(db.comandas[0]).toMatchObject({ status: "PENDING_PAYMENT", closedAt: null, paidTotal: fromCents(9090), remainingTotal: fromCents(1010) });
    // Current behavior: refund reopens the command, but not its appointment.
    expect(db.appointment.status).toBe("COMPLETED");
    expect(db.movements).toHaveLength(method === "CASH" ? 2 : 0);
    expect(toCents(db.sessions[0].expectedAmount)).toBe(method === "CASH" ? 10090 : 1000);
    if (method === "CASH") expect(db.movements[1]).toMatchObject({ paymentId: db.payments[1].id, amount: fromCents(-1010) });
  });

  it("CASH refund still succeeds without an open session and creates no new physical movement", async () => {
    await pay("CASH");
    db.sessions[0].status = "CLOSED";
    await refund({ amount: "101.00" });
    expect(db.movements).toHaveLength(1);
    expect(db.entries[1].amount).toEqual(fromCents(-10100));
    expect(toCents(db.comandas[0].paidTotal)).toBe(0);
    expect(toCents(db.comandas[0].remainingTotal)).toBe(10100);
  });

  it("rejects another tenant's command/payment without creating financial effects", async () => {
    await expect(pay("PIX", { comandaId: "command-b" })).rejects.toMatchObject({ code: "COMANDA_NOT_FOUND" });
    await expect(closeComanda(db.client, "shop-a", "command-b")).rejects.toMatchObject({ code: "COMANDA_NOT_FOUND" });
    await pay();
    await expect(refund({ barbershopId: "shop-b", idempotencyKey: "foreign-refund" })).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    expect(db.payments).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
    expect(db.payments[0].refundedAmount).toEqual(fromCents(0));
    expect(db.comandas[1].paidTotal).toEqual(fromCents(0));
  });

  it("the same idempotency key can independently receive money in two tenants", async () => {
    await pay();
    await pay("PIX", { barbershopId: "shop-b", comandaId: "command-b" });
    expect(db.payments.map(p => p.barbershopId)).toEqual(["shop-a", "shop-b"]);
    expect(db.entries.map(e => e.barbershopId)).toEqual(["shop-a", "shop-b"]);
  });

  it("documents current scope gap: replay key is checked before validating the supplied command tenant", async () => {
    await pay();
    db.tx.comanda.findFirst.mockClear();
    // Exercise the real downstream guard too: it silently returns when the
    // foreign command is absent, so it does not undo the earlier recalculation.
    const actual = await vi.importActual<typeof import("@/lib/operations/commissions")>("@/lib/operations/commissions");
    vi.mocked(syncCommissionReleaseForComanda).mockImplementationOnce(actual.syncCommissionReleaseForComanda);
    const result = await pay("PIX", { comandaId: "command-b" });
    // Characterization of the current defect, NOT the desired tenant contract.
    // registerPayment replays a shop-a key but recalculates the caller's id.
    expect(db.tx.comanda.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { id: "command-b", barbershopId: "shop-a" } }));
    expect(result.id).toBe("command-b");
    expect(result.barbershopId).toBe("shop-b");
    expect(db.tx.comanda.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "command-b" } }));
    expect(db.payments).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
  });
});

describe("Phase 0: club receipt creates its own linked revenue", () => {
  function clubFixture() {
    const sub = { id: "sub-a", barbershopId: "shop-a", customerId: "customer-a", clubPlanId: "plan-a", status: "ACTIVE", currentPeriodEnd: new Date("2026-07-31T12:00:00Z"), gracePeriodEnd: new Date("2026-08-01T12:00:00Z"), clubPlan: { name: "Club", monthlyPrice: new Prisma.Decimal("10.10"), shopSharePercent: 50, barberPoolPercent: 50 } };
    const tx = {
      customerClubSubscription: {
        findFirst: vi.fn(async ({ where }: any) => where.barbershopId === sub.barbershopId && where.id === sub.id ? sub : null),
        update: vi.fn(async ({ data }: any) => ({ ...sub, ...data })),
      },
      clubSubscriptionPayment: { count: vi.fn().mockResolvedValue(0), create: vi.fn(async ({ data }: any) => ({ id: "club-payment-a", ...data })) },
      financialEntry: { create: vi.fn(async ({ data }: any) => ({ id: "club-entry-a", ...data })) },
      cashSession: { findFirst: vi.fn().mockResolvedValue(null) },
      cashMovement: { create: vi.fn() },
    };
    return { tx, client: tx as unknown as Prisma.TransactionClient };
  }

  it.each(["PIX", "DEBIT", "CREDIT", "OTHER"] as const)("%s records exactly one club revenue with the payment date and relationship", async paymentMethod => {
    const { tx, client } = clubFixture();
    const paidAt = new Date("2026-07-15T12:00:00Z");
    const result = await registerManualClubSubscriptionPayment({ barbershopId: "shop-a", subscriptionId: "sub-a", paymentMethod, paidAt, tx: client });
    expect(tx.clubSubscriptionPayment.create).toHaveBeenCalledTimes(1);
    expect(result.payment.amount).toEqual(new Prisma.Decimal("10.10"));
    expect(tx.financialEntry.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ barbershopId: "shop-a", type: "CLUB_REVENUE", category: paymentMethod, amount: new Prisma.Decimal("10.10"), entryDate: paidAt, clubSubscriptionPaymentId: result.payment.id }) });
    expect(tx.cashMovement.create).not.toHaveBeenCalled();
  });

  it("rejects a foreign subscription before payment, ledger or renewal writes", async () => {
    const { tx, client } = clubFixture();
    await expect(registerManualClubSubscriptionPayment({ barbershopId: "shop-b", subscriptionId: "sub-a", paymentMethod: "PIX", tx: client })).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
    expect(tx.clubSubscriptionPayment.create).not.toHaveBeenCalled();
    expect(tx.financialEntry.create).not.toHaveBeenCalled();
    expect(tx.customerClubSubscription.update).not.toHaveBeenCalled();
  });

  it("requires open physical cash before recording a CASH club receipt", async () => {
    const { tx, client } = clubFixture();
    await expect(registerManualClubSubscriptionPayment({ barbershopId: "shop-a", subscriptionId: "sub-a", paymentMethod: "CASH", tx: client })).rejects.toMatchObject({ code: "CASH_SESSION_REQUIRED" });
    expect(tx.cashSession.findFirst).toHaveBeenCalledWith({ where: { barbershopId: "shop-a", status: "OPEN" } });
    expect(tx.clubSubscriptionPayment.create).not.toHaveBeenCalled();
    expect(tx.financialEntry.create).not.toHaveBeenCalled();
  });
});

describe("Phase 0: money conversion uses current cents rounding", () => {
  it.each([
    [0.01, 1], ["0.01", 1], [new Prisma.Decimal("0.01"), 1],
    [10.10, 1010], ["10.10", 1010], ["10,10", 1010], [new Prisma.Decimal("10.10"), 1010],
    [0.1 + 0.2, 30], ["10.105", 1011], ["-10.105", -1010],
  ])("converts %s into %i cents and round-trips through Decimal", (value, cents) => {
    expect(toCents(value)).toBe(cents);
    expect(toCents(fromCents(cents as number))).toBe(cents);
  });
});
