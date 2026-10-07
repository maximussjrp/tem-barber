import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/financial/cash-flow/route";
import * as permissions from "@/lib/financial/permissions";
import * as domain from "@/lib/financial/cash-flow";

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: vi.fn(),
}));

vi.mock("@/lib/financial/cash-flow", async () => {
  const actual = await vi.importActual<any>("@/lib/financial/cash-flow");
  return {
    ...actual,
    getCashFlowReport: vi.fn(),
  };
});

describe("GET /api/admin/financial/cash-flow API Suite", () => {
  const shopA = "shop-aaa-111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Retorna 403 se requireFinancialSession falhar", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403 }) as any,
      data: null,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2026-06-01&endDate=2026-06-30");
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("2. Ignora barbershopId malicioso vindo no query param e usa o da sessão", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    vi.mocked(domain.getCashFlowReport).mockResolvedValue({
      period: { startDate: "2026-06-01", endDate: "2026-06-30" },
      realized: { inflow: "0.00", outflow: "0.00", net: "0.00" },
    } as any);

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2026-06-01&endDate=2026-06-30&barbershopId=malicious-shop");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(domain.getCashFlowReport).toHaveBeenCalledWith(
      expect.objectContaining({
        barbershopId: shopA, // da sessão!
        startDate: "2026-06-01",
        endDate: "2026-06-30",
      })
    );
  });

  it("3. Retorna 400 se data for inválida", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=invalida&endDate=2026-06-30");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("startDate inválido");
  });

  it("4. Retorna 400 se endDate < startDate", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2026-06-30&endDate=2026-06-01");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("anterior a startDate");
  });

  it("5. Retorna 400 se range > 366 dias", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2025-01-01&endDate=2026-06-01");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("366 dias");
  });

  it("6. Suporta categoryId e direction na chamada", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    vi.mocked(domain.getCashFlowReport).mockResolvedValue({
      period: { startDate: "2026-06-01", endDate: "2026-06-30" },
    } as any);

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2026-06-01&endDate=2026-06-30&categoryId=cat-123&direction=IN");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(domain.getCashFlowReport).toHaveBeenCalledWith({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      categoryId: "cat-123",
      direction: "IN",
    });
  });

  it("7. Retorna contrato com strings decimais exatas", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    const sampleReport = {
      period: {
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        today: "2026-06-15",
        timezone: "America/Sao_Paulo",
        basis: "OPERATIONAL_CASH_FLOW",
      },
      realized: {
        inflow: "1500.00",
        outflow: "450.00",
        net: "1050.00",
      },
      projected: {
        receivable: "200.00",
        payable: "100.00",
        net: "100.00",
        committed: "100.00",
        estimated: "0.00",
      },
      expectedPeriodNet: "1150.00",
      overdue: {
        receivable: "0.00",
        payable: "0.00",
        net: "0.00",
      },
      undated: {
        customerReceivables: "50.00",
        commissionPayables: "200.00",
        tipPayables: "15.00",
        clubApprovedPayables: "0.00",
      },
      forecastMeta: {
        virtualRoutineCount: 0,
        estimatedRoutineCount: 0,
        unprojectableRoutineCount: 0,
        allocationResidualCount: 0,
      },
      daily: [],
      upcoming: [],
      categoryBreakdown: [],
    };

    vi.mocked(domain.getCashFlowReport).mockResolvedValue(sampleReport as any);

    const req = new NextRequest("http://localhost/api/admin/financial/cash-flow?startDate=2026-06-01&endDate=2026-06-30");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.realized.inflow).toBe("1500.00");
    expect(body.realized.outflow).toBe("450.00");
    expect(typeof body.realized.inflow).toBe("string");
    expect(typeof body.expectedPeriodNet).toBe("string");
  });
});
