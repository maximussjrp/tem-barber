/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FluxoCaixaPage from "@/app/admin/financeiro/fluxo-caixa/page";
import * as client from "@/lib/financial/cash-flow-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/financeiro/fluxo-caixa",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/lib/financial/cash-flow-client", () => ({
  fetchCashFlowReport: vi.fn(),
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

const mockReport: client.CashFlowReport = {
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
    receivable: "50.00",
    payable: "20.00",
    net: "30.00",
  },
  undated: {
    customerReceivables: "75.00",
    commissionPayables: "300.00",
    tipPayables: "40.00",
    clubApprovedPayables: "120.00",
  },
  forecastMeta: {
    virtualRoutineCount: 1,
    estimatedRoutineCount: 0,
    unprojectableRoutineCount: 0,
    allocationResidualCount: 0,
  },
  daily: [
    {
      date: "2026-06-15",
      realizedIn: "1500.00",
      realizedOut: "450.00",
      realizedNet: "1050.00",
      projectedIn: "200.00",
      projectedOut: "100.00",
      projectedNet: "100.00",
      expectedNetDelta: "1150.00",
    },
  ],
  upcoming: [
    {
      id: "title-1",
      source: "TITLE",
      kind: "PAYABLE",
      title: "Conta de Energia",
      dueOn: "2026-06-20",
      amount: "100.00",
      category: {
        id: "cat-luz",
        code: "03.01",
        name: "Energia Elétrica",
        classification: "FIXED_EXPENSE",
      },
      confidence: "COMMITTED",
      isOverdue: false,
    },
  ],
  categoryBreakdown: [
    {
      categoryId: "cat-1",
      code: "01.01",
      name: "Serviços",
      classification: "REVENUE",
      realizedIn: "1500.00",
      realizedOut: "0.00",
      projectedIn: "200.00",
      projectedOut: "0.00",
    },
  ],
};

describe("FluxoCaixaPage — UI Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renderiza navegação e título principal", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    expect(screen.getByRole("heading", { name: "Fluxo de Caixa e Projeção" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fluxo de Caixa" })).toBeInTheDocument();
  });

  it("2. Renderiza os blocos de Realizado, Projetado e Resultado Esperado", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    await waitFor(() => {
      expect(screen.getByText("Resultado realizado")).toBeInTheDocument();
      expect(screen.getByText("Resultado projetado")).toBeInTheDocument();
      expect(screen.getByText("Resultado esperado no período")).toBeInTheDocument();
    });

    // Jamais apresentar o termo proibido "saldo bancário"
    expect(screen.queryByText(/saldo bancário/i)).not.toBeInTheDocument();
  });

  it("3. Renderiza blocos de Vencidos e Valores sem vencimento definido", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    await waitFor(() => {
      expect(screen.getByText("Vencidos")).toBeInTheDocument();
      expect(screen.getByText("Valores sem vencimento definido")).toBeInTheDocument();
      expect(screen.getByText("Recebíveis de clientes")).toBeInTheDocument();
      expect(screen.getByText("Comissões a pagar")).toBeInTheDocument();
      expect(screen.getByText("Gorjetas a repassar")).toBeInTheDocument();
      expect(screen.getByText("Repasses Clube (aprovados)")).toBeInTheDocument();
    });
  });

  it("4. Renderiza Próximos Vencimentos e tabela/cards diários", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    await waitFor(() => {
      expect(screen.getByText("Próximos Vencimentos")).toBeInTheDocument();
      expect(screen.getByText("Conta de Energia")).toBeInTheDocument();
      expect(screen.getByText("Realizado x Projetado por Data")).toBeInTheDocument();
    });
  });

  it("5. Exibe aviso de rotinas variáveis sem valor base quando unprojectableRoutineCount > 0", async () => {
    const reportWithWarning: client.CashFlowReport = {
      ...mockReport,
      forecastMeta: {
        ...mockReport.forecastMeta,
        unprojectableRoutineCount: 2,
      },
    };

    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(reportWithWarning);
    render(<FluxoCaixaPage />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/Há 2 recorrência\(s\) variável\(is\) sem valor base/)).toBeInTheDocument();
    });
  });

  it("6. Trata erro 403 amigavelmente", async () => {
    const forbiddenError = new Error("Acesso negado");
    (forbiddenError as any).status = 403;
    vi.mocked(client.fetchCashFlowReport).mockRejectedValue(forbiddenError);

    render(<FluxoCaixaPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Acesso Restrito")).toBeInTheDocument();
    });
  });

  it("7. Permite alterar presets e filtros", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    const next30Btn = screen.getByRole("button", { name: "Próximos 30 dias" });
    fireEvent.click(next30Btn);

    expect(client.fetchCashFlowReport).toHaveBeenCalled();
  });

  it("PRESET_60_DAYS, PRESET_90_DAYS e CUSTOM_PERIOD: aciona busca com filtros esperados", async () => {
    vi.mocked(client.fetchCashFlowReport).mockResolvedValue(mockReport);
    render(<FluxoCaixaPage />);

    // PRESET_60_DAYS
    const next60Btn = screen.getByRole("button", { name: "Próximos 60 dias" });
    expect(next60Btn).toBeInTheDocument();
    fireEvent.click(next60Btn);
    expect(client.fetchCashFlowReport).toHaveBeenCalled();

    // PRESET_90_DAYS
    const next90Btn = screen.getByRole("button", { name: "Próximos 90 dias" });
    expect(next90Btn).toBeInTheDocument();
    fireEvent.click(next90Btn);
    expect(client.fetchCashFlowReport).toHaveBeenCalled();

    // CUSTOM_PERIOD
    const customBtn = screen.getByRole("button", { name: "Personalizado" });
    expect(customBtn).toBeInTheDocument();
    fireEvent.click(customBtn);

    // Inputs de data
    const dateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(dateInputs[0], { target: { value: "2026-07-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-07-15" } });

    await waitFor(() => {
      expect(client.fetchCashFlowReport).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2026-07-01",
          endDate: "2026-07-15",
        })
      );
    });
  });
});
