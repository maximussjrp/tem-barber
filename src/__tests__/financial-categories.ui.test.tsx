/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoriasPage from "@/app/admin/financeiro/categorias/page";

const mockCategoriesTree = [
  {
    id: "cat-1",
    code: "01",
    name: "Receitas",
    classification: "REVENUE",
    parentCategoryId: null,
    isActive: true,
    depth: 1,
    isLeaf: false,
    children: [
      {
        id: "cat-1-1",
        code: "01.01",
        name: "Serviços",
        classification: "REVENUE",
        parentCategoryId: "cat-1",
        isActive: true,
        depth: 2,
        isLeaf: true,
        children: [],
      },
    ],
  },
  {
    id: "cat-2",
    code: "03",
    name: "Despesas Fixas",
    classification: "FIXED_EXPENSE",
    parentCategoryId: null,
    isActive: true,
    depth: 1,
    isLeaf: false,
    children: [
      {
        id: "cat-2-1",
        code: "03.01",
        name: "Aluguel",
        classification: "FIXED_EXPENSE",
        parentCategoryId: "cat-2",
        isActive: true,
        depth: 2,
        isLeaf: false,
        children: [
          {
            id: "cat-2-1-1",
            code: "03.01.01",
            name: "Aluguel Loja Principal",
            classification: "FIXED_EXPENSE",
            parentCategoryId: "cat-2-1",
            isActive: true,
            depth: 3,
            isLeaf: true,
            children: [],
          },
        ],
      },
      {
        id: "cat-custom-2",
        code: "03.07",
        name: "Despesas Customizadas",
        classification: "FIXED_EXPENSE",
        parentCategoryId: "cat-2",
        isActive: true,
        depth: 2,
        isLeaf: true,
        children: [],
      },
      {
        id: "cat-inactive",
        code: "03.08",
        name: "Serviço Inativo",
        classification: "FIXED_EXPENSE",
        parentCategoryId: "cat-2",
        isActive: false,
        depth: 2,
        isLeaf: true,
        children: [],
      },
    ],
  },
];

