/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/admin/financial/entries/route";
import prisma from "@/lib/prisma";
import * as permissions from "@/lib/financial/permissions";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
const Decimal = Prisma.Decimal;

describe("GET /api/admin/financial/entries — API Route Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. retorna 401/403 se a sessão não for autorizada para financeiro", async () => {
    vi.spyOn(permissions, "requireFinancialSession").mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }) as any,
      data: null,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/financial/entries");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("2. busca dados isolados pelo barbershopId da sessão e não do query param", async () => {
    vi.spyOn(permissions, "requireFinancialSession").mockResolvedValue({
      error: null,
      data: {
        userId: "user-1",
        barbershopId: "shop-tenant-alpha",
        role: "OWNER",
      } as any,
    });

    const countSpy = vi.spyOn(prisma.financialEntry, "count").mockResolvedValue(1);
    const findManySpy = vi.spyOn(prisma.financialEntry, "findMany").mockResolvedValue([
      {
        id: "entry-1",
        barbershopId: "shop-tenant-alpha",
        type: "COMANDA_SERVICE",
        amount: new Decimal("80.00"),
        description: "Corte e Barba",
        entryDate: new Date("2026-07-01T12:00:00Z"),
        comandaId: "cmd-1",
        paymentId: null,
        clubSubscriptionPaymentId: null,
        financialSettlementId: null,
        financialSettlementReversalId: null,
        commissionAdvanceId: null,
        commissionAdvanceReversalId: null,
        commissionPayoutId: null,
        tipEntryId: null,
        tipRefundId: null,
        tipPayoutId: null,
        tipPayoutReversalId: null,
        customerCreditEntryId: null,
        allocations: [
          {
            allocatedAmount: new Decimal("80.00"),
            financialCategory: {
              id: "cat-1",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
            },
          },
        ],
      } as any,
    ]);

    // Attacker sends ?barbershopId=other-shop
    const req = new NextRequest("http://localhost:3000/api/admin/financial/entries?barbershopId=other-shop");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].id).toBe("entry-1");

    // Must query with session barbershopId ONLY
    expect(countSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-tenant-alpha",
        }),
      })
    );
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-tenant-alpha",
        }),
      })
    );
  });

  it("3. valida intervalo de datas e rejeita range maior que 366 dias", async () => {
    vi.spyOn(permissions, "requireFinancialSession").mockResolvedValue({
      error: null,
      data: {
        userId: "user-1",
        barbershopId: "shop-1",
        role: "OWNER",
      } as any,
    });

    const req = new NextRequest(
      "http://localhost:3000/api/admin/financial/entries?startDate=2024-01-01&endDate=2025-06-01"
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/366 dias/i);
  });

  it("4. rejeita data final anterior à data inicial", async () => {
    vi.spyOn(permissions, "requireFinancialSession").mockResolvedValue({
      error: null,
      data: {
        userId: "user-1",
        barbershopId: "shop-1",
        role: "OWNER",
      } as any,
    });

    const req = new NextRequest(
      "http://localhost:3000/api/admin/financial/entries?startDate=2026-07-10&endDate=2026-07-05"
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/não pode ser anterior/i);
  });

  it("5. suporta filtros de direção, tipo, categoria, busca textual e paginação com ordenação determinística", async () => {
    vi.spyOn(permissions, "requireFinancialSession").mockResolvedValue({
      error: null,
      data: {
        userId: "user-1",
        barbershopId: "shop-tenant-beta",
        role: "OWNER",
      } as any,
    });

    const countSpy = vi.spyOn(prisma.financialEntry, "count").mockResolvedValue(45);
    const findManySpy = vi.spyOn(prisma.financialEntry, "findMany").mockResolvedValue([
      {
        id: "entry-99",
        barbershopId: "shop-tenant-beta",
        type: "MANUAL_OUT",
        amount: new Decimal("-150.00"),
        description: "Conta de Energia",
        entryDate: new Date("2026-07-15T10:00:00Z"),
        comandaId: null,
        paymentId: null,
        clubSubscriptionPaymentId: null,
        financialSettlementId: "set-1",
        financialSettlementReversalId: null,
        commissionAdvanceId: null,
        commissionAdvanceReversalId: null,
        commissionPayoutId: null,
        tipEntryId: null,
        tipRefundId: null,
        tipPayoutId: null,
        tipPayoutReversalId: null,
        customerCreditEntryId: null,
        allocations: [],
      } as any,
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/admin/financial/entries?direction=OUT&type=MANUAL_OUT&categoryId=cat-123&q=energia&page=2&limit=15"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.pagination).toEqual({
      page: 2,
      limit: 15,
      total: 45,
      totalPages: 3,
    });
    expect(data.items.length).toBe(1);
    expect(data.items[0].direction).toBe("OUT");
    expect(data.items[0].allocationStatus).toBe("UNALLOCATED");
    expect(countSpy).toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-tenant-beta",
          amount: { lt: 0 },
          type: "MANUAL_OUT",
          allocations: {
            some: {
              financialCategoryId: "cat-123",
            },
          },
          description: {
            contains: "energia",
            mode: "insensitive",
          },
        }),
        orderBy: [{ entryDate: "desc" }, { id: "desc" }],
        skip: 15,
        take: 15,
      })
    );
  });
});
