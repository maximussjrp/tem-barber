/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/financial/management-report/route";
import * as permissions from "@/lib/financial/permissions";
import * as domain from "@/lib/financial/management-report";

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: vi.fn(),
}));

vi.mock("@/lib/financial/management-report", async () => {
  const actual = await vi.importActual<any>("@/lib/financial/management-report");
  return {
    ...actual,
    getManagementReport: vi.fn(),
  };
});

describe("GET /api/admin/financial/management-report API Suite", () => {
  const shopA = "shop-aaa-111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Retorna 403 se requireFinancialSession falhar", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403 }) as any,
      data: null,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=2026-10-01&endDate=2026-10-31");
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("2. Ignora barbershopId malicioso vindo no query param e usa o da sessão", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    vi.mocked(domain.getManagementReport).mockResolvedValue({
      period: { startDate: "2026-10-01", endDate: "2026-10-31" },
      kpis: { revenueRealized: "1000.00" },
    } as any);

    const req = new NextRequest(
      "http://localhost/api/admin/financial/management-report?startDate=2026-10-01&endDate=2026-10-31&barbershopId=malicious-tenant"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(domain.getManagementReport).toHaveBeenCalledWith(
      expect.objectContaining({
        barbershopId: shopA, // da sessão!
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      })
    );
  });

  it("3. Retorna 400 se startDate for inválido", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=invalida&endDate=2026-10-31");
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

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=2026-10-31&endDate=2026-10-01");
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

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=2025-01-01&endDate=2026-06-01");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("366 dias");
  });

  it("6. Suporta categoryId opcional na query", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    vi.mocked(domain.getManagementReport).mockResolvedValue({
      period: { startDate: "2026-10-01", endDate: "2026-10-31" },
    } as any);

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=2026-10-01&endDate=2026-10-31&categoryId=cat-123");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(domain.getManagementReport).toHaveBeenCalledWith({
      barbershopId: shopA,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      categoryId: "cat-123",
    });
  });

  it("7. Retorna 404 se categoryId for inválido ou de outro tenant (nunca 500)", async () => {
    vi.mocked(permissions.requireFinancialSession).mockResolvedValue({
      error: null,
      data: { barbershopId: shopA } as any,
    });

    vi.mocked(domain.getManagementReport).mockRejectedValue(
      new domain.CategoryNotFoundError("Categoria não encontrada para esta barbearia.")
    );

    const req = new NextRequest("http://localhost/api/admin/financial/management-report?startDate=2026-10-01&endDate=2026-10-31&categoryId=cat-wrong");
    const res = await GET(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Categoria não encontrada para esta barbearia");
  });
});
