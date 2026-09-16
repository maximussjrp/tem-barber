/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const { prismaMock, sessionMock, getCurrentCashSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    payment: { findMany: vi.fn() },
    financialEntry: { findMany: vi.fn() },
    comanda: { groupBy: vi.fn(), aggregate: vi.fn() },
  },
  sessionMock: vi.fn(),
  getCurrentCashSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return { ...original, requireOperationalSession: sessionMock };
});
vi.mock("@/lib/operations/cash", () => ({ getCurrentCashSession: getCurrentCashSessionMock }));

import { GET as dailySummary } from "@/app/api/admin/financial/daily-summary/route";
import { GET as currentCash } from "@/app/api/admin/cash-sessions/current/route";

function session(role: "OWNER" | "MANAGER" | "BARBER") {
  return {
    error: null,
    data: { userId: `${role}-user`, role, memberId: `${role}-member`, barbershopId: "shop-a" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentCashSessionMock.mockResolvedValue({
    id: "cash-1",
    status: "OPEN",
    openingAmount: "100.00",
    expectedAmount: "250.00",
    movements: [{ id: "movement-1", amount: "150.00", description: "Team" }],
  });
  prismaMock.payment.findMany.mockResolvedValue([]);
  prismaMock.financialEntry.findMany.mockResolvedValue([]);
  prismaMock.comanda.groupBy.mockResolvedValue([]);
  prismaMock.comanda.aggregate.mockResolvedValue({ _sum: { remainingTotal: null } });
});

describe("financial and cash data minimization", () => {
  it("blocks BARBER TEAM daily financial summary before database reads", async () => {
    sessionMock.mockResolvedValue(session("BARBER"));

    const response = await dailySummary(
      new NextRequest("http://localhost/api/admin/financial/daily-summary?date=2026-08-25")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "FINANCIAL_TEAM_SCOPE_FORBIDDEN" });
    expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "MANAGER"] as const)("keeps %s daily summary available", async (role) => {
    sessionMock.mockResolvedValue(session(role));

    const response = await dailySummary(
      new NextRequest("http://localhost/api/admin/financial/daily-summary?date=2026-08-25")
    );

    expect(response.status).toBe(200);
  });

  it("returns only cash identity/status to BARBER", async () => {
    sessionMock.mockResolvedValue(session("BARBER"));

    const response = await currentCash();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ session: { id: "cash-1", status: "OPEN" } });
    expect(JSON.stringify(body)).not.toMatch(/openingAmount|expectedAmount|movements/);
  });

  it.each(["OWNER", "MANAGER"] as const)("keeps full cash response for %s", async (role) => {
    sessionMock.mockResolvedValue(session(role));

    const response = await currentCash();
    const body = await response.json();

    expect(body.session).toMatchObject({
      openingAmount: "100.00",
      expectedAmount: "250.00",
      movements: expect.any(Array),
    });
  });

  it("separates title cash movements from manual entries in daily summary", async () => {
    sessionMock.mockResolvedValue(session("OWNER"));

    prismaMock.financialEntry.findMany.mockResolvedValue([
      {
        id: "e1",
        entryDate: new Date("2026-08-25T10:00:00Z"),
        description: "Lançamento Manual",
        type: "MANUAL_IN",
        amount: new Prisma.Decimal("50.00"),
        financialSettlementId: null,
        financialSettlementReversalId: null,
      },
      {
        id: "e2",
        entryDate: new Date("2026-08-25T11:00:00Z"),
        description: "Liquidação de RECEIVABLE",
        type: "MANUAL_IN",
        amount: new Prisma.Decimal("100.00"),
        financialSettlementId: "set-1",
        financialSettlementReversalId: null,
        financialSettlement: { title: { kind: "RECEIVABLE" } },
      },
      {
        id: "e3",
        entryDate: new Date("2026-08-25T12:00:00Z"),
        description: "Estorno de RECEIVABLE",
        type: "MANUAL_OUT",
        amount: new Prisma.Decimal("-100.00"),
        financialSettlementId: null,
        financialSettlementReversalId: "rev-1",
        financialSettlementReversal: { settlement: { title: { kind: "RECEIVABLE" } } },
      },
    ]);

    const response = await dailySummary(
      new NextRequest("http://localhost/api/admin/financial/daily-summary?date=2026-08-25")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.manualIn).toBe(50);
    expect(body.titleReceivableCashNet).toBe(0);
    expect(body.titlePayableExpenseNet).toBe(0);

    const m2 = body.movements.find((m: any) => m.id === "e2");
    expect(m2.type).toBe("TITLE_RECEIVABLE_SETTLEMENT");

    const m3 = body.movements.find((m: any) => m.id === "e3");
    expect(m3.type).toBe("TITLE_RECEIVABLE_REVERSAL");
  });
});
