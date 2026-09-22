/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getFinancialSummary } from "@/app/api/admin/financial/summary/route";
import { requireFinancialSession } from "@/lib/financial/permissions";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  return {
    default: {
      comanda: {
        findMany: vi.fn(),
      },
      comandaItem: {
        findMany: vi.fn(),
      },
      payment: {
        findMany: vi.fn(),
      },
      financialEntry: {
        findMany: vi.fn(),
      },
      commissionEntry: {
        findMany: vi.fn(),
      },
      commissionPayableItem: {
        findMany: vi.fn(),
      },
      commissionCycleAdjustment: {
        findMany: vi.fn(),
      },
    },
  };
});

const mockedRequireFinancialSession = vi.mocked(requireFinancialSession);
const mockedComanda = vi.mocked(prisma.comanda);
const mockedComandaItem = vi.mocked(prisma.comandaItem);
const mockedPayment = vi.mocked(prisma.payment);
const mockedFinancialEntry = vi.mocked(prisma.financialEntry);
const mockedCommissionEntry = vi.mocked(prisma.commissionEntry);
const mockedCommissionPayableItem = vi.mocked(prisma.commissionPayableItem);
const mockedCommissionCycleAdjustment = vi.mocked(prisma.commissionCycleAdjustment);

describe("PR #16 — Financial Summary Range API Tests", () => {
  const barbershopId1 = "shop-111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedComandaItem.findMany.mockResolvedValue([]);
    mockedCommissionPayableItem.findMany.mockResolvedValue([]);
    mockedCommissionCycleAdjustment.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createRequest(params: Record<string, string>): NextRequest {
    const url = new URL("http://localhost/api/admin/financial/summary");
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new NextRequest(url);
  }

  it("Phase 0: freezes tenant, Sao Paulo boundaries, receivable statuses and ledger sources", async () => {
    mockedRequireFinancialSession.mockResolvedValue({ error: null, data: {
      userId: "owner", role: "OWNER", memberId: "owner-member", barbershopId: barbershopId1,
    } } as any);
    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const response = await getFinancialSummary(createRequest({ startDate: "2026-07-15", endDate: "2026-07-15", barbershopId: "foreign-shop" }));
    expect(response.status).toBe(200);
    const period = { gte: new Date("2026-07-15T03:00:00.000Z"), lt: new Date("2026-07-16T03:00:00.000Z") };
    for (const delegate of [mockedComanda, mockedComandaItem, mockedPayment, mockedFinancialEntry, mockedCommissionEntry, mockedCommissionPayableItem, mockedCommissionCycleAdjustment]) {
      expect(delegate.findMany).toHaveBeenCalled();
      for (const [query] of vi.mocked(delegate.findMany).mock.calls) {
        expect(query?.where?.barbershopId).toBe(barbershopId1);
      }
    }
    expect(mockedComanda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      barbershopId: barbershopId1, status: "CLOSED", closedAt: period,
    } }));
    expect(mockedComanda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      barbershopId: barbershopId1, status: { not: "CANCELLED" }, remainingTotal: { gt: 0 },
    } }));
    expect(mockedPayment.findMany).toHaveBeenCalledWith({ where: { barbershopId: barbershopId1, paidAt: period } });
    expect(mockedFinancialEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      barbershopId: barbershopId1, entryDate: period, type: { in: ["MANUAL_IN", "MANUAL_OUT", "CLUB_REVENUE"] },
    } }));
    expect(mockedComandaItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      barbershopId: barbershopId1, type: "SERVICE", status: "DONE", completedAt: period,
    } }));
  });

  it("Phase 0: net command receipts subtract refund Payment once, independent of mirrored ledger entries", async () => {
    mockedRequireFinancialSession.mockResolvedValue({ error: null, data: {
      userId: "owner", role: "OWNER", memberId: "owner-member", barbershopId: barbershopId1,
    } } as any);
    mockedComanda.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([
      { id: "original", method: "PIX", status: "CONFIRMED", amount: new Prisma.Decimal("100"), refundedAmount: new Prisma.Decimal("10.10") },
      { id: "refund", method: "PIX", status: "REFUNDED", refundOfId: "original", amount: new Prisma.Decimal("-10.10") },
    ] as any);
    mockedFinancialEntry.findMany.mockResolvedValue([
      { type: "MANUAL_IN", amount: new Prisma.Decimal("40"), financialSettlementId: null, financialSettlementReversalId: null },
      { type: "MANUAL_OUT", amount: new Prisma.Decimal("-15"), financialSettlementId: null, financialSettlementReversalId: null },
      { type: "CLUB_REVENUE", amount: new Prisma.Decimal("120"), financialSettlementId: null, financialSettlementReversalId: null },
    ] as any);
    const response = await getFinancialSummary(createRequest({ startDate: "2026-07-15", endDate: "2026-07-15" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totals).toMatchObject({ commandReceived: 89.9, manualIncome: 40, manualExpenses: 15, clubRevenue: 120, totalReceived: 249.9, totalExpenses: 15, operationalResult: 234.9 });
    expect(body.paymentMethods.find((m: any) => m.method === "PIX")).toMatchObject({ amount: 100, count: 1 });
  });

  it("1. Rejeita se não autenticado (401)", async () => {
    const errorResponse = NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    mockedRequireFinancialSession.mockResolvedValue({
      error: errorResponse,
      data: null,
    } as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    expect(res.status).toBe(401);
  });

  it("2. BARBER recebe 403 (Acesso negado)", async () => {
    const errorResponse = NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    mockedRequireFinancialSession.mockResolvedValue({
      error: errorResponse,
      data: null,
    } as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    expect(res.status).toBe(403);
  });

  it("3. OWNER e MANAGER recebem resumo com sucesso (200)", async () => {
    mockedRequireFinancialSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedFinancialEntry.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.period.startDate).toBe("2026-07-01");
    expect(body.period.endDate).toBe("2026-07-31");
    expect(body.period.timezone).toBe("America/Sao_Paulo");
    expect(body.totals.grossRevenue).toBe(0);
    expect(body.totals.operationalResult).toBe(0);
  });

  it("Phase 3 Accounting: Title cash is excluded from manual metrics and classified by economic direction", async () => {
    mockedRequireFinancialSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    mockedFinancialEntry.findMany.mockResolvedValue([
      // Real manual entry
      { type: "MANUAL_IN", amount: new Prisma.Decimal("50.00"), financialSettlementId: null, financialSettlementReversalId: null },
      { type: "MANUAL_OUT", amount: new Prisma.Decimal("-20.00"), financialSettlementId: null, financialSettlementReversalId: null },
      // Title RECEIVABLE settlement +100
      {
        type: "MANUAL_IN",
        amount: new Prisma.Decimal("100.00"),
        financialSettlementId: "settle-1",
        financialSettlementReversalId: null,
        financialSettlement: { title: { kind: "RECEIVABLE" } },
      },
      // Title RECEIVABLE reversal -100
      {
        type: "MANUAL_OUT",
        amount: new Prisma.Decimal("-100.00"),
        financialSettlementId: null,
        financialSettlementReversalId: "rev-1",
        financialSettlementReversal: { settlement: { title: { kind: "RECEIVABLE" } } },
      },
      // Title PAYABLE settlement -200
      {
        type: "MANUAL_OUT",
        amount: new Prisma.Decimal("-200.00"),
        financialSettlementId: "settle-2",
        financialSettlementReversalId: null,
        financialSettlement: { title: { kind: "PAYABLE" } },
      },
    ] as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Manual income/expenses should ONLY count real manual entries
    expect(body.totals.manualIncome).toBe(50);
    expect(body.totals.manualExpenses).toBe(20);
    // Title cash deltas: RECEIVABLE (+100 - 100 = 0), PAYABLE (settlement -200 -> expense +200)
    expect(body.totals.titleReceivableCashNet).toBe(0);
    expect(body.totals.titlePayableExpenseNet).toBe(200);
    expect(body.totals.totalReceived).toBe(50); // 0 + 50 + 0 + 0
    expect(body.totals.totalExpenses).toBe(220); // 20 + 200
    expect(body.totals.operationalResult).toBe(-170); // 50 - 220
  });

  it("Phase 3 Accounting: Single RECEIVABLE reversal in period produces negative titleReceivableCashNet and does NOT count as expense", async () => {
    mockedRequireFinancialSession.mockResolvedValue({
      error: null,
      data: { userId: "u-owner", role: "OWNER", memberId: "m-owner", barbershopId: barbershopId1 },
    } as any);

    mockedComanda.findMany.mockResolvedValue([]);
    mockedPayment.findMany.mockResolvedValue([]);
    mockedCommissionEntry.findMany.mockResolvedValue([]);

    mockedFinancialEntry.findMany.mockResolvedValue([
      {
        type: "MANUAL_OUT",
        amount: new Prisma.Decimal("-100.00"),
        financialSettlementId: null,
        financialSettlementReversalId: "rev-1",
        financialSettlementReversal: { settlement: { title: { kind: "RECEIVABLE" } } },
      },
    ] as any);

    const req = createRequest({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const res = await getFinancialSummary(req);
    const body = await res.json();

    expect(body.totals.manualExpenses).toBe(0);
    expect(body.totals.titleReceivableCashNet).toBe(-100);
    expect(body.totals.titlePayableExpenseNet).toBe(0);
    expect(body.totals.totalReceived).toBe(-100);
    expect(body.totals.totalExpenses).toBe(0);
  });
});
