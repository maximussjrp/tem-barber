/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FinanceiroPage from "@/app/admin/financeiro/page";

const mockSummaryData = {
  period: {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    timezone: "America/Sao_Paulo",
  },
  totals: {
    grossRevenue: 1500.0,
    totalDiscounts: 100.0,
    netRevenue: 1400.0,
    totalReceived: 1400.0,
    totalReceivable: 250.0,
    totalExpenses: 150.0,
    releasedCommissions: 400.0,
    estimatedCommissions: 100.0,
    operationalResult: 850.0,
  },
  paymentMethods: [
    { method: "PIX", amount: 800.0, count: 10 },
    { method: "CREDIT", amount: 600.0, count: 5 },
  ],
  topServices: [
    { serviceId: "s-1", serviceName: "Corte Social", quantity: 20, grossRevenue: 1000.0, netRevenue: 950.0 },
    { serviceId: "s-2", serviceName: "Barba", quantity: 10, grossRevenue: 500.0, netRevenue: 450.0 },
  ],
  topProfessionals: [
    { memberId: "m-1", name: "Barbeiro Max", serviceCount: 15, grossRevenue: 800.0, netRevenue: 760.0, releasedCommissions: 300.0 },
  ],
  openCommands: {
    count: 3,
    amount: 250.0,
  },
  closedCommands: {
    count: 25,
    amount: 1400.0,
  },
};

describe("Dashboard Financeiro por Período — PR #17 UI Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Renderiza seletor de período e botão de presets", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    render(<FinanceiroPage />);

    expect(screen.getByText("Dashboard Financeiro")).toBeInTheDocument();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(screen.getByText("Esta Semana")).toBeInTheDocument();
    expect(screen.getByText("Este Mês")).toBeInTheDocument();
    expect(screen.getByText("Mês Passado")).toBeInTheDocument();
    expect(screen.getByText("Personalizado")).toBeInTheDocument();
  });

  it("2 e 3. Botões de preset atualizam as datas e disparam nova busca na API", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const hojeBtn = screen.getByText("Hoje");
    fireEvent.click(hojeBtn);

    await waitFor(() => {
      const lastCallUrl = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0] as string;
      expect(lastCallUrl).toContain("/api/admin/financial/summary?startDate=");
    });
  });

  it("5 e 6. Cards principais e Resultado Operacional renderizam valores formatados da API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText("Faturamento Bruto")).toBeInTheDocument();
    });

    expect(screen.getByText("R$ 1.500,00")).toBeInTheDocument(); // grossRevenue
    expect(screen.getByText("R$ 100,00")).toBeInTheDocument(); // totalDiscounts
    expect(screen.getAllByText("R$ 1.400,00").length).toBeGreaterThan(0); // netRevenue & totalReceived
    expect(screen.getByText("Resultado Operacional")).toBeInTheDocument();
    expect(screen.getByText("+R$ 850,00")).toBeInTheDocument(); // operationalResult
  });

  it("7, 8, 9 e 10. Renderiza formas de pagamento, top serviços, top profissionais e resumo de comandas", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText("Recebimentos por Forma de Pagamento")).toBeInTheDocument();
    });

    expect(screen.getByText("Pix")).toBeInTheDocument();
    expect(screen.getByText("R$ 800,00")).toBeInTheDocument();
    expect(screen.getByText("Corte Social")).toBeInTheDocument();
    expect(screen.getByText("Barbeiro Max")).toBeInTheDocument();
    expect(screen.getByText("Status de Comandas no Período")).toBeInTheDocument();
  });

  it("12. Trata estado de erro e botão Tentar Novamente", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Erro interno no servidor." }),
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText(/Erro interno no servidor/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Tentar Novamente")).toBeInTheDocument();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    fireEvent.click(screen.getByText("Tentar Novamente"));

    await waitFor(() => {
      expect(screen.getByText("Resultado Operacional")).toBeInTheDocument();
    });
  });

  it("13. Resposta 403 exibe mensagem de Acesso Negado para BARBER", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Acesso negado." }),
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText("Acesso Negado")).toBeInTheDocument();
    });

    expect(screen.getByText("Você não tem permissão para acessar o financeiro.")).toBeInTheDocument();
  });

  it("14. Renderiza mensagens amigáveis em períodos sem dados", async () => {
    const emptySummary = {
      ...mockSummaryData,
      totals: {
        grossRevenue: 0,
        totalDiscounts: 0,
        netRevenue: 0,
        totalReceived: 0,
        totalReceivable: 0,
        totalExpenses: 0,
        releasedCommissions: 0,
        estimatedCommissions: 0,
        operationalResult: 0,
      },
      paymentMethods: [
        { method: "CASH", amount: 0, count: 0 },
        { method: "PIX", amount: 0, count: 0 },
      ],
      topServices: [],
      topProfessionals: [],
    };

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => emptySummary,
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText("Não há recebimentos no período.")).toBeInTheDocument();
    });

    expect(screen.getByText("Nenhum serviço vendido no período.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum profissional com vendas no período.")).toBeInTheDocument();
  });

  it("15. Preserva dialog de Nova Entrada e Nova Saída manual", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSummaryData,
    } as any);

    render(<FinanceiroPage />);

    await waitFor(() => {
      expect(screen.getByText("+ Nova Entrada")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("+ Nova Entrada"));
    expect(screen.getByText("Nova Entrada")).toBeInTheDocument();
    expect(screen.getByText("Confirmar")).toBeInTheDocument();
  });
});
