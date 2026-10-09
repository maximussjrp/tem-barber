/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RelatorioGerencialPage from "@/app/admin/financeiro/relatorio-gerencial/page";
import * as client from "@/lib/financial/management-report-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/financeiro/relatorio-gerencial",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/lib/financial/management-report-client", () => ({
  fetchManagementReport: vi.fn(),
  fetchMonthlyManagementReport: vi.fn(),
}));

global.fetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes("/api/admin/financial/categories")) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "cat-1",
            code: "01.01",
            name: "Serviços",
            classification: "REVENUE",
            isActive: true,
            depth: 2,
            isLeaf: true,
            children: [],
          },
        ]),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  });
});

const mockReport: client.ManagementReport = {
  period: {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    previousStartDate: "2026-09-01",
    previousEndDate: "2026-09-30",
    comparisonType: "CALENDAR_MONTH",
    today: "2026-10-15",
    timezone: "America/Sao_Paulo",
    basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST",
  },
  kpis: {
    revenueRealized: "10000.00",
    revenueExpected: "12000.00",
    variableCostRealized: "3000.00",
    variableCostExpected: "3500.00",
    marginRealized: "7000.00",
    marginExpected: "8500.00",
    marginAVPercent: 70.0,
    marginAHPercent: 15.0,
    fixedExpenseRealized: "2000.00",
    fixedExpenseExpected: "2000.00",
    resultBeforeInvestmentsRealized: "5000.00",
    resultBeforeInvestmentsExpected: "6500.00",
    investmentRealized: "1000.00",
    investmentExpected: "1000.00",
    operatingResultRealized: "4000.00",
    operatingResultExpected: "5500.00",
    operatingResultAVPercent: 40.0,
    operatingResultAHPercent: 20.0,
    nonOperatingInRealized: "500.00",
    nonOperatingInExpected: "500.00",
    nonOperatingOutRealized: "200.00",
    nonOperatingOutExpected: "200.00",
    netResultRealized: "4300.00",
    netResultExpected: "5800.00",
    netResultAVPercent: 43.0,
    netResultAHPercent: 18.5,
  },
  sections: {
    revenue: [
      {
        id: "cat-rev-root",
        code: "01",
        name: "Receitas",
        classification: "REVENUE",
        depth: 1,
        isLeaf: false,
        parentCategoryId: null,
        expected: "12000.00",
        realized: "10000.00",
        realizedPrevious: "8000.00",
        avPercent: 100.0,
        ahPercent: 25.0,
        children: [
          {
            id: "cat-rev-serv",
            code: "01.01",
            name: "Serviços",
            classification: "REVENUE",
            depth: 2,
            isLeaf: true,
            parentCategoryId: "cat-rev-root",
            expected: "12000.00",
            realized: "10000.00",
            realizedPrevious: "8000.00",
            avPercent: 100.0,
            ahPercent: 25.0,
          },
        ],
      },
    ],
    variableCost: [],
    fixedExpense: [],
    investment: [],
    nonOperatingIn: [],
    nonOperatingOut: [],
  },
  outsideResult: {
    transfers: [
      {
        id: "tr-1",
        code: "07.01",
        name: "Entre Contas",
        type: "TRANSFER",
        realized: "5000.00",
        count: 1,
      },
    ],
    adjustments: [],
    unclassified: [],
  },
  dataQuality: {
    unclassifiedEntriesCount: 0,
    unclassifiedEntriesAmount: "0.00",
    allocationResidualsCount: 0,
    allocationResidualsAmount: "0.00",
    hasResidualsOrUnclassified: false,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("RelatorioGerencialPage UI Component Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renderiza página com título e cards principais sem expor DRE nem enums brutos", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);

    render(<RelatorioGerencialPage />);

    expect(screen.getByRole("heading", { name: "Relatório Gerencial" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Receita Realizada")).toBeInTheDocument();
      expect(screen.getByText("Margem de Contribuição")).toBeInTheDocument();
      expect(screen.getByText("Resultado Operacional")).toBeInTheDocument();
      expect(screen.getByText("Resultado Líquido")).toBeInTheDocument();
    });

    // Garante que não há menção à palavra DRE na interface
    expect(screen.queryByText(/\bDRE\b/)).toBeNull();
    // Garante que enums brutos não estão visíveis
    expect(screen.queryByText("REVENUE")).toBeNull();
    expect(screen.queryByText("VARIABLE_COST")).toBeNull();
    expect(client.fetchManagementReport).toHaveBeenCalledTimes(1);
    expect(client.fetchMonthlyManagementReport).not.toHaveBeenCalled();
  });

  it("2. Renderiza demonstrativo gerencial e linhas com AV e AH", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);

    render(<RelatorioGerencialPage />);

    await waitFor(() => {
      expect(screen.getByText("Demonstrativo Gerencial")).toBeInTheDocument();
      expect(screen.getByText("(=) MARGEM DE CONTRIBUIÇÃO")).toBeInTheDocument();
      expect(screen.getByText("(=) RESULTADO OPERACIONAL")).toBeInTheDocument();
      expect(screen.getByText("(=) RESULTADO LÍQUIDO")).toBeInTheDocument();
    });
  });

  it("3. Renderiza seção fora do resultado econômico quando houver transferências com labels humanas", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);

    render(<RelatorioGerencialPage />);

    await waitFor(() => {
      expect(screen.getByText("Movimentos Fora do Resultado Econômico")).toBeInTheDocument();
      expect(screen.getByText("Entre Contas")).toBeInTheDocument();
      expect(screen.getByText("Transferência")).toBeInTheDocument();
    });
  });

  it("4. Renderiza banner com 'Qualidade dos Dados' (sem 'Contábeis' e sem 'DRE') quando existirem resíduos", async () => {
    const reportWithResiduals: client.ManagementReport = {
      ...mockReport,
      dataQuality: {
        unclassifiedEntriesCount: 2,
        unclassifiedEntriesAmount: "300.00",
        allocationResidualsCount: 1,
        allocationResidualsAmount: "50.00",
        hasResidualsOrUnclassified: true,
      },
    };

    vi.mocked(client.fetchManagementReport).mockResolvedValue(reportWithResiduals);

    render(<RelatorioGerencialPage />);

    await waitFor(() => {
      expect(screen.getByText("Atenção: Qualidade dos Dados")).toBeInTheDocument();
      expect(screen.getByText(/Não categorizados: 2/)).toBeInTheDocument();
      expect(screen.getByText(/Resíduos de rateio: 1/)).toBeInTheDocument();
    });

    // Não deve conter a palavra 'Contábeis' nem 'DRE'
    expect(screen.queryByText(/Qualidade de Dados Contábeis/)).toBeNull();
    expect(screen.queryByText(/\bDRE\b/)).toBeNull();
  });

  it("5. Exibe alerta de Acesso Restrito em caso de erro 403", async () => {
    const forbiddenError = new Error("Acesso negado");
    (forbiddenError as any).status = 403;
    vi.mocked(client.fetchManagementReport).mockRejectedValue(forbiddenError);

    render(<RelatorioGerencialPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Acesso Restrito")).toBeInTheDocument();
    });
  });

  it("6. Exibe erro genérico com botão 'Tentar novamente'", async () => {
    vi.mocked(client.fetchManagementReport).mockRejectedValue(new Error("Erro de conexão com o servidor"));

    render(<RelatorioGerencialPage />);

    await waitFor(() => {
      expect(screen.getByText("Erro de conexão com o servidor")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    });
  });

  it("7. Permite alternar presets (Este mês, Mês anterior, Ano atual, Personalizado) e alterar datas manualmente", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);

    render(<RelatorioGerencialPage />);

    const prevMonthBtn = screen.getByRole("button", { name: "Mês anterior" });
    fireEvent.click(prevMonthBtn);
    await waitFor(() => {
      expect(client.fetchManagementReport).toHaveBeenCalled();
    });

    const yearBtn = screen.getByRole("button", { name: "Ano atual" });
    fireEvent.click(yearBtn);
    await waitFor(() => {
      expect(client.fetchManagementReport).toHaveBeenCalled();
    });

    const thisMonthBtn = screen.getByRole("button", { name: "Este mês" });
    fireEvent.click(thisMonthBtn);
    await waitFor(() => {
      expect(client.fetchManagementReport).toHaveBeenCalled();
    });

    const customBtn = screen.getByRole("button", { name: "Personalizado" });
    fireEvent.click(customBtn);

    // Alteração manual de startDate e endDate
    const startDateInput = screen.getByLabelText("Data Inicial");
    const endDateInput = screen.getByLabelText("Data Final");

    fireEvent.change(startDateInput, { target: { value: "2026-10-11" } });
    fireEvent.change(endDateInput, { target: { value: "2026-10-20" } });

    await waitFor(() => {
      expect(client.fetchManagementReport).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2026-10-11",
          endDate: "2026-10-20",
        }),
        expect.anything()
      );
    });
  });

  const mockMonthlyReport: client.MonthlyManagementReport = {
    period: {
      startMonth: "2026-08",
      endMonth: "2026-10",
      previousMonth: "2026-07",
      count: 3,
      today: "2026-10-15",
      timezone: "America/Sao_Paulo",
      basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST",
    },
    months: [
      { key: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31" },
      { key: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" },
      { key: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
    ],
    sections: {
      revenue: [
        {
          id: "cat-rev-root",
          code: "01",
          name: "Receitas",
          classification: "REVENUE",
          depth: 1,
          isLeaf: false,
          parentCategoryId: null,
          valuesByMonth: {
            "2026-08": { expected: "8000.00", realized: "8000.00", avPercent: 100.0, ahPercent: null },
            "2026-09": { expected: "9000.00", realized: "9000.00", avPercent: 100.0, ahPercent: 12.5 },
            "2026-10": { expected: "10000.00", realized: "10000.00", avPercent: 100.0, ahPercent: 11.1 },
          },
          children: [
            {
              id: "cat-rev-serv",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
              depth: 2,
              isLeaf: true,
              parentCategoryId: "cat-rev-root",
              valuesByMonth: {
                "2026-08": { expected: "8000.00", realized: "8000.00", avPercent: 100.0, ahPercent: null },
                "2026-09": { expected: "9000.00", realized: "9000.00", avPercent: 100.0, ahPercent: 12.5 },
                "2026-10": { expected: "10000.00", realized: "10000.00", avPercent: 100.0, ahPercent: 11.1 },
              },
            },
          ],
        },
      ],
      variableCost: [],
      fixedExpense: [],
      investment: [],
      nonOperatingIn: [],
      nonOperatingOut: [],
    },
    kpisByMonth: {
      "2026-08": {
        revenueRealized: "8000.00",
        revenueExpected: "8000.00",
        variableCostRealized: "2000.00",
        variableCostExpected: "2000.00",
        marginRealized: "6000.00",
        marginExpected: "6000.00",
        marginAVPercent: 75.0,
        marginAHPercent: null,
        fixedExpenseRealized: "1500.00",
        fixedExpenseExpected: "1500.00",
        resultBeforeInvestmentsRealized: "4500.00",
        resultBeforeInvestmentsExpected: "4500.00",
        resultBeforeInvestmentsAVPercent: 56.3,
        resultBeforeInvestmentsAHPercent: null,
        investmentRealized: "500.00",
        investmentExpected: "500.00",
        operatingResultRealized: "4000.00",
        operatingResultExpected: "4000.00",
        operatingResultAVPercent: 50.0,
        operatingResultAHPercent: null,
        nonOperatingInRealized: "0.00",
        nonOperatingInExpected: "0.00",
        nonOperatingOutRealized: "0.00",
        nonOperatingOutExpected: "0.00",
        netResultRealized: "4000.00",
        netResultExpected: "4000.00",
        netResultAVPercent: 50.0,
        netResultAHPercent: null,
      },
      "2026-09": {
        revenueRealized: "9000.00",
        revenueExpected: "9000.00",
        variableCostRealized: "2200.00",
        variableCostExpected: "2200.00",
        marginRealized: "6800.00",
        marginExpected: "6800.00",
        marginAVPercent: 75.6,
        marginAHPercent: 13.3,
        fixedExpenseRealized: "1500.00",
        fixedExpenseExpected: "1500.00",
        resultBeforeInvestmentsRealized: "5300.00",
        resultBeforeInvestmentsExpected: "5300.00",
        resultBeforeInvestmentsAVPercent: 58.9,
        resultBeforeInvestmentsAHPercent: 17.8,
        investmentRealized: "500.00",
        investmentExpected: "500.00",
        operatingResultRealized: "4800.00",
        operatingResultExpected: "4800.00",
        operatingResultAVPercent: 53.3,
        operatingResultAHPercent: 20.0,
        nonOperatingInRealized: "0.00",
        nonOperatingInExpected: "0.00",
        nonOperatingOutRealized: "0.00",
        nonOperatingOutExpected: "0.00",
        netResultRealized: "4800.00",
        netResultExpected: "4800.00",
        netResultAVPercent: 53.3,
        netResultAHPercent: 20.0,
      },
      "2026-10": {
        revenueRealized: "10000.00",
        revenueExpected: "10000.00",
        variableCostRealized: "2500.00",
        variableCostExpected: "2500.00",
        marginRealized: "7500.00",
        marginExpected: "7500.00",
        marginAVPercent: 75.0,
        marginAHPercent: 10.3,
        fixedExpenseRealized: "1500.00",
        fixedExpenseExpected: "1500.00",
        resultBeforeInvestmentsRealized: "6000.00",
        resultBeforeInvestmentsExpected: "6000.00",
        resultBeforeInvestmentsAVPercent: 60.0,
        resultBeforeInvestmentsAHPercent: 13.2,
        investmentRealized: "500.00",
        investmentExpected: "500.00",
        operatingResultRealized: "5500.00",
        operatingResultExpected: "5500.00",
        operatingResultAVPercent: 55.0,
        operatingResultAHPercent: 14.6,
        nonOperatingInRealized: "0.00",
        nonOperatingInExpected: "0.00",
        nonOperatingOutRealized: "0.00",
        nonOperatingOutExpected: "0.00",
        netResultRealized: "5500.00",
        netResultExpected: "5500.00",
        netResultAVPercent: 55.0,
        netResultAHPercent: 14.6,
      },
    },
    dataQuality: {
      unclassifiedEntriesCount: 0,
      unclassifiedEntriesAmount: "0.00",
      allocationResidualsCount: 0,
      allocationResidualsAmount: "0.00",
      hasResidualsOrUnclassified: false,
    },
  };

  it("8. Alterna para a aba 'Comparativo mensal' e dispara fetchMonthlyManagementReport", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);

    const monthlyTabBtn = screen.getByRole("button", { name: "Comparativo mensal" });
    fireEvent.click(monthlyTabBtn);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 3,
        }),
        expect.anything()
      );
    });

    expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(1);

    expect(screen.getByText("Janela:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 meses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 meses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12 meses" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Comparativo Mensal")).toBeInTheDocument();
    });
    expect(screen.getByText("ago/2026")).toBeInTheDocument();
    expect(screen.getByText("set/2026")).toBeInTheDocument();
    expect(screen.getAllByText("out/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("(=) MARGEM DE CONTRIBUIÇÃO")).toBeInTheDocument();
    expect(screen.getByText("(=) RESULTADO ANTES DOS INVESTIMENTOS")).toBeInTheDocument();
    expect(screen.getByText("(=) RESULTADO OPERACIONAL")).toBeInTheDocument();
    expect(screen.getByText("(=) RESULTADO LÍQUIDO")).toBeInTheDocument();
    expect(screen.getByText("Esperado = realizado + valores ainda previstos no período.")).toBeInTheDocument();
    expect(screen.getByText("AV = participação sobre a receita realizada do mês.")).toBeInTheDocument();
    expect(screen.getByText("AH = variação em relação ao mês anterior.")).toBeInTheDocument();
    expect(screen.queryByText(/\bDRE\b/)).toBeNull();
    expect(screen.queryByText("REVENUE")).toBeNull();
  });

  it("9. Permite alternar a contagem de meses (6 e 12 meses) no comparativo mensal", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalled();
    });

    const btn6 = screen.getByRole("button", { name: "6 meses" });
    fireEvent.click(btn6);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 6,
        }),
        expect.anything()
      );
    });
    expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(2);

    const btn12 = screen.getByRole("button", { name: "12 meses" });
    fireEvent.click(btn12);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 12,
        }),
        expect.anything()
      );
    });
    expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(3);
  });

  it("10. Permite navegar meses via setas ‹ e › e voltar ao 'Mês atual'", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalled();
    });

    const initialEndMonth = vi.mocked(client.fetchMonthlyManagementReport).mock.calls[0][0].endMonth;
    const endMonthInput = screen.getByLabelText("Mês de Fechamento (endMonth)");
    fireEvent.change(endMonthInput, { target: { value: "2026-09" } });
    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ endMonth: "2026-09" }),
        expect.anything()
      );
    });

    const prevMonthArrow = screen.getByRole("button", { name: "Mês anterior" });
    fireEvent.click(prevMonthArrow);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ endMonth: "2026-08" }),
        expect.anything()
      );
    });

    const nextMonthArrow = screen.getByRole("button", { name: "Mês seguinte" });
    fireEvent.click(nextMonthArrow);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ endMonth: "2026-09" }),
        expect.anything()
      );
    });

    const currentMonthBtn = screen.getByRole("button", { name: "Mês atual" });
    fireEvent.click(currentMonthBtn);

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ endMonth: initialEndMonth }),
        expect.anything()
      );
    });
  });

  it("11. Toggles client-side ('Exibir detalhes' e 'Ver apenas realizado') alteram exibição sem refetch", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(1);
    });

    const detailsToggle = screen.getByLabelText("Exibir detalhes");
    const realizedOnlyToggle = screen.getByLabelText("Ver apenas realizado");

    expect(screen.queryByText("Serviços")).toBeNull();
    expect(screen.getAllByRole("columnheader", { name: "Esperado" })).toHaveLength(3);

    // Alterna Exibir detalhes
    fireEvent.click(detailsToggle);
    expect(screen.getByText("Serviços")).toBeInTheDocument();
    // Alterna Ver apenas realizado
    fireEvent.click(realizedOnlyToggle);

    expect(screen.queryAllByRole("columnheader", { name: "Esperado" })).toHaveLength(0);
    expect(screen.getAllByRole("columnheader", { name: "Realizado" })).toHaveLength(3);
    expect(screen.getAllByRole("columnheader", { name: "AV" })).toHaveLength(3);
    expect(screen.getAllByRole("columnheader", { name: "AH" })).toHaveLength(3);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    // Nenhuma nova requisição de rede disparada pelos toggles locais
    expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(1);
  });

  it("12. Exibe banner de qualidade de dados na visão mensal quando houver resíduos", async () => {
    const monthlyWithResiduals: client.MonthlyManagementReport = {
      ...mockMonthlyReport,
      dataQuality: {
        unclassifiedEntriesCount: 3,
        unclassifiedEntriesAmount: "450.00",
        allocationResidualsCount: 1,
        allocationResidualsAmount: "25.00",
        hasResidualsOrUnclassified: true,
      },
    };

    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(monthlyWithResiduals);

    render(<RelatorioGerencialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(screen.getByText("Atenção: Qualidade dos Dados")).toBeInTheDocument();
      expect(screen.getByText(/Não categorizados: 3/)).toBeInTheDocument();
      expect(screen.getByText(/Resíduos de rateio: 1/)).toBeInTheDocument();
    });
  });

  it("13. Trata erro 403 e erro genérico na visão mensal", async () => {
    const forbiddenError = new Error("Acesso negado");
    (forbiddenError as any).status = 403;

    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockRejectedValue(forbiddenError);

    render(<RelatorioGerencialPage />);

    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Acesso Restrito")).toBeInTheDocument();
    });
  });

  it("14. envia categoryId no novo batch mensal", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    const categoryFilter = await screen.findByLabelText("Filtrar por Categoria");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Serviços/ })).toBeInTheDocument();
    });
    fireEvent.change(categoryFilter, { target: { value: "cat-1" } });

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: "cat-1" }),
        expect.anything()
      );
    });
  });

  it("15. exibe erro mensal genérico e refaz o batch ao tentar novamente", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport)
      .mockRejectedValueOnce(new Error("Falha mensal"))
      .mockResolvedValueOnce(mockMonthlyReport);

    render(<RelatorioGerencialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    await waitFor(() => {
      expect(screen.getByText("Falha mensal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Comparativo Mensal")).toBeInTheDocument();
    });
  });

  it("16. aborta request anterior e impede resposta stale de sobrescrever a mais nova", async () => {
    const first = deferred<client.MonthlyManagementReport>();
    const second = deferred<client.MonthlyManagementReport>();
    const newestReport: client.MonthlyManagementReport = {
      ...mockMonthlyReport,
      sections: {
        ...mockMonthlyReport.sections,
        revenue: [{ ...mockMonthlyReport.sections.revenue[0], name: "Receitas mais novas" }],
      },
    };
    const staleReport: client.MonthlyManagementReport = {
      ...mockMonthlyReport,
      sections: {
        ...mockMonthlyReport.sections,
        revenue: [{ ...mockMonthlyReport.sections.revenue[0], name: "Receitas antigas" }],
      },
    };

    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<RelatorioGerencialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));
    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(1);
    });
    const firstSignal = vi.mocked(client.fetchMonthlyManagementReport).mock.calls[0][1]!;

    fireEvent.click(screen.getByRole("button", { name: "6 meses" }));
    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(2);
      expect(firstSignal.aborted).toBe(true);
    });

    await act(async () => second.resolve(newestReport));
    expect(await screen.findByText("Receitas mais novas")).toBeInTheDocument();

    await act(async () => first.resolve(staleReport));
    expect(screen.getByText("Receitas mais novas")).toBeInTheDocument();
    expect(screen.queryByText("Receitas antigas")).toBeNull();
  });

  it("17. aborta no unmount e ignora AbortError", async () => {
    const pending = deferred<client.MonthlyManagementReport>();
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockReturnValueOnce(pending.promise);

    const { unmount } = render(<RelatorioGerencialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));
    await waitFor(() => {
      expect(client.fetchMonthlyManagementReport).toHaveBeenCalledTimes(1);
    });
    const signal = vi.mocked(client.fetchMonthlyManagementReport).mock.calls[0][1]!;

    unmount();
    expect(signal.aborted).toBe(true);

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    await act(async () => pending.reject(abortError));
  });

  it("18. exibe AV/AH do resultado antes dos investimentos e mantém geometria sticky determinística", async () => {
    vi.mocked(client.fetchManagementReport).mockResolvedValue(mockReport);
    vi.mocked(client.fetchMonthlyManagementReport).mockResolvedValue(mockMonthlyReport);

    render(<RelatorioGerencialPage />);
    fireEvent.click(screen.getByRole("button", { name: "Comparativo mensal" }));

    const resultLabel = await screen.findByText("(=) RESULTADO ANTES DOS INVESTIMENTOS");
    const resultRow = resultLabel.closest("tr");
    expect(resultRow).not.toBeNull();
    expect(within(resultRow!).getByText("+56.3%")).toBeInTheDocument();
    expect(within(resultRow!).getByText("+17.8%")).toBeInTheDocument();
    expect(within(resultRow!).getAllByText("—").length).toBeGreaterThanOrEqual(2);

    const codeHeader = screen.getByRole("columnheader", { name: "Código" });
    const structureHeader = screen.getByRole("columnheader", { name: "Estrutura de Contas" });
    expect(codeHeader).toHaveClass("left-0", "w-24", "min-w-24", "max-w-24");
    expect(structureHeader).toHaveClass("left-24", "min-w-[200px]");

    const table = codeHeader.closest("table");
    expect(table).not.toBeNull();
    expect(table!.parentElement).toHaveClass("overflow-x-auto");

    const codeStickyCells = Array.from(table!.querySelectorAll<HTMLElement>(".sticky.left-0"));
    const structureStickyCells = Array.from(table!.querySelectorAll<HTMLElement>(".sticky.left-24"));
    expect(codeStickyCells.length).toBeGreaterThan(0);
    expect(structureStickyCells).toHaveLength(codeStickyCells.length);
    codeStickyCells.forEach((cell) => {
      expect(cell).toHaveClass("w-24", "min-w-24", "max-w-24");
    });
    structureStickyCells.forEach((cell) => {
      expect(cell).toHaveClass("left-24", "min-w-[200px]");
    });
    Array.from(table!.querySelectorAll<HTMLElement>(".sticky")).forEach((cell) => {
      expect(cell.classList.contains("left-[64px]")).toBe(false);
    });
  });
});
