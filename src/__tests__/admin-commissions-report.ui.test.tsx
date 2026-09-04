/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    commissionEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    commissionAdjustment: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/comissoes",
}));

import AdminComissoesPage from "@/app/admin/comissoes/page";
import { GET as getCommissionReport } from "@/app/api/admin/commissions/report/route";

function makeReportResponse(overrides: any = {}) {
  return {
    summary: {
      grossServiceAmount: "140.00",
      grossProductAmount: "0.00",
      discountAmount: "0.00",
      netBaseAmount: "140.00",
      generatedCommission: "70.00",
      releasedCommission: "52.50",
      paidCommission: "0.00",
      reversedCommission: "0.00",
      balanceAmount: "52.50",
      barbershopNetAmount: "70.00",
      commandCount: 3,
      serviceCount: 3,
      productCount: 0,
      averageTicket: "46.67",
      effectiveCommissionRate: "50.00",
      ...overrides.summary,
    },
    members: overrides.members || [
      {
        memberId: "member-1",
        memberName: "Max Victor",
        grossServiceAmount: "140.00",
        grossProductAmount: "0.00",
        discountAmount: "0.00",
        netBaseAmount: "140.00",
        generatedCommission: "70.00",
        releasedCommission: "52.50",
        paidCommission: "0.00",
        reversedCommission: "0.00",
        balanceAmount: "52.50",
        barbershopNetAmount: "70.00",
        commandCount: 3,
        serviceCount: 3,
        productCount: 0,
        averageTicket: "46.67",
        effectiveCommissionRate: "50.00",
      },
    ],
    period: overrides.period || { startDate: "2026-08-01", endDate: "2026-08-31", type: "MONTHLY" },
  };
}

function makeDetailResponse() {
  return {
    summary: {
      grossService: "140.00",
      grossProduct: "0.00",
      discount: "0.00",
      netBase: "140.00",
      generated: "70.00",
      released: "52.50",
      paid: "0.00",
      reversals: "0.00",
      rollover: "0.00",
      manualAdjustments: "0.00",
      balance: "52.50",
    },
    entries: [
      {
        id: "e1",
        description: "Barba",
        customerName: "Cliente Teste",
        comandaId: "cmd-abc12345",
        comandaStatus: "CLOSED",
        type: "SERVICE",
        ruleOriginLabel: "Padrão da Barbearia",
        ruleValue: "50%",
        baseAmount: "35.00",
        generatedAmount: "17.50",
        status: "RELEASED",
      },
      {
        id: "e2",
        description: "Corte",
        customerName: "Cliente Teste",
        comandaId: "cmd-def12345",
        comandaStatus: "OPEN",
        type: "SERVICE",
        ruleOriginLabel: "Padrão da Barbearia",
        ruleValue: "50%",
        baseAmount: "35.00",
        generatedAmount: "17.50",
        status: "GENERATED",
      },
    ],
    adjustments: [],
  };
}

