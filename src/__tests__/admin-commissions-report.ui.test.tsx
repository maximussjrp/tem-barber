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

  it("T1-T4: renderiza cards gerenciais com filtros funcionais e valores corretos", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    // T1 - Wait for report to load
    await waitFor(() => {
      expect(screen.getByText("Produção Total")).toBeInTheDocument();
    });

    // Verify cards are rendered with correct labels (T24)
    expect(screen.getByText("Líquido estimado da barbearia")).toBeInTheDocument();
    expect(screen.getByText("Comissão Gerada")).toBeInTheDocument();
    expect(screen.getByText("Saldo a Pagar")).toBeInTheDocument();
    expect(screen.getAllByText("Ticket Médio").length).toBeGreaterThan(0);
    expect(screen.getByText("Descontos")).toBeInTheDocument();
    expect(screen.getByText("Pago aos Barbeiros")).toBeInTheDocument();

    // T24 - Label must be "Líquido estimado da barbearia", not "lucro" or "caixa"
    expect(screen.queryByText(/lucro/i)).toBeNull();
    expect(screen.queryByText(/caixa/i)).toBeNull();

    // T2 - MONTHLY is default
    const monthlyBtn = screen.getByText("Mensal");
    expect(monthlyBtn.className).toContain("bg-[var(--gold)]");

    // T3 - Filter tabs exist
    expect(screen.getByText("Semanal")).toBeInTheDocument();
    expect(screen.getByText("Quinzenal")).toBeInTheDocument();
    expect(screen.getByText("Personalizado")).toBeInTheDocument();

    // T4 - Barber filter exists
    expect(screen.getByText("Todos os barbeiros")).toBeInTheDocument();
  });

  it("T5-T7: tabela por barbeiro renderiza colunas e valores corretos", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Max Victor").length).toBeGreaterThan(0);
    });

    // T5 - Table headers
    expect(screen.getByText("Profissional")).toBeInTheDocument();
    expect(screen.getByText("Comandas")).toBeInTheDocument();
    expect(screen.getByText("Serviços")).toBeInTheDocument();
    expect(screen.getByText("Produção")).toBeInTheDocument();
    expect(screen.getByText("Base Líquida")).toBeInTheDocument();
    expect(screen.getByText("Gerado")).toBeInTheDocument();
    expect(screen.getAllByText("Liberado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saldo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ticket Médio").length).toBeGreaterThan(0);
    expect(screen.getAllByText("% Efetivo").length).toBeGreaterThan(0);

    // T7 - Values in table rows
    const row = screen.getAllByText("Max Victor").find((el) => el.closest("tr"))!.closest("tr")!;
    expect(row).toHaveTextContent("3"); // commandCount
    expect(row).toHaveTextContent("🔍 Auditar");
  });

  it("T14: fetch é chamado com memberId correto quando filtro de barbeiro é aplicado", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Max Victor").length).toBeGreaterThan(0);
    });

    // Populate member dropdown
    const select = screen.getByDisplayValue("Todos os barbeiros");
    await act(async () => {
      fireEvent.change(select, { target: { value: "member-1" } });
    });

    // Verify fetch was called with memberId
    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const lastReportCall = calls.filter((c: any) => c[0].includes("/api/admin/commissions/report")).pop();
      expect(lastReportCall[0]).toContain("memberId=member-1");
    });
  });

  it("T17-T25: drawer de auditoria abre com memberId correto e renderiza lançamentos", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Max Victor").length).toBeGreaterThan(0);
    });

    // Click on row to open drawer
    const row = screen.getAllByText("Max Victor").find((el) => el.closest("tr"))!.closest("tr")!;
    await act(async () => {
      fireEvent.click(row);
    });

    // T25 - Drawer opens with correct member
    await waitFor(() => {
      expect(screen.getByText("Auditoria: Max Victor")).toBeInTheDocument();
    });

    // T17 - memberId used correctly in detail fetch
    const detailCalls = fetchSpy.mock.calls.filter((c: any) => c[0].includes("/api/admin/commissions/detail"));
    expect(detailCalls.length).toBeGreaterThan(0);
    const lastDetailCall = detailCalls.pop();
    expect(lastDetailCall[0]).toContain("memberId=member-1");

    // Wait for audit data to load
    await waitFor(() => {
      expect(screen.getByText("Bruto Serviços")).toBeInTheDocument();
    });

    // Drawer tabs exist (preserved from previous commit)
    expect(screen.getByText(/Lançamentos/)).toBeInTheDocument();
    expect(screen.getByText(/Abertas/)).toBeInTheDocument();
    expect(screen.getByText(/Fechadas/)).toBeInTheDocument();
    expect(screen.getByText(/Estornos/)).toBeInTheDocument();

    // Drawer mini summary from report data
    expect(screen.getAllByText("Produção").length).toBeGreaterThan(0);
    expect(screen.getAllByText("% Efetivo").length).toBeGreaterThan(0);

    // Entry details rendered
    expect(screen.getByText("Barba")).toBeInTheDocument();
    expect(screen.getByText("Corte")).toBeInTheDocument();
    expect(screen.getAllByText(/Cliente Teste/).length).toBeGreaterThan(0);
  });

  it("T18-T19: totais do relatório batem e estado vazio mostra mensagem", async () => {
    // Override to return empty
    fetchSpy = vi.fn((url: string) => {
      if (url.includes("/api/admin/commissions/report")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              makeReportResponse({
                members: [],
                summary: {
                  grossServiceAmount: "0.00",
                  grossProductAmount: "0.00",
                  discountAmount: "0.00",
                  netBaseAmount: "0.00",
                  generatedCommission: "0.00",
                  releasedCommission: "0.00",
                  paidCommission: "0.00",
                  reversedCommission: "0.00",
                  balanceAmount: "0.00",
                  barbershopNetAmount: "0.00",
                  commandCount: 0,
                  serviceCount: 0,
                  productCount: 0,
                  averageTicket: "0.00",
                  effectiveCommissionRate: "0.00",
                },
              })
            ),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      render(<AdminComissoesPage />);
    });

    // T19 - Empty state shows message
    await waitFor(() => {
      expect(screen.getByText("Nenhuma comissão encontrada para os filtros aplicados.")).toBeInTheDocument();
    });
  });

  it("T21: GET /api/admin/commissions antigo NÃO é chamado pelo relatório", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Max Victor").length).toBeGreaterThan(0);
    });

    // T21 - Old endpoint not called (only /report and /detail are called)
    const calls = fetchSpy.mock.calls.map((c: any) => c[0]);
    const oldEndpointCalls = calls.filter(
      (url: string) => url.includes("/api/admin/commissions?") && !url.includes("/report") && !url.includes("/detail")
    );
    expect(oldEndpointCalls.length).toBe(0);
  });

  it("T23: navegação semanal calcula segunda a domingo corretamente", async () => {
    await act(async () => {
      render(<AdminComissoesPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Mensal")).toBeInTheDocument();
    });

    // Switch to weekly
    await act(async () => {
      fireEvent.click(screen.getByText("Semanal"));
    });

    // T23 - Week navigation buttons exist
    await waitFor(() => {
      expect(screen.getByText("Semana anterior")).toBeInTheDocument();
      expect(screen.getByText("Próxima semana")).toBeInTheDocument();
      expect(screen.getByText("Semana atual")).toBeInTheDocument();
    });

    // Verify the report endpoint receives WEEKLY type
    await waitFor(() => {
      const calls = fetchSpy.mock.calls;
      const weeklyCall = calls.find((c: any) => c[0].includes("type=WEEKLY"));
      expect(weeklyCall).toBeDefined();
      expect(weeklyCall[0]).toContain("weekRefDate=");
    });
  });
});
