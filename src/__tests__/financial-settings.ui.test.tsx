/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConfiguracoesFinanceirasPage from "@/app/admin/financeiro/configuracoes/page";
import {
  findCategoryByCode,
  monthToEndDate,
  monthToStartDate,
  getCurrentCivilMonth,
} from "@/lib/financial/routines-client";

const mockCategories = [
  {
    id: "cat-301",
    code: "03.01",
    name: "Aluguel do Imóvel",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-302",
    code: "03.02",
    name: "Água e Esgoto",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-303",
    code: "03.03",
    name: "Energia Elétrica",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-304",
    code: "03.04",
    name: "Internet & Telecom",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-305",
    code: "03.05",
    name: "Sistemas e Software",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
  {
    id: "cat-306",
    code: "03.06",
    name: "Contabilidade",
    classification: "FIXED_COST",
    isActive: true,
    isLeaf: true,
    children: [],
  },
];

const mockRoutines = [
  {
    id: "routine-1",
    barbershopId: "b-1",
    createdById: "u-1",
    categoryId: "cat-301",
    title: "Aluguel Ponto Central",
    kind: "PAYABLE",
    amountMode: "FIXED",
    baseAmount: "2500.00",
    frequency: "MONTHLY",
    dueDay: 10,
    startDate: "2026-01-01",
    endDate: null,
    startDateCivil: "2026-01-01",
    endDateCivil: null,
    notes: "Contrato de 2 anos",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    category: {
      id: "cat-301",
      code: "03.01",
      name: "Aluguel do Imóvel",
    },
  },
];

describe("ConfiguracoesFinanceirasPage — UX-C Suite", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setupDefaultFetch = () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockCategories,
        } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ routines: mockRoutines }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });
  };

  // Test 1: loading
  it("1. exibe estado de loading enquanto carrega", async () => {
    let resolveCategories: any;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return new Promise((resolve) => {
          resolveCategories = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ routines: [] }),
      });
    });

    render(<ConfiguracoesFinanceirasPage />);
    expect(screen.getByText(/carregando configurações financeiras/i)).toBeInTheDocument();

    resolveCategories({
      ok: true,
      status: 200,
      json: async () => mockCategories,
    });

    await waitFor(() => {
      expect(screen.queryByText(/carregando configurações financeiras/i)).not.toBeInTheDocument();
    });
  });

  // Test 2: 6 presets aparecem
  it("2. exibe os 6 presets do catálogo na tela", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
      expect(screen.getByText("Água")).toBeInTheDocument();
      expect(screen.getByText("Energia")).toBeInTheDocument();
      expect(screen.getByText("Internet e Telefonia")).toBeInTheDocument();
      expect(screen.getByText("Sistemas e Software")).toBeInTheDocument();
      expect(screen.getByText("Contabilidade")).toBeInTheDocument();
    });
  });

  // Test 3: 403 Acesso Negado
  it("3. exibe 'Acesso Negado' quando API retorna 403", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "FORBIDDEN" }),
    } as any);

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Acesso Negado")).toBeInTheDocument();
    });
  });

  // Test 4: 500 + retry
  it("4. exibe erro 500 e recarrega ao clicar em Tentar Novamente", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "Erro interno no servidor" }),
    } as any);

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Erro interno no servidor")).toBeInTheDocument();
      expect(screen.getByText("Tentar Novamente")).toBeInTheDocument();
    });

    setupDefaultFetch();
    fireEvent.click(screen.getByText("Tentar Novamente"));

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });
  });

  // Test 5: resolve categoryId por code
  it("5. resolve categoryId pelo category.code", () => {
    const found = findCategoryByCode(mockCategories as any, "03.01");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("cat-301");
    expect(found?.code).toBe("03.01");
  });

  // Test 6: nome customizado da categoria NÃO quebra preset
  it("6. nome customizado da categoria NÃO quebra preset", () => {
    const customTree = [
      {
        id: "cat-custom",
        code: "03.01",
        name: "Aluguel Comercial do Ponto Matriz",
        classification: "FIXED_COST",
        isActive: true,
        isLeaf: true,
        children: [],
      },
    ];
    const found = findCategoryByCode(customTree as any, "03.01");
    expect(found?.id).toBe("cat-custom");
    expect(found?.name).toBe("Aluguel Comercial do Ponto Matriz");
  });

  // Test 7: categoria ausente => Configurar disabled
  it("7. desabilita o botão Configurar se a categoria estiver ausente no tenant", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return {
          ok: true,
          status: 200,
          json: async () => [], // Empty categories
        } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return { ok: true, status: 200, json: async () => ({ routines: [] }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Categoria financeira indisponível").length).toBe(6);
    });

    const buttons = screen.getAllByRole("button", { name: /configurar/i });
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  // Test 8: 0 rotinas => Configurar
  it("8. 0 rotinas exibe o estado neutro 'Configurar'", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return { ok: true, status: 200, json: async () => ({ routines: [] }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Configurar").length).toBeGreaterThan(0);
    });
  });

  // Test 9: 1 rotina => "1 conta configurada"
  it("9. 1 rotina exibe '1 conta configurada'", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("1 conta configurada")).toBeInTheDocument();
    });
  });

  // Test 10: 2 rotinas mesma category.code => "2 contas configuradas"
  it("10. 2 rotinas na mesma categoria exibem '2 contas configuradas'", async () => {
    const multipleRoutines = [
      {
        id: "routine-sys-1",
        barbershopId: "b-1",
        createdById: "u-1",
        categoryId: "cat-305",
        title: "Tem Barber Software",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: "199.00",
        frequency: "MONTHLY",
        dueDay: 5,
        startDate: "2026-01-01",
        endDate: null,
        isActive: true,
        category: { id: "cat-305", code: "03.05", name: "Sistemas e Software" },
      },
      {
        id: "routine-sys-2",
        barbershopId: "b-1",
        createdById: "u-1",
        categoryId: "cat-305",
        title: "Canva Pro",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: "35.00",
        frequency: "MONTHLY",
        dueDay: 15,
        startDate: "2026-01-01",
        endDate: null,
        isActive: true,
        category: { id: "cat-305", code: "03.05", name: "Sistemas e Software" },
      },
    ];

    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return { ok: true, status: 200, json: async () => ({ routines: multipleRoutines }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("2 contas configuradas")).toBeInTheDocument();
      expect(screen.getByText("Tem Barber Software")).toBeInTheDocument();
      expect(screen.getByText("Canva Pro")).toBeInTheDocument();
    });
  });

  // Test 11: POST correto
  it("11. POST ao criar rotina envia payload correto", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Água")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[1]); // Água preset card

    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Água")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "150.00" } });

    const submitBtn = screen.getByRole("button", { name: /criar rotina/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0] === "/api/admin/financial/routines" && c[1]?.method === "POST"
      );
      expect(postCalls.length).toBe(1);

      const body = JSON.parse(postCalls[0][1].body);
      expect(body.categoryId).toBe("cat-302");
      expect(body.title).toBe("Água");
      expect(body.baseAmount).toBe("150");
      expect(body.amountMode).toBe("VARIABLE");
    });
  });

  // Test 12: POST força kind=PAYABLE, frequency=MONTHLY
  it("12. POST força os campos kind=PAYABLE e frequency=MONTHLY", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Água")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[1]);

    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Água")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "120.00" } });

    const submitBtn = screen.getByRole("button", { name: /criar rotina/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0] === "/api/admin/financial/routines" && c[1]?.method === "POST"
      );
      expect(postCalls.length).toBe(1);

      const body = JSON.parse(postCalls[0][1].body);
      expect(body.kind).toBe("PAYABLE");
      expect(body.frequency).toBe("MONTHLY");
    });
  });

  // Test 13: Aluguel inicia FIXED
  it("13. modal de Aluguel inicia com modo FIXED", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[0]);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("FIXED");
    });
  });

  // Test 14: Água inicia VARIABLE
  it("14. modal de Água inicia com modo VARIABLE", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Água")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[1]);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("VARIABLE");
    });
  });

  // Test 15: usuário consegue mudar amountMode
  it("15. permite alterar o modo entre FIXED e VARIABLE no modal", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[0]);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "VARIABLE" } });
      expect(select.value).toBe("VARIABLE");
    });
  });

  // Test 16: valor > 0 obrigatório para FIXED
  it("16. exige valor > 0 para o modo FIXED", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Aluguel")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "0" } });

    const submitBtn = screen.getByRole("button", { name: /criar rotina/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Informe um valor mensal maior que zero.")).toBeInTheDocument();
    });
  });

  // Test 17: valor > 0 obrigatório para VARIABLE
  it("17. exige valor > 0 para o modo VARIABLE", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Água")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[1]);

    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Água")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "0" } });

    const submitBtn = screen.getByRole("button", { name: /criar rotina/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Informe um valor estimado maior que zero.")).toBeInTheDocument();
    });
  });

  // Test 18: startMonth -> YYYY-MM-01
  it("18. converte startMonth (YYYY-MM) para YYYY-MM-01", () => {
    expect(monthToStartDate("2026-02")).toBe("2026-02-01");
  });

  // Test 19: endMonth -> último dia do mês
  it("19. converte endMonth para o último dia do mês", () => {
    expect(monthToEndDate("2026-02")).toBe("2026-02-28");
    expect(monthToEndDate("2026-04")).toBe("2026-04-30");
  });

  // Test 20: leap year correto
  it("20. calcula ano bissexto corretamente (ex: 2028-02-29)", () => {
    expect(monthToEndDate("2028-02")).toBe("2028-02-29");
  });

  // Test 21: PATCH edição NÃO envia kind, categoryId, frequency
  it("21. PATCH na edição envia APENAS campos editáveis sem enviar kind, categoryId ou frequency", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel Ponto Central")).toBeInTheDocument();
    });

    const editBtn = screen.getByText("Editar");
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText("Editar Rotina — Aluguel")).toBeInTheDocument();
    });

    const titleInput = screen.getByDisplayValue("Aluguel Ponto Central");
    fireEvent.change(titleInput, { target: { value: "Aluguel Ponto Novo" } });

    const submitBtn = screen.getByRole("button", { name: /salvar alterações/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const patchCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0].includes("/api/admin/financial/routines/") && c[1]?.method === "PATCH"
      );
      expect(patchCalls.length).toBe(1);

      const body = JSON.parse(patchCalls[0][1].body);
      expect(body.title).toBe("Aluguel Ponto Novo");
      expect(body.kind).toBeUndefined();
      expect(body.categoryId).toBeUndefined();
      expect(body.frequency).toBeUndefined();
    });
  });

  // Test 22: deactivate usa POST /deactivate
  it("22. desativação chama POST /api/admin/financial/routines/[id]/deactivate", async () => {
    setupDefaultFetch();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Desativar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Desativar"));

    await waitFor(() => {
      const deactivateCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0].includes("/deactivate") && c[1]?.method === "POST"
      );
      expect(deactivateCalls.length).toBe(1);
    });
  });

  // Test 23: reactivate usa PATCH isActive:true
  it("23. reativação chama PATCH com isActive: true", async () => {
    const inactiveRoutines = [
      {
        ...mockRoutines[0],
        id: "routine-inactive",
        isActive: false,
      },
    ];

    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return { ok: true, status: 200, json: async () => ({ routines: inactiveRoutines }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Reativar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Reativar"));

    await waitFor(() => {
      const reactivateCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0].includes("/api/admin/financial/routines/routine-inactive") &&
          c[1]?.method === "PATCH"
      );
      expect(reactivateCalls.length).toBe(1);

      const body = JSON.parse(reactivateCalls[0][1].body);
      expect(body.isActive).toBe(true);
      expect(screen.getByText("Reativar não cria automaticamente meses anteriores.")).toBeInTheDocument();
    });
  });

  // Test 24: nenhum DELETE
  it("24. NENHUMA requisição DELETE é realizada durante operações de UI", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const deleteCalls = fetchSpy.mock.calls.filter((c: any[]) => c[1]?.method === "DELETE");
    expect(deleteCalls.length).toBe(0);
  });

  // Test 25: nenhuma request para /routines/generate
  it("25. NENHUMA requisição para /api/admin/financial/routines/generate é chamada na UX-C", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const generateCalls = fetchSpy.mock.calls.filter((c: any[]) =>
      c[0].includes("/routines/generate")
    );
    expect(generateCalls.length).toBe(0);
  });

  // Test 26: stale list/category response ignorada
  it("26. requisições canceladas por AbortController não sobrescrevem o estado ao desmontar", async () => {
    let signalReceived: AbortSignal | undefined;
    let resolveCategories: any;

    fetchSpy.mockImplementation((url: string, init: any) => {
      signalReceived = init?.signal;
      if (url.includes("/api/admin/financial/categories")) {
        return new Promise((resolve) => {
          resolveCategories = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ routines: [] }),
      });
    });

    const { unmount } = render(<ConfiguracoesFinanceirasPage />);
    expect(signalReceived).toBeDefined();

    unmount();
    expect(signalReceived?.aborted).toBe(true);

    resolveCategories({
      ok: true,
      status: 200,
      json: async () => mockCategories,
    });
  });

  // Test 27: modal reseta corretamente entre aberturas
  it("27. o modal reseta os campos corretamente ao abrir para presets diferentes", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });

    // Open Aluguel modal
    fireEvent.click(configButtons[0]);
    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Aluguel")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "3000" } });

    // Close modal
    fireEvent.click(screen.getByText("Fechar"));

    await waitFor(() => {
      expect(screen.queryByText("Configurar Conta — Aluguel")).not.toBeInTheDocument();
    });

    // Open Água modal
    fireEvent.click(configButtons[1]);
    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Água")).toBeInTheDocument();
      const newValorInput = screen.getByPlaceholderText("0,00") as HTMLInputElement;
      expect(newValorInput.value).toBe(""); // Reset value!
    });
  });

  // Test 28: exibe startDateCivil e endDateCivil no card e no modal de edição
  it("28. exibe startDateCivil e endDateCivil no card e mapeia para o modal de edição sem usar timestamps UTC brutos", async () => {
    const routineWithCivil = [
      {
        id: "routine-civil-1",
        barbershopId: "b-1",
        createdById: "u-1",
        categoryId: "cat-301",
        title: "Aluguel Ponto Central",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: "2500.00",
        frequency: "MONTHLY",
        dueDay: 10,
        startDate: "2026-03-01T03:00:00.000Z",
        endDate: "2027-01-01T02:59:59.999Z",
        startDateCivil: "2026-03-01",
        endDateCivil: "2026-12-31",
        notes: "Contrato",
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        category: {
          id: "cat-301",
          code: "03.01",
          name: "Aluguel do Imóvel",
        },
      },
    ];

    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/financial/categories")) {
        return { ok: true, status: 200, json: async () => mockCategories } as any;
      }
      if (url.includes("/api/admin/financial/routines")) {
        return { ok: true, status: 200, json: async () => ({ routines: routineWithCivil }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel Ponto Central")).toBeInTheDocument();
      expect(screen.getByText(/01\/03\/2026/)).toBeInTheDocument();
      expect(screen.getByText(/31\/12\/2026/)).toBeInTheDocument();
    });

    const editBtn = screen.getByText("Editar");
    fireEvent.click(editBtn);

    const modalTitle = await screen.findByText("Editar Rotina — Aluguel");
    expect(modalTitle).toBeInTheDocument();

    const startMonthInput = screen.getByLabelText(/mês inicial/i) as HTMLInputElement;
    const endMonthInput = screen.getByLabelText(/mês final/i) as HTMLInputElement;
    expect(startMonthInput.value).toBe("2026-03");
    expect(endMonthInput.value).toBe("2026-12");
  });

  // Test 29: getCurrentCivilMonth respeita fuso-horário civil BR em fronteira UTC
  it("29. getCurrentCivilMonth respeita o fuso-horário civil brasileiro em fronteira UTC", () => {
    vi.useFakeTimers();
    // 2026-03-01 01:00:00 UTC = 2026-02-28 22:00:00 BRT
    vi.setSystemTime(new Date("2026-03-01T01:00:00Z"));

    try {
      expect(getCurrentCivilMonth()).toBe("2026-02");
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 30: duplo envio síncrono submitLockRef no modal
  it("30. bloqueia envio duplo síncrono (submitLockRef) na criação e na edição no modal", async () => {
    setupDefaultFetch();
    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Água")).toBeInTheDocument();
    });

    const configButtons = screen.getAllByRole("button", { name: /configurar nova conta/i });
    fireEvent.click(configButtons[1]); // Água

    await waitFor(() => {
      expect(screen.getByText("Configurar Conta — Água")).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "150.00" } });

    const submitBtn = screen.getByRole("button", { name: /criar rotina/i });
    // Double click fast
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0] === "/api/admin/financial/routines" && c[1]?.method === "POST"
      );
      expect(postCalls.length).toBe(1);
    });
  });

  // Test 31: duplo clique síncrono routineActionLocksRef em desativar e reativar
  it("31. bloqueia duplo clique síncrono (routineActionLocksRef) em desativar e reativar", async () => {
    setupDefaultFetch();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Desativar")).toBeInTheDocument();
    });

    const deactivateBtn = screen.getByText("Desativar");
    fireEvent.click(deactivateBtn);
    fireEvent.click(deactivateBtn);

    await waitFor(() => {
      const deactivateCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0].includes("/deactivate") && c[1]?.method === "POST"
      );
      expect(deactivateCalls.length).toBe(1);
    });
  });

  // Test 32: aborta requisição antiga (loadControllerRef) em múltiplos recarregamentos
  it("32. cancela sinal da requisição em andamento (loadControllerRef) quando novo recarregamento é disparado", async () => {
    let callCount = 0;
    const signals: AbortSignal[] = [];

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        callCount++;
        if (init?.signal) signals.push(init.signal);

        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: "Erro 500" }) });
        }
        if (callCount === 2) {
          return new Promise(() => {}); // hangs
        }
      }
      if (url.includes("/api/admin/financial/routines")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ routines: [] }) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Erro 500")).toBeInTheDocument();
    });

    // First retry
    fireEvent.click(screen.getByText("Tentar Novamente"));

    await waitFor(() => {
      expect(signals.length).toBe(2);
    });

    const activeSignal = signals[1];
    expect(activeSignal.aborted).toBe(false);
  });

  // Test 33: confirma 0 DELETE e 0 /routines/generate durante todo o ciclo de mutações
  it("33. confirma 0 DELETE e 0 /routines/generate durante todo o ciclo de vida de mutações", async () => {
    setupDefaultFetch();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel Ponto Central")).toBeInTheDocument();
    });

    // Edit
    fireEvent.click(screen.getByText("Editar"));
    await waitFor(() => {
      expect(screen.getByText("Editar Rotina — Aluguel")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));

    // Wait for reload after modal success to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/carregando configurações financeiras/i)).not.toBeInTheDocument();
    });

    // Deactivate
    await waitFor(() => {
      expect(screen.getByText("Desativar")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Desativar"));

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter((c: any[]) => c[1]?.method === "DELETE");
      const generateCalls = fetchSpy.mock.calls.filter((c: any[]) =>
        c[0].includes("/routines/generate")
      );
      expect(deleteCalls.length).toBe(0);
      expect(generateCalls.length).toBe(0);
    });
  });

  // Test 34: Stale Load A -> B race condition proof
  it("34. prova que respostas obsoletas (LOAD A) não sobrescrevem dados mais recentes (LOAD B) após abort", async () => {
    let resolveLoadA: (value: any) => void = () => {};
    let signalA: AbortSignal | undefined;
    let categoriesCallCount = 0;
    let routinesCallCount = 0;

    const oldRoutines = [
      {
        ...mockRoutines[0],
        id: "routine-old",
        title: "Aluguel Antigo Versão A",
      },
    ];

    const newRoutines = [
      {
        ...mockRoutines[0],
        id: "routine-new",
        title: "Aluguel Novo Versão B",
      },
    ];

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        categoriesCallCount++;
        if (categoriesCallCount === 1) {
          // Call 1 fails immediately to display Tentar Novamente button while routines call 1 hangs
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: "Erro 500" }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => mockCategories });
      }

      if (url.includes("/api/admin/financial/routines")) {
        routinesCallCount++;
        if (routinesCallCount === 1) {
          // LOAD A hangs
          signalA = init?.signal;
          return new Promise((resolve) => {
            resolveLoadA = resolve;
          });
        } else {
          // LOAD B resolves immediately with NEW routines
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ routines: newRoutines }),
          });
        }
      }

      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<ConfiguracoesFinanceirasPage />);

    // Wait for error screen to display (LOAD A started routines and rejected categories)
    await waitFor(() => {
      expect(screen.getByText("Erro 500")).toBeInTheDocument();
      expect(signalA).toBeDefined();
    });
    expect(signalA?.aborted).toBe(false);

    // Before LOAD A resolves, click Tentar Novamente to trigger reloadData (LOAD B)
    fireEvent.click(screen.getByText("Tentar Novamente"));

    // Confirm signal A was aborted by reloadData
    await waitFor(() => {
      expect(signalA?.aborted).toBe(true);
      expect(screen.getByText("Aluguel Novo Versão B")).toBeInTheDocument();
    });

    // Now resolve hanging LOAD A with old routines
    resolveLoadA({
      ok: true,
      status: 200,
      json: async () => ({ routines: oldRoutines }),
    });

    // Confirm UI STILL displays NEW routines and OLD routines never overwrite B
    await waitFor(() => {
      expect(screen.getByText("Aluguel Novo Versão B")).toBeInTheDocument();
      expect(screen.queryByText("Aluguel Antigo Versão A")).not.toBeInTheDocument();
    });
  });

  // Test 35: Double-submit guard on Edit modal
  it("35. bloqueia envio duplo síncrono (submitLockRef) na edição no modal", async () => {
    let resolvePatch: (val: any) => void = () => {};

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => mockCategories });
      }
      if (url.includes("/api/admin/financial/routines") && !init?.method) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ routines: mockRoutines }) });
      }
      if (url.includes("/api/admin/financial/routines/") && init?.method === "PATCH") {
        return new Promise((resolve) => {
          resolvePatch = resolve;
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel Ponto Central")).toBeInTheDocument();
    });

    // Open Edit modal
    fireEvent.click(screen.getByText("Editar"));

    await waitFor(() => {
      expect(screen.getByText("Editar Rotina — Aluguel")).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole("button", { name: /salvar alterações/i });

    // Double click fast while first PATCH is pending
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    const patchCalls = fetchSpy.mock.calls.filter(
      (c: any[]) => c[0].includes("/api/admin/financial/routines/") && c[1]?.method === "PATCH"
    );
    expect(patchCalls.length).toBe(1);

    // Resolve pending PATCH
    resolvePatch({
      ok: true,
      status: 200,
      json: async () => ({ routine: { ...mockRoutines[0], title: "Aluguel Ponto Central" } }),
    });
  });

  // Test 36: Double-click guard on Reactivate action
  it("36. bloqueia duplo clique síncrono (routineActionLocksRef) na reativação", async () => {
    let resolveReactivate: (val: any) => void = () => {};

    const inactiveRoutines = [
      {
        ...mockRoutines[0],
        id: "routine-inactive-1",
        isActive: false,
      },
    ];

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => mockCategories });
      }
      if (url.includes("/api/admin/financial/routines") && !init?.method) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ routines: inactiveRoutines }) });
      }
      if (url.includes("/api/admin/financial/routines/routine-inactive-1") && init?.method === "PATCH") {
        return new Promise((resolve) => {
          resolveReactivate = resolve;
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<ConfiguracoesFinanceirasPage />);

    await waitFor(() => {
      expect(screen.getByText("Reativar")).toBeInTheDocument();
    });

    const reactivateBtn = screen.getByText("Reativar");

    // Double click rapidly while first reactivate PATCH is pending
    fireEvent.click(reactivateBtn);
    fireEvent.click(reactivateBtn);

    const reactivateCalls = fetchSpy.mock.calls.filter(
      (c: any[]) =>
        c[0].includes("/api/admin/financial/routines/routine-inactive-1") &&
        c[1]?.method === "PATCH"
    );

    expect(reactivateCalls.length).toBe(1);
    const body = JSON.parse(reactivateCalls[0][1].body);
    expect(body).toEqual({ isActive: true });

    // Resolve pending reactivate PATCH
    resolveReactivate({
      ok: true,
      status: 200,
      json: async () => ({ routine: { ...inactiveRoutines[0], isActive: true } }),
    });
  });
});
