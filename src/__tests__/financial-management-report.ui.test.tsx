/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
        })
      );
    });
  });
});