describe("CategoriasPage — UI Suite", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation((url: any) => {
      if (url.includes("/api/admin/financial/categories")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockCategoriesTree,
        } as any);
      }
      return Promise.resolve({ ok: false, status: 404 } as any);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. renderiza a navegação do módulo financeiro", async () => {
    render(<CategoriasPage />);
    expect(screen.getByRole("navigation", { name: /navegação do módulo financeiro/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Categorias" })).toBeInTheDocument();
  });

  it("2. exibe a árvore hierárquica 1-indexed (root, child, grandchild) com identação correta", async () => {
    const { container } = render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Serviços").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Despesas Fixas").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Aluguel").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Aluguel Loja Principal").length).toBeGreaterThan(0);
    });

    // Validar marcadores hierárquicos ↳ no desktop
    const desktopView = container.querySelector(".hidden.sm\\:block");
    expect(desktopView).toBeInTheDocument();
    if (desktopView) {
      const desktopIndicators = within(desktopView as HTMLElement).getAllByText("↳");
      // child: Serviços (depth 2), Aluguel (depth 2), Aluguel Loja Principal (depth 3), Despesas Customizadas (depth 2), Serviço Inativo (depth 2) => 5 indicadores
      expect(desktopIndicators.length).toBe(5);

      // E nós raiz (Receitas, Despesas Fixas - depth 1) NÃO possuem o marcador ↳
      const receitasEl = within(desktopView as HTMLElement).getByText("Receitas").closest("div");
      expect(receitasEl?.parentElement?.textContent).not.toContain("↳");
      const despesasFixasEl = within(desktopView as HTMLElement).getByText("03").closest("div");
      expect(despesasFixasEl?.textContent).not.toContain("↳");
    }
  });

  it("3. abre modal de criação com enum FIXED_EXPENSE e envia payload correto", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Categoria")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Nova Categoria"));

    expect(screen.getByRole("heading", { name: "Nova Categoria" })).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/ex: aluguel da loja/i);
    fireEvent.change(nameInput, { target: { value: "Marketing Digital" } });

    const parentSelect = screen.getByLabelText(/categoria pai/i);
    fireEvent.change(parentSelect, { target: { value: "cat-2" } });

    fetchSpy.mockImplementation((url: any, init: any) => {
      if (url.includes("/api/admin/financial/categories") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: "cat-new",
            name: "Marketing Digital",
            classification: "FIXED_EXPENSE",
            parentCategoryId: "cat-2",
          }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockCategoriesTree,
      } as any);
    });

    fireEvent.click(screen.getByRole("button", { name: "Criar Categoria" }));

    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[0].includes("/api/admin/financial/categories") && c[1]?.method === "POST"
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0][1].body);
      expect(body.name).toBe("Marketing Digital");
      expect(body.classification).toBe("FIXED_EXPENSE");
      expect(body.parentCategoryId).toBe("cat-2");
    });
  });

  it("4. permite escolher categoria depth 2 customizada como parent e oculta categorias oficiais non-root", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Categoria")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Nova Categoria"));

    const parentSelect = screen.getByLabelText(/categoria pai/i);
    expect(parentSelect).toBeInTheDocument();

    const options = Array.from(parentSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(options.some((opt) => opt?.includes("Aluguel"))).toBe(false);
    expect(options.some((opt) => opt?.includes("Despesas Fixas"))).toBe(true);
    expect(options.some((opt) => opt?.includes("Despesas Customizadas"))).toBe(true);
  });

  it("5. todas as opções de classificação são enums reais do domínio Prisma", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Categoria")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Nova Categoria"));

    const classSelect = screen.getByLabelText(/classificação/i);
    const optionValues = Array.from(classSelect.querySelectorAll("option")).map((o) => o.value);

    expect(optionValues).toContain("REVENUE");
    expect(optionValues).toContain("VARIABLE_COST");
    expect(optionValues).toContain("FIXED_EXPENSE");
    expect(optionValues).toContain("INVESTMENT");
    expect(optionValues).toContain("NON_OPERATING_IN");
    expect(optionValues).toContain("NON_OPERATING_OUT");
    expect(optionValues).toContain("TRANSFER");
    expect(optionValues).toContain("ADJUSTMENT");

    expect(optionValues).not.toContain("EXPENSE");
    expect(optionValues).not.toContain("ASSET");
    expect(optionValues).not.toContain("LIABILITY");
    expect(optionValues).not.toContain("EQUITY");
  });

  it("6. abre modal de renomear e envia PATCH com novo nome", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel").length).toBeGreaterThan(0);
    });

    const renameButtons = screen.getAllByRole("button", { name: "Renomear" });
    fireEvent.click(renameButtons[0]);

    expect(screen.getByRole("heading", { name: "Renomear Categoria" })).toBeInTheDocument();

    fetchSpy.mockImplementation((url: any, init: any) => {
      if (url.includes("/api/admin/financial/categories/") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: "cat-1", name: "Receitas Diversas" }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockCategoriesTree,
      } as any);
    });

    fireEvent.click(screen.getByRole("button", { name: "Salvar Alterações" }));

    await waitFor(() => {
      const patchCalls = fetchSpy.mock.calls.filter(
        (c: any[]) => c[1]?.method === "PATCH"
      );
      expect(patchCalls.length).toBe(1);
    });
  });

  it("7. aposentadoria com exigência de substituição abre seleção de substituta", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Aluguel").length).toBeGreaterThan(0);
    });

    const retireButtons = screen.getAllByRole("button", { name: "Aposentar" });
    fireEvent.click(retireButtons[1]); // Aluguel

    fetchSpy.mockImplementation((url: any, init: any) => {
      if (url.includes("/retire") && init?.method === "POST") {
        const body = JSON.parse(init.body || "{}");
        if (!body.replacementCategoryId) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              code: "FINANCIAL_CATEGORY_REPLACEMENT_REQUIRED",
              error: "Esta categoria está em uso e exige uma categoria de substituição para aposentadoria.",
            }),
          } as any);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, migrated: true }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockCategoriesTree,
      } as any);
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Aposentadoria" }));

    await waitFor(() => {
      expect(
        screen.getByText(/exige uma categoria de substituição/i)
      ).toBeInTheDocument();
    });
  });

  it("8. trata erro 403 Acesso negado", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      } as any)
    );

    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Acesso negado")).toBeInTheDocument();
    });
  });

  it("9. oculta botão Mover para categorias oficiais e exibe apenas para customizadas", async () => {
    const { container } = render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Despesas Customizadas").length).toBeGreaterThan(0);
    });

    // No desktop (botões de texto diretos): Mover deve existir apenas para as categorias ativas customizadas (03.01.01 e 03.07), não para oficiais (01, 01.01, 03, 03.01)
    const desktopView = container.querySelector(".hidden.sm\\:block");
    expect(desktopView).toBeInTheDocument();
    if (desktopView) {
      const moveButtons = within(desktopView as HTMLElement).getAllByRole("button", { name: "Mover" });
      expect(moveButtons.length).toBe(2);
    }
  });

  it("10. modal de mover filtra pais inelegíveis (mesmo nó, descendentes, oficiais non-root)", async () => {
    const { container } = render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Despesas Customizadas").length).toBeGreaterThan(0);
    });

    const desktopView = container.querySelector(".hidden.sm\\:block");
    expect(desktopView).toBeInTheDocument();
    const moveButtons = within(desktopView as HTMLElement).getAllByRole("button", { name: "Mover" });
    // Clicar no botão Mover de Despesas Customizadas (segundo botão customizado no desktop)
    fireEvent.click(moveButtons[1]);

    expect(screen.getByRole("heading", { name: /Mover/i })).toBeInTheDocument();

    const parentSelect = screen.getByLabelText(/novo pai/i);
    const options = Array.from(parentSelect.querySelectorAll("option")).map((o) => o.textContent);

    expect(options.some((opt) => opt?.includes("03.07 — Despesas Customizadas"))).toBe(false);
    expect(options.some((opt) => opt?.includes("03.01 — Aluguel"))).toBe(false);
    expect(options.some((opt) => opt?.includes("03 — Despesas Fixas"))).toBe(true);
  });

  describe("Bloco D — Responsividade Mobile e Ações Compactas", () => {
    it("11. renderiza container desktop com classe hidden sm:block e mobile com sm:hidden", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const desktopContainer = container.querySelector(".hidden.sm\\:block");
      const mobileContainer = container.querySelector(".sm\\:hidden");

      expect(desktopContainer).toBeInTheDocument();
      expect(mobileContainer).toBeInTheDocument();
    });

    it("12. exibe no card mobile o nome, a classificação legível e o código formatado", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Aluguel").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      expect(mobileContainer).toBeInTheDocument();

      expect(within(mobileContainer).getByText("Aluguel")).toBeInTheDocument();
      expect(within(mobileContainer).getAllByText("Despesas Fixas").length).toBeGreaterThan(0);
      expect(within(mobileContainer).getByText(/^Código\s+03\.01$/)).toBeInTheDocument();
    });

    it("13. exibe o marcador de profundidade ↳ para depth > 1 e badge Inativa para categoria inativa no mobile", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Serviço Inativo").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      expect(mobileContainer).toBeInTheDocument();

      // Marcador ↳ para profundidade > 1
      const mobileIndicators = within(mobileContainer).getAllByText("↳");
      expect(mobileIndicators.length).toBe(5);

      // Badge Inativa
      const inactiveBadge = within(mobileContainer).getByText("Inativa");
      expect(inactiveBadge).toBeInTheDocument();
    });

    it("14. não renderiza botões de texto soltos inline no card mobile", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      expect(mobileContainer).toBeInTheDocument();

      // Antes de abrir qualquer menu, nenhum botão com nome "Renomear", "Mover" ou "Aposentar" existe no mobile
      expect(within(mobileContainer).queryByRole("button", { name: "Renomear" })).toBeNull();
      expect(within(mobileContainer).queryByRole("button", { name: "Mover" })).toBeNull();
      expect(within(mobileContainer).queryByRole("button", { name: "Aposentar" })).toBeNull();
    });

    it("15. renderiza botão de trigger compacto ⋮ com aria-label correto para ativas e oculta para inativas", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      expect(mobileContainer).toBeInTheDocument();

      // Botão ⋮ para categoria ativa "Aluguel"
      const aluguelTrigger = within(mobileContainer).getByRole("button", { name: "Ações de Aluguel" });
      expect(aluguelTrigger).toBeInTheDocument();
      expect(aluguelTrigger).toHaveAttribute("aria-haspopup", "menu");
      expect(aluguelTrigger).toHaveAttribute("aria-expanded", "false");

      // Categoria inativa "Serviço Inativo" NÃO deve possuir botão de ações
      expect(within(mobileContainer).queryByRole("button", { name: "Ações de Serviço Inativo" })).toBeNull();
    });

    it("16. ao clicar no trigger ⋮ abre o menu dropdown com itens adequados (Mover apenas para customizadas)", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;

      // 1. Categoria oficial "Aluguel" (03.01) - NÃO deve ter Mover
      const aluguelTrigger = within(mobileContainer).getByRole("button", { name: "Ações de Aluguel" });
      fireEvent.click(aluguelTrigger);

      expect(aluguelTrigger).toHaveAttribute("aria-expanded", "true");
      let menu = within(mobileContainer).getByRole("menu", { name: "Menu de ações de Aluguel" });
      expect(menu).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Renomear" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Aposentar" })).toBeInTheDocument();
      expect(within(menu).queryByRole("menuitem", { name: "Mover" })).toBeNull();

      // Fechar menu
      fireEvent.click(aluguelTrigger);

      // 2. Categoria customizada "Despesas Customizadas" (03.07) - DEVE ter Mover
      const customTrigger = within(mobileContainer).getByRole("button", { name: "Ações de Despesas Customizadas" });
      fireEvent.click(customTrigger);

      menu = within(mobileContainer).getByRole("menu", { name: "Menu de ações de Despesas Customizadas" });
      expect(menu).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Renomear" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Mover" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Aposentar" })).toBeInTheDocument();
    });

    it("17. itens do menu dropdown acionam os modais de Renomear, Mover e Aposentar e fecham o menu", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Despesas Customizadas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;

      // Testar Aposentar pelo menu mobile
      const customTrigger = within(mobileContainer).getByRole("button", { name: "Ações de Despesas Customizadas" });
      fireEvent.click(customTrigger);

      const menu = within(mobileContainer).getByRole("menu", { name: "Menu de ações de Despesas Customizadas" });
      const retireItem = within(menu).getByRole("menuitem", { name: "Aposentar" });
      fireEvent.click(retireItem);

      // Modal de aposentadoria aberto
      expect(screen.getByRole("heading", { name: /Aposentar/i })).toBeInTheDocument();
      // Menu deve ter sido fechado
      expect(within(mobileContainer).queryByRole("menu")).toBeNull();

      // Fechar modal de aposentadoria
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

      // Testar Renomear pelo menu mobile
      fireEvent.click(within(mobileContainer).getByRole("button", { name: "Ações de Despesas Customizadas" }));
      const renameItem = within(mobileContainer).getByRole("menuitem", { name: "Renomear" });
      fireEvent.click(renameItem);
      expect(screen.getByRole("heading", { name: /Renomear/i })).toBeInTheDocument();
      expect(within(mobileContainer).queryByRole("menu")).toBeNull();
    });

    it("18. fecha o menu de ações ao pressionar a tecla Escape", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      const trigger = within(mobileContainer).getByRole("button", { name: "Ações de Receitas" });
      fireEvent.click(trigger);

      expect(within(mobileContainer).getByRole("menu")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });

      expect(within(mobileContainer).queryByRole("menu")).toBeNull();
    });

    it("19. fecha o menu de ações ao clicar fora do componente", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      const trigger = within(mobileContainer).getByRole("button", { name: "Ações de Receitas" });
      fireEvent.click(trigger);

      expect(within(mobileContainer).getByRole("menu")).toBeInTheDocument();

      fireEvent.mouseDown(document.body);

      expect(within(mobileContainer).queryByRole("menu")).toBeNull();
    });

    it("20. garante que apenas um menu de ações fica aberto simultaneamente", async () => {
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      const trigger1 = within(mobileContainer).getByRole("button", { name: "Ações de Receitas" });
      const trigger2 = within(mobileContainer).getByRole("button", { name: "Ações de Despesas Fixas" });

      fireEvent.click(trigger1);
      expect(within(mobileContainer).getByRole("menu", { name: "Menu de ações de Receitas" })).toBeInTheDocument();

      fireEvent.click(trigger2);
      expect(within(mobileContainer).queryByRole("menu", { name: "Menu de ações de Receitas" })).toBeNull();
      expect(within(mobileContainer).getByRole("menu", { name: "Menu de ações de Despesas Fixas" })).toBeInTheDocument();
    });

    it("21. interação realista com userEvent abre, fecha no segundo clique e alterna entre triggers", async () => {
      const user = userEvent.setup();
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      const triggerA = within(mobileContainer).getByRole("button", { name: "Ações de Receitas" });
      const triggerB = within(mobileContainer).getByRole("button", { name: "Ações de Despesas Fixas" });

      // 1. Primeiro clique abre menu A
      await user.click(triggerA);
      expect(within(mobileContainer).getByRole("menu", { name: "Menu de ações de Receitas" })).toBeInTheDocument();

      // 2. Segundo clique no mesmo trigger fecha menu A
      await user.click(triggerA);
      expect(within(mobileContainer).queryByRole("menu")).toBeNull();

      // 3. Abrir menu A novamente e clicar no trigger B alterna imediatamente
      await user.click(triggerA);
      expect(within(mobileContainer).getByRole("menu", { name: "Menu de ações de Receitas" })).toBeInTheDocument();

      await user.click(triggerB);
      expect(within(mobileContainer).queryByRole("menu", { name: "Menu de ações de Receitas" })).toBeNull();
      expect(within(mobileContainer).getByRole("menu", { name: "Menu de ações de Despesas Fixas" })).toBeInTheDocument();
    });

    it("22. interação realista com userEvent fecha o menu ao clicar em elemento externo", async () => {
      const user = userEvent.setup();
      const { container } = render(<CategoriasPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Receitas").length).toBeGreaterThan(0);
      });

      const mobileContainer = container.querySelector(".sm\\:hidden") as HTMLElement;
      const trigger = within(mobileContainer).getByRole("button", { name: "Ações de Receitas" });

      // Abrir menu com userEvent
      await user.click(trigger);
      expect(within(mobileContainer).getByRole("menu")).toBeInTheDocument();

      // Clicar em elemento externo (ex: título ou botão Nova Categoria)
      const novaCategoriaBtn = screen.getByRole("button", { name: "Nova Categoria" });
      await user.click(novaCategoriaBtn);

      expect(within(mobileContainer).queryByRole("menu")).toBeNull();
    });
  });
});