describe("Relatórios de Comissão por Período — UI Tests", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { barbershopId: "shop-1", userId: "admin-1", memberId: "admin-member-1", role: "OWNER" },
    });

    fetchSpy = vi.fn((url: string) => {
      if (url.includes("/api/admin/commissions/overview")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              overview: [
                {
                  member: { id: "m1", name: "Max Victor", role: "BARBER" },
                  currentCycle: {
                    id: "c1",
                    cycleNumber: 1,
                    status: "OPEN",
                    grossCommission: 100,
                    adjustmentsTotal: 0,
                    advancesTotal: 20,
                    remainingBalance: 80,
                    openedAt: "2026-08-01T00:00:00Z",
                  },
                },
              ],
            }),
        });
      }
      if (url.includes("/api/admin/commissions/report")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeReportResponse()),
        });
      }
      if (url.includes("/api/admin/commissions/detail")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeDetailResponse()),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T22-T23: endpoint novo e read-only, tenant-scoped, com produtos e semana segunda a domingo", async () => {
    prismaMock.commissionEntry.findMany.mockResolvedValue([
      {
        id: "entry-service",
        barbershopId: "shop-1",
        memberId: "member-1",
        type: "SERVICE",
        baseAmount: "100.00",
        generatedAmount: "50.00",
        releasedAmount: "30.00",
        paidAmount: "10.00",
        comandaItem: {
          type: "SERVICE",
          total: "120.00",
          quantity: "1",
          discountAmount: "20.00",
          comandaId: "cmd-1",
          status: "DONE",
          comanda: { status: "CLOSED", closedAt: new Date("2026-08-05T15:00:00.000Z") },
        },
        member: { user: { name: "Max Victor" } },
      },
      {
        id: "entry-product",
        barbershopId: "shop-1",
        memberId: "member-1",
        type: "PRODUCT",
        baseAmount: "40.00",
        generatedAmount: "4.00",
        releasedAmount: "4.00",
        paidAmount: "0.00",
        comandaItem: {
          type: "PRODUCT",
          total: "40.00",
          quantity: "2",
          discountAmount: "0.00",
          comandaId: "cmd-1",
          status: "DONE",
          comanda: { status: "CLOSED", closedAt: new Date("2026-08-05T15:00:00.000Z") },
        },
        member: { user: { name: "Max Victor" } },
      },
    ]);
    prismaMock.commissionAdjustment.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      "http://localhost/api/admin/commissions/report?type=WEEKLY&weekRefDate=2026-08-05&memberId=member-1"
    );
    const res = await getCommissionReport(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.period).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09", type: "WEEKLY" });
    expect(json.summary.grossServiceAmount).toBe("120.00");
    expect(json.summary.grossProductAmount).toBe("40.00");
    expect(json.summary.productCount).toBe(2);
    expect(json.summary.netBaseAmount).toBe("140.00");
    expect(json.summary.generatedCommission).toBe("54.00");
    expect(json.summary.barbershopNetAmount).toBe("86.00");

    const expectedStart = new Date("2026-08-03T03:00:00.000Z");
    const expectedEnd = new Date("2026-08-10T03:00:00.000Z");
    expect(prismaMock.commissionEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-1",
          memberId: "member-1",
          OR: [
            { comandaItem: { comanda: { closedAt: { gte: expectedStart, lt: expectedEnd } } } },
            { comandaItem: { comanda: { closedAt: null } }, createdAt: { gte: expectedStart, lt: expectedEnd } },
          ],
        }),
      })
    );
    expect(prismaMock.commissionEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.commissionEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.commissionEntry.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.commissionAdjustment.create).not.toHaveBeenCalled();
    expect(prismaMock.commissionAdjustment.update).not.toHaveBeenCalled();
    expect(prismaMock.commissionAdjustment.updateMany).not.toHaveBeenCalled();
  });

  it("T1-T4: renderiza cards gerenciais canônicos na Visão Geral", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Comissões acumuladas").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Adiantamentos").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Saldo a pagar").length).toBeGreaterThan(0);
      expect(screen.getByText("Total pago")).toBeInTheDocument();
    });

    // Secondary analytics section
    expect(screen.getByText("Análise por Período")).toBeInTheDocument();
    expect(screen.getByText("Faturamento Serviços")).toBeInTheDocument();
    expect(screen.getByText("Ticket Médio")).toBeInTheDocument();

    // No legacy operational terminology
    expect(screen.queryByText("Períodos Mensais")).toBeNull();
    expect(screen.queryByText("Comissão Gerada")).toBeNull();
    expect(screen.queryByText("Fechar período")).toBeNull();
    expect(screen.queryByText("Marcar pago")).toBeNull();
  });

  it("T5-T7: tabela de profissionais renderiza colunas e valores canônicos", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Profissionais e Ciclos Atuais")).toBeInTheDocument();
    });

    // Canonical table headers
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(screen.getByText("Status do Ciclo")).toBeInTheDocument();
    expect(screen.getAllByText("Comissões acumuladas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Adiantamentos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saldo a pagar").length).toBeGreaterThan(0);
    expect(screen.getByText("Ações")).toBeInTheDocument();
  });

  it("T21: GET /api/admin/commissions antigo NÃO é chamado pelo relatório", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Comissões acumuladas").length).toBeGreaterThan(0);
    });

    // Old endpoint not called
    const calls = fetchSpy.mock.calls.map((c: any) => c[0]);
    const oldEndpointCalls = calls.filter(
      (url: string) => url.includes("/api/admin/commissions?") && !url.includes("/report") && !url.includes("/detail") && !url.includes("/overview")
    );
    expect(oldEndpointCalls.length).toBe(0);
  });
});
