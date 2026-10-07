/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MovimentacoesPage from "@/app/admin/financeiro/movimentacoes/page";

const mockCategories = [
  {
    id: "cat-1",
    code: "01.01",
    name: "Serviços de Cabelo",
    classification: "REVENUE",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-2",
    code: "02.01",
    name: "Produtos de Barba",
    classification: "REVENUE",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-3",
    code: "03.01",
    name: "Aluguel",
    classification: "FIXED_EXPENSE",
    isActive: true,
    isLeaf: true,
    children: [],
  },
];

const mockMovementsResponse = {
  items: [
    {
      id: "entry-1",
      type: "COMMAND_REVENUE",
      amount: "100.00",
      description: "Comanda Mista #123 (Serviço + Produto)",
      entryDate: "2026-07-10T14:30:00.000Z",
      direction: "IN",
      allocationStatus: "ALLOCATED",
      sourceRefs: {
        comandaId: "cmd-123",
        financialSettlementId: null,
      },
      allocations: [
        {
          id: "alloc-srv-1",
          allocatedAmount: "65.00",
          financialCategory: {
            id: "cat-1",
            code: "01.01",
            name: "Serviços de Cabelo",
            classification: "REVENUE",
          },
        },
        {
          id: "alloc-prd-2",
          allocatedAmount: "35.00",
          financialCategory: {
            id: "cat-2",
            code: "02.01",
            name: "Produtos de Barba",
            classification: "REVENUE",
          },
        },
      ],
    },
    {
      id: "entry-2",
      type: "MANUAL_OUT",
      amount: "-1500.00",
      description: "Pagamento Aluguel Julho",
      entryDate: "2026-07-09T10:00:00.000Z",
      direction: "OUT",
      allocationStatus: "ALLOCATED",
      sourceRefs: {
        financialSettlementId: "set-456",
      },
      allocations: [
        {
          id: "alloc-3",
          allocatedAmount: "1500.00",
          financialCategory: {
            id: "cat-3",
            code: "03.01",
            name: "Aluguel",
            classification: "FIXED_EXPENSE",
          },
        },
      ],
    },
    {
      id: "entry-3",
      type: "TIP_RECEIVED",
      amount: "15.00",
      description: "Gorjeta Barbeiro Carlos",
      entryDate: "2026-07-08T18:00:00.000Z",
      direction: "IN",
      allocationStatus: "UNALLOCATED",
      sourceRefs: {
        tipEntryId: "tip-789",
      },
      allocations: [],
    },
  ],
  pagination: {
    page: 1,
    limit: 20,
    total: 3,
    totalPages: 1,
  },
};

describe("MovimentacoesPage — UI Suite", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((url: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockCategories,
        } as any);
      }
      if (url.includes("/api/admin/financial/entries")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockMovementsResponse,
        } as any);
      }
      return Promise.resolve({ ok: false, status: 404 } as any);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. renderiza a navegação do módulo financeiro", async () => {
    render(<MovimentacoesPage />);
    expect(screen.getByRole("navigation", { name: /navegação do módulo financeiro/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Movimentações" })).toBeInTheDocument();
  });

  it("2. exibe lista de movimentações com direção IN e OUT formatadas", async () => {
    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Comanda Mista #123 (Serviço + Produto)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Pagamento Aluguel Julho").length).toBeGreaterThan(0);
    });

    // Positive and negative amounts with single explicit sign
    expect(screen.getAllByText(/\+\s*R\$\s*100,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/-\s*R\$\s*1\.500,00/).length).toBeGreaterThan(0);

    // Provar que NÃO existe representação com sinal duplo (ex: - -R$ ou --R$)
    expect(screen.queryByText(/-\s*-\s*R\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/--R\$/)).not.toBeInTheDocument();
  });

  it("3. confirma caso misto SERVICE + PRODUCT com múltiplos allocations renderiza ambas as categorias", async () => {
    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Comanda Mista #123 (Serviço + Produto)").length).toBeGreaterThan(0);
    });

    // Ambas as categorias devem ser visíveis
    expect(screen.getAllByText("Serviços de Cabelo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Produtos de Barba").length).toBeGreaterThan(0);

    // Valores divididos formatados na visualização
    expect(screen.getAllByText(/\(R\$\s*65,00\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(R\$\s*35,00\)/).length).toBeGreaterThan(0);
  });

  it("4. exibe badge 'Fora do plano gerencial' para lançamentos sem alocação contábil", async () => {
    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Gorjeta Barbeiro Carlos").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Fora do plano gerencial").length).toBeGreaterThan(0);
  });

  it("5. trata estado de erro 403 Acesso Negado", async () => {
    fetchSpy.mockImplementation((url: any) => {
      if (url.includes("/api/admin/financial/entries")) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ error: "Forbidden" }),
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as any);
    });

    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getByText("Acesso negado")).toBeInTheDocument();
    });
  });

  it("6. trata estado vazio quando não há itens", async () => {
    fetchSpy.mockImplementation((url: any) => {
      if (url.includes("/api/admin/financial/entries")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          }),
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as any);
    });

    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getByText("Nenhuma movimentação encontrada")).toBeInTheDocument();
    });
  });

  it("7. dispara nova requisição ao alterar filtro de direção", async () => {
    render(<MovimentacoesPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Comanda Mista #123 (Serviço + Produto)").length).toBeGreaterThan(0);
    });

    const directionSelect = screen.getByLabelText("Filtro de direção");
    fireEvent.change(directionSelect, { target: { value: "IN" } });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.filter((c: any[]) =>
        c[0].includes("direction=IN")
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
