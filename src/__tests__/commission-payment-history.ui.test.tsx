/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import CommissionPaymentsPage from "@/app/admin/comissoes/pagamentos/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/comissoes/pagamentos",
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

describe("TEM BARBER — Commission Payment History UI Suite", () => {
  let fetchSpy: any;

  const mockOverview = [
    {
      member: { id: "mem-1", name: "Carlos Silva", role: "BARBER" },
      currentCycle: {
        id: "cyc-open-1",
        cycleNumber: 4,
        status: "OPEN",
        grossCommission: 450.0,
        adjustmentsTotal: 0.0,
        advancesTotal: 100.0,
        remainingBalance: 350.0,
        openedAt: "2026-10-01T00:00:00Z",
      },
    },
  ];

  const mockTeam = [
    { id: "mem-1", user: { name: "Carlos Silva" }, role: "BARBER", isActive: true },
    { id: "mem-inact", user: { name: "Roberto Ex-Barbeiro" }, role: "BARBER", isActive: false },
  ];

  const mockPayoutsResponse = {
    payouts: [
      {
        id: "payout-101",
        cycleId: "cyc-closed-1",
        memberId: "mem-1",
        amount: 850.5,
        paymentMethod: "PIX",
        paidAt: "2026-10-15T14:30:00Z",
        notes: "Acerto quinzenal",
        createdAt: "2026-10-15T14:30:00Z",
        member: {
          id: "mem-1",
          name: "Carlos Silva",
          role: "BARBER",
          isActive: true,
        },
        cycle: {
          id: "cyc-closed-1",
          cycleNumber: 3,
          status: "PAID",
          grossCommission: 1050.5,
          adjustmentsTotal: 0,
          advancesTotal: 200,
          finalPayoutAmount: 850.5,
          remainingBalance: 0,
          openedAt: "2026-09-16T00:00:00Z",
          closedAt: "2026-10-15T14:30:00Z",
          paidAt: "2026-10-15T14:30:00Z",
        },
        createdBy: { id: "usr-admin", name: "Gestor João" },
      },
      {
        id: "payout-102",
        cycleId: "cyc-closed-2",
        memberId: "mem-inact",
        amount: 320.0,
        paymentMethod: "CASH",
        paidAt: "2026-10-10T11:00:00Z",
        notes: null,
        createdAt: "2026-10-10T11:00:00Z",
        member: {
          id: "mem-inact",
          name: "Roberto Ex-Barbeiro",
          role: "BARBER",
          isActive: false,
        },
        cycle: {
          id: "cyc-closed-2",
          cycleNumber: 7,
          status: "PAID",
          grossCommission: 320.0,
          adjustmentsTotal: 0,
          advancesTotal: 0,
          finalPayoutAmount: 320.0,
          remainingBalance: 0,
          openedAt: "2026-10-01T00:00:00Z",
          closedAt: "2026-10-10T11:00:00Z",
          paidAt: "2026-10-10T11:00:00Z",
        },
        createdBy: { id: "usr-admin", name: "Gestor João" },
      },
    ],
    pagination: {
      page: 1,
      limit: 20,
      totalRecords: 2,
      totalPages: 1,
      hasMore: false,
    },
    summary: {
      totalPaidAmount: 1170.5,
      totalPayoutsCount: 2,
    },
  };

  const mockCycleDetail = {
    cycle: {
      id: "cyc-closed-1",
      cycleNumber: 3,
      status: "PAID",
      grossCommission: 1050.5,
      adjustmentsTotal: 0,
      advancesTotal: 200,
      finalPayoutAmount: 850.5,
      remainingBalance: 0,
      openedAt: "2026-09-16T00:00:00Z",
      closedAt: "2026-10-15T14:30:00Z",
      paidAt: "2026-10-15T14:30:00Z",
      member: { id: "mem-1", name: "Carlos Silva" },
      payableItems: [
        { id: "pi-1", type: "RELEASE", amount: 50.0, sourceKind: "ITEM_COMPLETION", createdAt: "2026-10-01T10:00:00Z" },
        { id: "pi-2", type: "REVERSAL", amount: 20.0, sourceKind: "REFUND", createdAt: "2026-10-02T11:00:00Z" },
      ],
      adjustments: [
        { id: "adj-1", type: "CREDIT", amount: 30.0, reason: "Bônus por meta", createdAt: "2026-10-03T12:00:00Z" },
      ],
      advances: [
        {
          id: "adv-1",
          amount: 200,
          paymentMethod: "PIX",
          disbursedAt: "2026-10-05T12:00:00Z",
          notes: "Vale semanal",
          reversals: [],
        },
      ],
      payout: {
        id: "payout-101",
        amount: 850.5,
        paymentMethod: "PIX",
        paidAt: "2026-10-15T14:30:00Z",
        notes: "Acerto quinzenal",
      },
    },
  };

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);
      if (urlStr.includes("/api/admin/commissions/overview")) {
        return {
          ok: true,
          json: async () => ({ overview: mockOverview }),
        } as Response;
      }
      if (urlStr.includes("/api/admin/team")) {
        return {
          ok: true,
          json: async () => mockTeam,
        } as Response;
      }
      if (urlStr.includes("/api/admin/commissions/cycles/")) {
        return {
          ok: true,
          json: async () => mockCycleDetail,
        } as Response;
      }
      if (urlStr.includes("/api/admin/commissions/payouts")) {
        return {
          ok: true,
          blob: async () => new Blob(["test"], { type: "text/csv" }),
          json: async () => mockPayoutsResponse,
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Renderiza a tela inicial com abas 'Comissões a Pagar' e 'Histórico de Pagamentos'", async () => {
    render(<CommissionPaymentsPage />);

    expect(screen.getByRole("button", { name: "Comissões a Pagar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Histórico de Pagamentos" })).toBeInTheDocument();

    // Na aba inicial (Comissões a Pagar), exibe a tabela de ciclos em aberto
    await waitFor(() => {
      expect(screen.getByText("Ciclos de Comissão em Aberto")).toBeInTheDocument();
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument();
    });
  });

  it("2. Permite alternar para a aba 'Histórico de Pagamentos' e exibe os cards e tabela", async () => {
    render(<CommissionPaymentsPage />);

    const historyTabBtn = screen.getByRole("button", { name: "Histórico de Pagamentos" });
    fireEvent.click(historyTabBtn);

    // Aguarda o carregamento dos dados de histórico pelo término do fetch
    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
      expect(screen.getByText("Ciclo #7")).toBeInTheDocument();
    });

    // Confirma valores dos cards de resumo
    expect(screen.getByText("Total pago em liquidações")).toBeInTheDocument();
    expect(screen.getByText("Pagamentos Realizados")).toBeInTheDocument();
    expect(screen.getByText("Média por Pagamento")).toBeInTheDocument();
    expect(screen.getAllByText(/1\.170,50/).length).toBeGreaterThanOrEqual(1); // Total pago em liquidações
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1); // Total de Pagamentos

    // Confirma registros na tabela de pagamentos
    expect(screen.getByText("Roberto Ex-Barbeiro")).toBeInTheDocument();
    expect(screen.getByText("Inativo")).toBeInTheDocument(); // Badge de inativo
  });

  it("3. Abre o modal de detalhamento do ciclo ao clicar em 'Ver Detalhes'", async () => {
    render(<CommissionPaymentsPage />);

    // Alterna para Histórico
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    // Aguarda carregar dados
    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Ver Detalhes" })).toHaveLength(2);
    });

    // Clica no botão Ver Detalhes do primeiro item
    const viewDetailButtons = screen.getAllByRole("button", { name: "Ver Detalhes" });
    fireEvent.click(viewDetailButtons[0]);

    // Aguarda o modal de detalhamento do ciclo
    await waitFor(() => {
      expect(screen.getByText(/Detalhamento do Ciclo #3/)).toBeInTheDocument();
      expect(screen.getByText("Comissão Bruta")).toBeInTheDocument();
      expect(screen.getByText(/-.*200,00/)).toBeInTheDocument(); // Adiantamentos
      expect(screen.getAllByText(/850,50/).length).toBeGreaterThanOrEqual(1); // Desembolso final
    });

    // Fecha o modal
    const closeBtn = screen.getByRole("button", { name: "Fechar" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Detalhamento do Ciclo #3/)).not.toBeInTheDocument();
    });
  });

  it("4. Filtra por profissional ao clicar em 'Filtrar' e atualiza consulta", async () => {
    render(<CommissionPaymentsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
      expect(screen.getByLabelText(/Profissional/)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Profissional/);
    fireEvent.change(select, { target: { value: "mem-1" } });

    const filterBtn = screen.getByRole("button", { name: "Filtrar" });
    fireEvent.click(filterBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("memberId=mem-1")
      );
    });
  });

  it("5. Dispara exportação CSV com os mesmos filtros aplicados", async () => {
    render(<CommissionPaymentsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
      const btn = screen.getByRole("button", { name: "Exportar CSV" });
      expect(btn).not.toBeDisabled();
    });

    // Mock createObjectURL
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();

    const exportBtn = screen.getByRole("button", { name: "Exportar CSV" });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("format=csv")
      );
    });
  });

  it("6. Valida período personalizado incompleto sem disparar requisição inválida", async () => {
    render(<CommissionPaymentsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Filtro de Período")).toBeInTheDocument();
    });

    // Seleciona modo de período personalizado
    const modeSelect = screen.getByLabelText("Filtro de Período");
    fireEvent.change(modeSelect, { target: { value: "range" } });

    // Preenche apenas a data inicial "De" e deixa "Até" vazia
    const startDateInput = screen.getByLabelText("De");
    fireEvent.change(startDateInput, { target: { value: "2026-10-01" } });

    fetchSpy.mockClear();

    const filterBtn = screen.getByRole("button", { name: "Filtrar" });
    fireEvent.click(filterBtn);

    // Valida mensagem clara de erro ao usuário
    expect(
      screen.getByText("Para filtrar por período personalizado, preencha tanto a data inicial quanto a data final.")
    ).toBeInTheDocument();

    // Confirma que nenhuma requisição com período quebrado foi disparada
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("startDate=2026-10-01"));
  });

  it("7. Cabeçalho de impressão apresenta identificação de período, filtros e total pago", async () => {
    render(<CommissionPaymentsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
    });

    // Confirma elementos do cabeçalho de impressão com Mês do pagamento
    expect(
      screen.getByText(/Histórico de Pagamentos de Comissões — TEM BARBER/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Mês do pagamento:/)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Todos os profissionais/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("8. Imprimir / PDF busca todos os registros filtrados via format=print e restaura após afterprint", async () => {
    let renderedCountAtPrint = 0;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {
      renderedCountAtPrint = document.querySelectorAll("tbody tr").length;
    });

    // Cria lista simulada de 150 pagamentos para impressão completa
    const printPayouts = Array.from({ length: 150 }, (_, i) => ({
      id: `payout-print-${i + 1}`,
      cycleId: `cyc-print-${i + 1}`,
      memberId: "mem-1",
      amount: 100.0,
      paymentMethod: "PIX",
      paidAt: "2026-10-15T14:30:00Z",
      notes: null,
      createdAt: "2026-10-15T14:30:00Z",
      member: { id: "mem-1", name: "Carlos Silva", role: "BARBER", isActive: true },
      cycle: {
        id: `cyc-print-${i + 1}`,
        cycleNumber: i + 1,
        status: "PAID",
        grossCommission: 100.0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 100.0,
        remainingBalance: 0,
        openedAt: "2026-10-01T00:00:00Z",
        closedAt: "2026-10-15T14:30:00Z",
        paidAt: "2026-10-15T14:30:00Z",
      },
      createdBy: { id: "usr-admin", name: "Gestor João" },
    }));

    render(<CommissionPaymentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
    });

    // Configura resposta para format=print
    fetchSpy.mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);
      if (urlStr.includes("format=print")) {
        return {
          ok: true,
          json: async () => ({
            payouts: printPayouts,
            pagination: { page: 1, limit: 5000, totalRecords: 150, totalPages: 1, hasMore: false, isPrintMode: true },
            summary: { totalPaidAmount: 15000.0, totalPayoutsCount: 150 },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => mockPayoutsResponse,
      } as Response;
    });

    const printBtn = screen.getByRole("button", { name: /Imprimir \/ PDF/ });
    fireEvent.click(printBtn);

    // Aguarda a requisição com format=print e disparo do print após renderização completa no DOM
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("format=print"), expect.anything());
      expect(printSpy).toHaveBeenCalled();
    });

    // P1: Valida que todas as 150 linhas estavam no DOM no momento em que window.print() foi chamado
    expect(renderedCountAtPrint).toBe(150);

    // Simula término da impressão pelo navegador via evento afterprint
    fireEvent(window, new Event("afterprint"));

    // Confirma restauração da paginação normal (tabela volta a exibir Ciclo #3 e #7)
    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
      expect(screen.getByText("Ciclo #7")).toBeInTheDocument();
    });

    printSpy.mockRestore();
  });

  it("9. Imprimir / PDF exibe erro e não dispara print se API retornar 422 PRINT_LIMIT_EXCEEDED", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<CommissionPaymentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
    });

    fetchSpy.mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);
      if (urlStr.includes("format=print")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            code: "PRINT_LIMIT_EXCEEDED",
            error: "O relatório para impressão excede o limite máximo de 5.000 registros. Refine os filtros antes de imprimir.",
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => mockPayoutsResponse,
      } as Response;
    });

    const printBtn = screen.getByRole("button", { name: /Imprimir \/ PDF/ });
    fireEvent.click(printBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/O relatório para impressão excede o limite máximo de 5\.000 registros/)
      ).toBeInTheDocument();
    });

    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it("10. Modal exibe payableItems reais com Liberação, Reversão e Ajustes Manuais", async () => {
    render(<CommissionPaymentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Ver Detalhes" }).length).toBeGreaterThanOrEqual(1);
    });

    const viewDetailButtons = screen.getAllByRole("button", { name: "Ver Detalhes" });
    fireEvent.click(viewDetailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Detalhamento do Ciclo #3/)).toBeInTheDocument();
      // Badges de tipo
      expect(screen.getByText("Liberação")).toBeInTheDocument();
      expect(screen.getByText("Reversão")).toBeInTheDocument();
      // Cabeçalho canônico da coluna de origem
      expect(screen.getByText("Origem do Lançamento")).toBeInTheDocument();
      // Origens de itens (mapeamento canônico CommissionPayableSourceKind)
      expect(screen.getByText("Conclusão de item")).toBeInTheDocument();
      expect(screen.getByText("Estorno")).toBeInTheDocument();
      // Ajustes manuais
      expect(screen.getByText(/Ajustes Manuais/)).toBeInTheDocument();
      expect(screen.getByText(/Crédito:.*30,00/)).toBeInTheDocument();
      expect(screen.getByText("Bônus por meta")).toBeInTheDocument();
    });
  });

  it("11. Descarta resposta de carga inicial que chegue após o usuário aplicar um filtro", async () => {
    let resolveInitial: (res: any) => void;
    const initialPromise = new Promise((resolve) => {
      resolveInitial = resolve;
    });

    fetchSpy.mockImplementation((url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);
      if (urlStr.includes("/api/admin/commissions/overview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ overview: mockOverview }),
        } as Response);
      }
      if (urlStr.includes("/api/admin/team")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTeam,
        } as Response);
      }
      if (urlStr.includes("memberId=mem-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            payouts: [
              {
                id: "payout-filtered",
                cycleId: "cyc-filtered",
                memberId: "mem-1",
                amount: 999.0,
                paymentMethod: "PIX",
                paidAt: "2026-10-15T14:30:00Z",
                notes: null,
                createdAt: "2026-10-15T14:30:00Z",
                member: { id: "mem-1", name: "Carlos Silva", role: "BARBER", isActive: true },
                cycle: {
                  id: "cyc-filtered",
                  cycleNumber: 99,
                  status: "PAID",
                  grossCommission: 999.0,
                  adjustmentsTotal: 0,
                  advancesTotal: 0,
                  finalPayoutAmount: 999.0,
                  remainingBalance: 0,
                  openedAt: "2026-10-01T00:00:00Z",
                  closedAt: "2026-10-15T14:30:00Z",
                  paidAt: "2026-10-15T14:30:00Z",
                },
                createdBy: { id: "usr-admin", name: "Gestor João" },
              },
            ],
            pagination: { page: 1, limit: 20, totalRecords: 1, totalPages: 1, hasMore: false },
            summary: { totalPaidAmount: 999.0, totalPayoutsCount: 1 },
          }),
        } as Response);
      }

      // Requisição inicial de payouts pendente
      return initialPromise as Promise<Response>;
    });

    render(<CommissionPaymentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    // Aguarda o dropdown de profissionais carregar as opções da equipe
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Carlos Silva/ })).toBeInTheDocument();
    });

    // Usuário seleciona um filtro e clica em Filtrar
    const memberSelect = screen.getByLabelText(/Profissional/);
    fireEvent.change(memberSelect, { target: { value: "mem-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    // Aguarda o resultado do filtro carregar
    await waitFor(() => {
      expect(screen.getByText("Ciclo #99")).toBeInTheDocument();
      expect(screen.getAllByText(/999,00/).length).toBeGreaterThanOrEqual(1);
    });

    // Agora resolve a resposta da busca inicial que estava atrasada
    resolveInitial!({
      ok: true,
      json: async () => mockPayoutsResponse,
    });

    // Dá um tempo para qualquer possível renderização atrasada
    await new Promise((r) => setTimeout(r, 50));

    // Confirma que os dados filtrados NÃO foram sobrescritos pela resposta atrasada
    expect(screen.getByText("Ciclo #99")).toBeInTheDocument();
    expect(screen.queryByText("Ciclo #7")).not.toBeInTheDocument();
  });

  it("12. Invalida requisição de impressão pendente quando novos filtros são aplicados e não dispara window.print() com dados obsoletos", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    let resolvePrintA: (res: any) => void;
    const printAPromise = new Promise((resolve) => {
      resolvePrintA = resolve;
    });

    fetchSpy.mockImplementation((url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);
      if (urlStr.includes("/api/admin/commissions/overview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ overview: mockOverview }),
        } as Response);
      }
      if (urlStr.includes("/api/admin/team")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTeam,
        } as Response);
      }
      if (urlStr.includes("format=print")) {
        return printAPromise as Promise<Response>;
      }
      if (urlStr.includes("memberId=mem-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            payouts: [
              {
                id: "payout-filtered-b",
                cycleId: "cyc-filtered-b",
                memberId: "mem-1",
                amount: 888.0,
                paymentMethod: "PIX",
                paidAt: "2026-10-15T14:30:00Z",
                notes: null,
                createdAt: "2026-10-15T14:30:00Z",
                member: { id: "mem-1", name: "Carlos Silva", role: "BARBER", isActive: true },
                cycle: {
                  id: "cyc-filtered-b",
                  cycleNumber: 88,
                  status: "PAID",
                  grossCommission: 888.0,
                  adjustmentsTotal: 0,
                  advancesTotal: 0,
                  finalPayoutAmount: 888.0,
                  remainingBalance: 0,
                  openedAt: "2026-10-01T00:00:00Z",
                  closedAt: "2026-10-15T14:30:00Z",
                  paidAt: "2026-10-15T14:30:00Z",
                },
                createdBy: { id: "usr-admin", name: "Gestor João" },
              },
            ],
            pagination: { page: 1, limit: 20, totalRecords: 1, totalPages: 1, hasMore: false },
            summary: { totalPaidAmount: 888.0, totalPayoutsCount: 1 },
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => mockPayoutsResponse,
      } as Response);
    });

    render(<CommissionPaymentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    // Aguarda carregar listagem inicial (Ciclo #3)
    await waitFor(() => {
      expect(screen.getByText("Ciclo #3")).toBeInTheDocument();
    });

    // 1. Usuário clica em Imprimir com o filtro inicial A
    const printBtn = screen.getByRole("button", { name: /Imprimir \/ PDF/ });
    fireEvent.click(printBtn);

    // Confirma que a requisição de impressão A foi disparada
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("format=print"), expect.anything());
    });

    // 2. Enquanto a impressão A está pendente, o usuário altera os filtros para Filtro B (Carlos Silva) e clica em Filtrar
    const memberSelect = screen.getByLabelText(/Profissional/);
    fireEvent.change(memberSelect, { target: { value: "mem-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    // Aguarda o resultado do Filtro B carregar na tela
    await waitFor(() => {
      expect(screen.getByText("Ciclo #88")).toBeInTheDocument();
      expect(screen.getAllByText(/888,00/).length).toBeGreaterThanOrEqual(1);
    });

    // 3. Agora a resposta da impressão A finalmente chega (com dados obsoletos do Ciclo #123)
    resolvePrintA!({
      ok: true,
      json: async () => ({
        payouts: [
          {
            id: "payout-stale",
            cycleId: "cyc-stale",
            memberId: "mem-stale",
            amount: 50.0,
            paymentMethod: "PIX",
            paidAt: "2026-10-15T14:30:00Z",
            notes: null,
            createdAt: "2026-10-15T14:30:00Z",
            member: { id: "mem-stale", name: "Outro Barbeiro", role: "BARBER", isActive: true },
            cycle: {
              id: "cyc-stale",
              cycleNumber: 123,
              status: "PAID",
              grossCommission: 50.0,
              adjustmentsTotal: 0,
              advancesTotal: 0,
              finalPayoutAmount: 50.0,
              remainingBalance: 0,
              openedAt: "2026-10-01T00:00:00Z",
              closedAt: "2026-10-15T14:30:00Z",
              paidAt: "2026-10-15T14:30:00Z",
            },
            createdBy: { id: "usr-admin", name: "Gestor João" },
          },
        ],
        pagination: { page: 1, limit: 5000, totalRecords: 1, totalPages: 1, hasMore: false, isPrintMode: true },
        summary: { totalPaidAmount: 50.0, totalPayoutsCount: 1 },
      }),
    });

    // Aguarda tempo para certificar que nenhum efeito colateral tardio ocorra
    await new Promise((r) => setTimeout(r, 60));

    // Asserções:
    // a) window.print() JAMAIS é chamado com os dados obsoletos
    expect(printSpy).not.toHaveBeenCalled();

    // b) Os resultados do Filtro B continuam preservados na tela
    expect(screen.getByText("Ciclo #88")).toBeInTheDocument();
    expect(screen.queryByText("Ciclo #123")).not.toBeInTheDocument();

    printSpy.mockRestore();
  });
});
