/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import AdminCommissionsOverviewPage from "@/app/admin/comissoes/page";
import CommissionPaymentsPage from "@/app/admin/comissoes/pagamentos/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/comissoes",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("GATE: COMMISSION_OVERVIEW_KPI_PRINT_FIX_LOCAL — UI Suite", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);

      if (urlStr.includes("/api/admin/commissions/overview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            overview: [
              {
                member: { id: "mem-1", name: "Carlos Barbeiro", role: "BARBER" },
                currentCycle: {
                  id: "cyc-1",
                  cycleNumber: 2,
                  status: "OPEN",
                  grossCommission: 650.0,
                  adjustmentsTotal: 0.0,
                  advancesTotal: 150.0,
                  remainingBalance: 500.0,
                  openedAt: "2026-10-16T00:00:00Z",
                },
              },
            ],
            totalPaidAccumulated: 1115.43,
            totalPayoutsCount: 2,
            historicalSummary: {
              totalPaidAccumulated: 1115.43,
              totalPayoutsCount: 2,
            },
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/report")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: {
              grossServiceAmount: "2500.00",
              grossProductAmount: "300.00",
              discountAmount: "50.00",
              netBaseAmount: "2750.00",
              commandCount: 25,
              serviceCount: 30,
              productCount: 5,
              averageTicket: "110.00",
              effectiveCommissionRate: "45%",
            },
            members: [],
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/team")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "mem-1", user: { name: "Carlos Barbeiro" }, role: "BARBER", isActive: true },
            { id: "mem-2", user: { name: "Marcos Inativo" }, role: "BARBER", isActive: false },
          ],
        } as Response;
      }

      if (urlStr.includes("/api/admin/barbershop")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "shop-dom-brio",
            name: "Dom Brio Barbearia",
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/payouts")) {
        const isPrint = urlStr.includes("format=print");
        if (isPrint) {
          const printRecords = Array.from({ length: 150 }, (_, i) => ({
            id: `payout-print-${i + 1}`,
            cycleId: `cyc-print-${i + 1}`,
            memberId: i % 2 === 0 ? "mem-1" : "mem-2",
            amount: 100 + i,
            paymentMethod: i % 3 === 0 ? "PIX" : i % 3 === 1 ? "TRANSFER" : "CASH",
            paidAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), 12, 0, 0)).toISOString(),
            notes: `Pagamento simulado #${i + 1}`,
            createdAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), 12, 0, 0)).toISOString(),
            member: {
              id: i % 2 === 0 ? "mem-1" : "mem-2",
              name: i % 2 === 0 ? "Carlos Barbeiro" : "Marcos Inativo",
              role: "BARBER",
              isActive: i % 2 === 0,
            },
            cycle: {
              id: `cyc-print-${i + 1}`,
              cycleNumber: (i % 10) + 1,
              status: "PAID",
              grossCommission: 150 + i,
              adjustmentsTotal: 0,
              advancesTotal: 50,
              finalPayoutAmount: 100 + i,
              remainingBalance: 0,
              openedAt: "2026-09-16T00:00:00Z",
              closedAt: "2026-10-12T16:00:00Z",
              paidAt: "2026-10-12T16:00:00Z",
            },
            createdBy: { id: "adm-1", name: "Proprietário" },
          }));
          const totalPaid = printRecords.reduce((acc, r) => acc + r.amount, 0);

          return {
            ok: true,
            status: 200,
            json: async () => ({
              barbershop: {
                id: "shop-dom-brio",
                name: "Dom Brio Barbearia",
              },
              payouts: printRecords,
              pagination: {
                page: 1,
                limit: 5000,
                totalRecords: 150,
                totalPages: 1,
                hasMore: false,
                isPrintMode: true,
              },
              summary: {
                totalPaidAmount: totalPaid,
                totalPayoutsCount: 150,
              },
            }),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            barbershop: {
              id: "shop-dom-brio",
              name: "Dom Brio Barbearia",
            },
            payouts: [
              {
                id: "payout-1",
                cycleId: "cyc-prev-1",
                memberId: "mem-1",
                amount: 387.93,
                paymentMethod: "PIX",
                paidAt: "2026-10-05T15:00:00Z",
                notes: "Primeiro pagamento",
                createdAt: "2026-10-05T15:00:00Z",
                member: {
                  id: "mem-1",
                  name: "Carlos Barbeiro",
                  role: "BARBER",
                  isActive: true,
                },
                cycle: {
                  id: "cyc-prev-1",
                  cycleNumber: 1,
                  status: "PAID",
                  grossCommission: 387.93,
                  adjustmentsTotal: 0,
                  advancesTotal: 0,
                  finalPayoutAmount: 387.93,
                  remainingBalance: 0,
                  openedAt: "2026-09-16T00:00:00Z",
                  closedAt: "2026-10-05T15:00:00Z",
                  paidAt: "2026-10-05T15:00:00Z",
                },
                createdBy: { id: "adm-1", name: "Proprietário" },
              },
              {
                id: "payout-2",
                cycleId: "cyc-prev-2",
                memberId: "mem-2",
                amount: 727.50,
                paymentMethod: "TRANSFER",
                paidAt: "2026-10-12T16:00:00Z",
                notes: "Segundo pagamento",
                createdAt: "2026-10-12T16:00:00Z",
                member: {
                  id: "mem-2",
                  name: "Marcos Inativo",
                  role: "BARBER",
                  isActive: false,
                },
                cycle: {
                  id: "cyc-prev-2",
                  cycleNumber: 1,
                  status: "PAID",
                  grossCommission: 927.50,
                  adjustmentsTotal: 0,
                  advancesTotal: 200,
                  finalPayoutAmount: 727.50,
                  remainingBalance: 0,
                  openedAt: "2026-09-16T00:00:00Z",
                  closedAt: "2026-10-12T16:00:00Z",
                  paidAt: "2026-10-12T16:00:00Z",
                },
                createdBy: { id: "adm-1", name: "Proprietário" },
              },
            ],
            pagination: {
              page: 1,
              limit: 20,
              totalRecords: 2,
              totalPages: 1,
              hasMore: false,
              isPrintMode: false,
            },
            summary: {
              totalPaidAmount: 1115.43,
              totalPayoutsCount: 2,
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Overview KPI Card "Total pago acumulado"
  it("1. Card de Visão Geral exibe 'Total pago acumulado' e 'Liquidações realizadas no histórico'", async () => {
    render(<AdminCommissionsOverviewPage />);

    // Aguarda carregamento
    await waitFor(() => {
      expect(screen.getByText("Total pago acumulado")).toBeInTheDocument();
    });

    // Confirma subtítulo aprovado
    expect(
      screen.getByText("Liquidações realizadas no histórico")
    ).toBeInTheDocument();

    // Confirma valor do acumulado (R$ 1.115,43)
    expect(screen.getByText(/1\.115,43/)).toBeInTheDocument();

    // Confirma que os demais cards continuam presentes e corretos
    expect(screen.getAllByText("Comissões acumuladas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Adiantamentos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Saldo a pagar").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ciclos em apuração")).toBeInTheDocument();
    expect(screen.getByText("Valores antecipados")).toBeInTheDocument();
    expect(screen.getByText("Disponível para liquidação")).toBeInTheDocument();
  });

  // 2. Impressão sem elementos administrativos e redundantes
  it("2. Elementos administrativos, abas, filtros e cards redundantes contêm classe no-print", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    // Alterna para aba Histórico
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Pagamentos Realizados")).toBeInTheDocument();
    });

    // Verifica que o cabeçalho superior administrativo possui no-print
    const adminHeader = screen
      .getByRole("heading", { name: "Pagamento de Comissões", level: 1 })
      .closest(".no-print");
    expect(adminHeader).toHaveClass("no-print");

    // Verifica que o CommissionNav possui no-print
    const commissionNav = screen.getByRole("navigation", { name: "Navegação de Comissões" });
    expect(commissionNav).toHaveClass("no-print");

    // Verifica que os alternadores de abas possuem no-print
    const tabsContainer = screen.getByText("Comissões a Pagar").closest(".no-print");
    expect(tabsContainer).toHaveClass("no-print");

    // Verifica que o form de filtros possui no-print
    const filtersForm = screen.getByRole("button", { name: "Filtrar" }).closest(".no-print");
    expect(filtersForm).toHaveClass("no-print");

    // Verifica que os cards de dashboard da aba possuem no-print
    const summaryCards = screen.getByText("Média por Pagamento").closest(".grid");
    expect(summaryCards).toHaveClass("no-print");

    // Verifica que o cabeçalho de 'Pagamentos Efetivados' na tabela possui no-print
    const tableHeaderBar = screen.getByText("Pagamentos Efetivados").closest(".no-print");
    expect(tableHeaderBar).toHaveClass("no-print");
  });

  // 3. Cabeçalho de impressão apresenta identificação da barbearia, período, profissional, forma e totais
  it("3. Cabeçalho de impressão apresenta identificação da barbearia, período, forma e total pago", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getAllByText(/Carlos Barbeiro/).length).toBeGreaterThanOrEqual(1);
    });

    // Confirma cabeçalho de impressão renderizado no DOM
    expect(
      screen.getByText(/Histórico de Pagamentos de Comissões/)
    ).toBeInTheDocument();

    // Identificação da barbearia ou fallback
    expect(
      screen.getByText(/Dom Brio Barbearia|TEM BARBER/)
    ).toBeInTheDocument();

    // Data e hora da emissão
    expect(screen.getByText(/Data e hora da emissão:/)).toBeInTheDocument();

    // Período selecionado
    expect(screen.getByText(/Período selecionado:/)).toBeInTheDocument();

    // Profissional selecionado
    expect(screen.getByText(/Profissional selecionado:/)).toBeInTheDocument();

    // Forma de pagamento
    expect(screen.getByText(/Forma de pagamento:/)).toBeInTheDocument();

    // Total pago em liquidações
    expect(screen.getByText(/Total pago em liquidações:/)).toBeInTheDocument();

    // Quantidade de pagamentos
    expect(screen.getByText(/Quantidade de pagamentos:/)).toBeInTheDocument();
  });

  // 4. Fluxo de impressão completo: format=print com 150 registros, verificação de multipágina e restauração
  it("4. Executa handlePrint via format=print com 150 registros, comprova ausência de corte e restaura após afterprint", async () => {
    const originalPrint = window.print;
    const printMock = vi.fn();
    window.print = printMock;

    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    // Aguarda carregar payouts e habilitar o botão
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Imprimir \/ PDF/ });
      expect(btn).toBeEnabled();
    });

    const printBtn = screen.getByRole("button", { name: /Imprimir \/ PDF/ });
    fireEvent.click(printBtn);

    // Aguarda a chamada com format=print
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("format=print"),
        expect.any(Object)
      );
    });

    // Aguarda renderização completa no DOM e chamada a window.print
    await waitFor(() => {
      expect(printMock).toHaveBeenCalled();
    });

    // Comprova que todos os 150 registros foram renderizados no DOM para impressão sem corte
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(150);

    // Comprova que os contêineres de tabela possuem print:overflow-visible para evitar truncamento multipágina
    const tableWrapper = document.querySelector(".overflow-x-auto");
    expect(tableWrapper).toHaveClass("print:overflow-visible");

    // Comprova que o cabeçalho de impressão exibe o total exato de 150 registros
    expect(screen.getByText(/150 registro\(s\)/)).toBeInTheDocument();

    // Simula evento afterprint disparado pelo navegador
    fireEvent(window, new Event("afterprint"));

    // Verifica que o estado voltou ao normal (restauração de tela para paginação inicial)
    await waitFor(() => {
      const restoredRows = document.querySelectorAll("tbody tr");
      expect(restoredRows.length).toBe(2);
    });
    expect(screen.getByRole("button", { name: /Imprimir \/ PDF/ })).toBeEnabled();

    window.print = originalPrint;
  });
});
