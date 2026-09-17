/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContasPage from "@/app/admin/financeiro/contas/page";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mockCategories = [
  {
    id: "cat-1",
    code: "2.1",
    name: "Custo Variável",
    classification: "VARIABLE_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-2",
    code: "1.1",
    name: "Receita de Serviços",
    classification: "REVENUE",
    isActive: true,
    isLeaf: true,
    children: [],
  },
];

const mockTitlesResponse = {
  items: [
    {
      id: "title-1",
      barbershopId: "b-1",
      kind: "PAYABLE",
      title: "Aluguel da Barbearia",
      description: "Mensalidade referente a julho",
      originalAmount: "2500.00",
      issuedOn: "2026-07-01",
      dueOn: "2026-07-10",
      cancelledAt: null,
      cancelReason: null,
      category: {
        id: "cat-1",
        code: "2.1",
        name: "Custo Variável",
        classification: "VARIABLE_COST",
      },
      derivedStatus: "OPEN",
      settledPrincipal: "0.00",
      outstandingPrincipal: "2500.00",
    },
    {
      id: "title-2",
      barbershopId: "b-1",
      kind: "RECEIVABLE",
      title: "Contrato de Evento",
      description: "Pacote noivas",
      originalAmount: "1200.00",
      issuedOn: "2026-07-05",
      dueOn: "2026-07-15",
      cancelledAt: null,
      cancelReason: null,
      category: {
        id: "cat-2",
        code: "1.1",
        name: "Receita de Serviços",
        classification: "REVENUE",
      },
      derivedStatus: "PAID",
      settledPrincipal: "1200.00",
      outstandingPrincipal: "0.00",
    },
  ],
  total: 2,
  page: 1,
  limit: 10,
  totalPages: 1,
};

const mockTitleDetail = {
  ...mockTitlesResponse.items[0],
  createdBy: { id: "user-1", name: "Dono Barbearia", email: "dono@barber.com" },
  activeSettlements: [
    {
      id: "st-1",
      principalAmount: "500.00",
      discountAmount: "0.00",
      interestAmount: "0.00",
      fineAmount: "0.00",
      netCash: "500.00",
      method: "PIX",
      settledAt: "2026-07-05T12:00:00.000Z",
      notes: "Pagamento parcial",
    },
  ],
};

describe("Contas a Pagar / Receber — UX-B UI Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupFetchMock(titlesResp = mockTitlesResponse) {
    return vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockCategories,
        } as any;
      }
      if (urlStr.includes("/api/admin/financial/titles/title-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockTitleDetail,
        } as any;
      }
      if (urlStr.includes("/api/admin/financial/titles")) {
        return {
          ok: true,
          status: 200,
          json: async () => titlesResp,
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as any;
    });
  }

  it("1. Renderiza lista de contas com badges e contrato real activeSettlements", async () => {
    setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Contas a Pagar / Receber")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("A pagar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A receber").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Em aberto").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quitada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 2.500,00").length).toBeGreaterThan(0);
  });

  it("2. Renderiza estado de erro genérico HTTP 500 e botão Tentar Novamente", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: "Erro de teste interno." }),
      } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Erro de teste interno.")).toBeInTheDocument();
    });

    expect(screen.getByText("Tentar Novamente")).toBeInTheDocument();

    fetchSpy.mockImplementationOnce(async () => {
      return { ok: true, status: 200, json: async () => mockTitlesResponse } as any;
    });

    fireEvent.click(screen.getByText("Tentar Novamente"));

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });
  });

  it("3. Renderiza card de Acesso Negado em resposta 403 (SUPER_ADMIN sem sessão)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => [] } as any;
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: "Sessão financeira necessária." }),
      } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Acesso Negado")).toBeInTheDocument();
    });

    expect(screen.getByText(/Você não possui permissão para visualizar dados financeiros/i)).toBeInTheDocument();
  });

  it("4. Teste de Paginação real: clica em Próxima e altera filtro para resetar página", async () => {
    const multiPageResp = {
      ...mockTitlesResponse,
      page: 1,
      totalPages: 2,
      total: 15,
    };
    const fetchSpy = setupFetchMock(multiPageResp);

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Próxima")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Próxima"));

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(([u]) => u.toString());
      const page2Call = calls.find((c) => c.includes("page=2"));
      expect(page2Call).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText("Nome do título...");
    fireEvent.change(searchInput, { target: { value: "Aluguel" } });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(([u]) => u.toString());
      const resetPageCall = calls[calls.length - 1];
      expect(resetPageCall).toContain("page=1");
      expect(resetPageCall).toContain("q=Aluguel");
    });
  });

  it("5. Modal Nova Conta: Filtro de Categorias por Kind provado via DOM", async () => {
    setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Conta")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Nova Conta"));

    await waitFor(() => {
      expect(screen.getByText("Nova Conta / Título")).toBeInTheDocument();
    });

    const categorySelect = screen.getByDisplayValue("Selecione uma categoria...");

    // Padrão: PAYABLE -> Opção VARIABLE_COST em DOM, REVENUE ausente
    expect(categorySelect.textContent).toContain("2.1 - Custo Variável");
    expect(categorySelect.textContent).not.toContain("1.1 - Receita de Serviços");

    // Mudar para RECEIVABLE
    fireEvent.click(screen.getByText("Conta a receber"));

    // Opção REVENUE em DOM, VARIABLE_COST ausente no select
    expect(categorySelect.textContent).toContain("1.1 - Receita de Serviços");
    expect(categorySelect.textContent).not.toContain("2.1 - Custo Variável");
  });

  it("6. Efetua Baixa com Idempotency-Key UUID v4 real verificado via Regex", async () => {
    const fetchSpy = setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    const actionBtns = screen.getAllByText("Ver / Ações");
    fireEvent.click(actionBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dar Baixa / Quitar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dar Baixa / Quitar" }));

    await waitFor(() => {
      expect(screen.getByText("Valor Principal a Quitar (R$) *")).toBeInTheDocument();
    });

    const settleBtn = screen.getByText("Confirmar Baixa");
    fireEvent.click(settleBtn);

    await waitFor(() => {
      const settlementCalls = fetchSpy.mock.calls.filter(([u, o]) =>
        u.toString().includes("/settlements") && o?.method === "POST"
      );
      expect(settlementCalls.length).toBe(1);
      const [, opts] = settlementCalls[0];
      const headers = (opts as any).headers;
      const key = headers["Idempotency-Key"];
      expect(key).toMatch(UUID_REGEX);
    });
  });

  it("7. Net Cash Zero: principal=100, discount=100 envia method: null no POST", async () => {
    const fetchSpy = setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Ver / Ações")[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dar Baixa / Quitar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dar Baixa / Quitar" }));

    await waitFor(() => {
      expect(screen.getByText("Valor Principal a Quitar (R$) *")).toBeInTheDocument();
    });

    // Initial principal value is "2500.00"
    const principalInput = screen.getByDisplayValue("2500.00");
    fireEvent.change(principalInput, { target: { value: "100" } });

    // Initial discount input is the first input with value "0"
    const discountInput = screen.getAllByDisplayValue("0")[0];
    fireEvent.change(discountInput, { target: { value: "100" } });

    expect(screen.getByDisplayValue("Sem movimento financeiro (R$ 0,00)")).toBeDisabled();

    fireEvent.click(screen.getByText("Confirmar Baixa"));

    await waitFor(() => {
      const settlementCalls = fetchSpy.mock.calls.filter(([u, o]) =>
        u.toString().includes("/settlements") && o?.method === "POST"
      );
      expect(settlementCalls.length).toBe(1);
      const [, opts] = settlementCalls[0];
      const body = JSON.parse((opts as any).body);
      expect(body.principalAmount).toBe(100);
      expect(body.discountAmount).toBe(100);
      expect(body.method).toBeNull();
    });
  });

  it("8. Lock de Double Submit: duas tentativas de submit disparam exatamente 1 POST /settlements", async () => {
    let resolvePromise: (val: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, opts) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (urlStr.includes("/api/admin/financial/titles/title-1")) {
        return { ok: true, status: 200, json: async () => mockTitleDetail } as any;
      }
      if (urlStr.includes("/settlements") && opts?.method === "POST") {
        return pendingPromise as any;
      }
      return { ok: true, status: 200, json: async () => mockTitlesResponse } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Ver / Ações")[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dar Baixa / Quitar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dar Baixa / Quitar" }));

    await waitFor(() => {
      expect(screen.getByText("Confirmar Baixa")).toBeInTheDocument();
    });

    const btn = screen.getByText("Confirmar Baixa");
    fireEvent.click(btn);
    fireEvent.click(btn);

    const settlementCalls = fetchSpy.mock.calls.filter(([u, o]) =>
      u.toString().includes("/settlements") && o?.method === "POST"
    );
    expect(settlementCalls.length).toBe(1);

    // Limpar promessa
    resolvePromise!({ ok: true, status: 200, json: async () => ({}) });
  });

  it("9. Permite limpar observações no PATCH enviando description: null", async () => {
    const fetchSpy = setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Ver / Ações")[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Mensalidade referente a julho")).toBeInTheDocument();
    });

    const descInput = screen.getByDisplayValue("Mensalidade referente a julho");
    fireEvent.change(descInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => {
      const patchCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "PATCH");
      expect(patchCalls.length).toBe(1);
      const [, opts] = patchCalls[0];
      const body = JSON.parse((opts as any).body);
      expect(body.description).toBeNull();
      expect(body.kind).toBeUndefined();
    });
  });

  it("10. Histórico de baixas renderiza o contrato real activeSettlements", async () => {
    setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Ver / Ações")[0]);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Baixas (1)")).toBeInTheDocument();
    });

    expect(screen.getByText("R$ 500,00 (PIX)")).toBeInTheDocument();
    expect(screen.getByText("Notas: Pagamento parcial")).toBeInTheDocument();
  });

  it("11. Race test da listagem: ignora resposta obsoleta de filtro antigo", async () => {
    let resolveReqA: (val: any) => void;
    const reqAPromise = new Promise((res) => {
      resolveReqA = res;
    });

    const respB = {
      ...mockTitlesResponse,
      items: [
        {
          ...mockTitlesResponse.items[0],
          id: "title-b",
          title: "Resultado Filtro B",
        },
      ],
    };

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (urlStr.includes("q=FiltroA")) {
        return reqAPromise as any;
      }
      if (urlStr.includes("q=FiltroB")) {
        return { ok: true, status: 200, json: async () => respB } as any;
      }
      return { ok: true, status: 200, json: async () => mockTitlesResponse } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText("Nome do título...");

    // Dispara Filtro A (pendente)
    fireEvent.change(searchInput, { target: { value: "FiltroA" } });

    // Rapidamente dispara Filtro B
    fireEvent.change(searchInput, { target: { value: "FiltroB" } });

    // Aguarda resultado de B
    await waitFor(() => {
      expect(screen.getAllByText("Resultado Filtro B").length).toBeGreaterThan(0);
    });

    // Agora resolve A tarde
    resolveReqA!({
      ok: true,
      status: 200,
      json: async () => ({
        ...mockTitlesResponse,
        items: [{ ...mockTitlesResponse.items[0], id: "title-a", title: "Resultado Stale A" }],
      }),
    });

    // UI deve permanecer exibindo B (A foi abortado/ignorado)
    await waitFor(() => {
      expect(screen.queryByText("Resultado Stale A")).not.toBeInTheDocument();
      expect(screen.getAllByText("Resultado Filtro B").length).toBeGreaterThan(0);
    });
  });

  it("12. Race test do detalhe: aborta GET de title A se mudar para title B", async () => {
    let resolveReqDetailA: (val: any) => void;
    const reqDetailAPromise = new Promise((res) => {
      resolveReqDetailA = res;
    });

    const detailB = {
      ...mockTitleDetail,
      id: "title-2",
      title: "Detalhe Título B",
    };

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (urlStr.includes("/api/admin/financial/titles/title-1")) {
        return reqDetailAPromise as any;
      }
      if (urlStr.includes("/api/admin/financial/titles/title-2")) {
        return { ok: true, status: 200, json: async () => detailB } as any;
      }
      return { ok: true, status: 200, json: async () => mockTitlesResponse } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    // Abrir title 1 (GET fica pendente)
    const actionBtns = screen.getAllByText("Ver / Ações");
    fireEvent.click(actionBtns[0]);

    // Rapidamente clicar em title 2
    fireEvent.click(actionBtns[1]);

    // Detalhe de B deve carregar
    await waitFor(() => {
      expect(screen.getByText("Detalhe Título B")).toBeInTheDocument();
    });

    // Agora resolve GET de A
    resolveReqDetailA!({
      ok: true,
      status: 200,
      json: async () => ({ ...mockTitleDetail, title: "Detalhe Stale A" }),
    });

    // Modal deve continuar exibindo B
    await waitFor(() => {
      expect(screen.queryByText("Detalhe Stale A")).not.toBeInTheDocument();
      expect(screen.getByText("Detalhe Título B")).toBeInTheDocument();
    });
  });

  it("13. Estado Vazio: renderiza mensagem Nenhuma conta encontrada...", async () => {
    const emptyResp = {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    };
    setupFetchMock(emptyResp);

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nenhuma conta encontrada com os filtros selecionados.")).toBeInTheDocument();
    });
  });

  it("14. Filtros de Tipo (PAYABLE / RECEIVABLE) adicionam kind na query String do fetch", async () => {
    const fetchSpy = setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    // Clicar em "Contas a Pagar"
    fireEvent.click(screen.getByRole("button", { name: "Contas a Pagar" }));

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(([u]) => u.toString());
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toContain("kind=PAYABLE");
    });

    // Clicar em "Contas a Receber"
    fireEvent.click(screen.getByRole("button", { name: "Contas a Receber" }));

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(([u]) => u.toString());
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toContain("kind=RECEIVABLE");
    });
  });

  it("15. Cancelamento de título envia POST /cancel com body { reason } e NUNCA usa DELETE", async () => {
    const fetchSpy = setupFetchMock();
    const detailWithoutSettlements = {
      ...mockTitleDetail,
      activeSettlements: [],
      derivedStatus: "OPEN",
    };

    fetchSpy.mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (urlStr.includes("/api/admin/financial/titles/title-1")) {
        return { ok: true, status: 200, json: async () => detailWithoutSettlements } as any;
      }
      return { ok: true, status: 200, json: async () => mockTitlesResponse } as any;
    });

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel da Barbearia").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Ver / Ações")[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Explique o motivo do cancelamento desta conta...")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Explique o motivo do cancelamento desta conta...");
    fireEvent.change(textarea, { target: { value: "Conta duplicada por engano" } });

    fireEvent.click(screen.getByText("Confirmar Cancelamento"));

    await waitFor(() => {
      const cancelCalls = fetchSpy.mock.calls.filter(([u, o]) =>
        u.toString().includes("/cancel") && o?.method === "POST"
      );
      expect(cancelCalls.length).toBe(1);
      const [, opts] = cancelCalls[0];
      const body = JSON.parse((opts as any).body);
      expect(body.reason).toBe("Conta duplicada por engano");

      const deleteCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "DELETE");
      expect(deleteCalls.length).toBe(0);
    });
  });

  it("16. Modal Nova Conta: reseta tipo de conta para PAYABLE ao fechar e reabrir", async () => {
    setupFetchMock();

    render(<ContasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Conta")).toBeInTheDocument();
    });

    // 1. Abrir modal
    fireEvent.click(screen.getByText("Nova Conta"));

    await waitFor(() => {
      expect(screen.getByText("Nova Conta / Título")).toBeInTheDocument();
    });

    // 2. Mudar tipo para "Conta a receber"
    fireEvent.click(screen.getByText("Conta a receber"));

    // 3. Fechar modal via botão Cancelar
    fireEvent.click(screen.getByText("Cancelar"));

    await waitFor(() => {
      expect(screen.queryByText("Nova Conta / Título")).not.toBeInTheDocument();
    });

    // 4. Reabrir modal
    fireEvent.click(screen.getByText("Nova Conta"));

    await waitFor(() => {
      expect(screen.getByText("Nova Conta / Título")).toBeInTheDocument();
    });

    // 5. Categoria deve ter voltado para as de PAYABLE (Custo Variável presente)
    const categorySelect = screen.getByDisplayValue("Selecione uma categoria...");
    expect(categorySelect.textContent).toContain("2.1 - Custo Variável");
    expect(categorySelect.textContent).not.toContain("1.1 - Receita de Serviços");
  });
});
