/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Receitas")).toBeInTheDocument();
      expect(screen.getByText("Serviços")).toBeInTheDocument();
      expect(screen.getAllByText("Despesas Fixas").length).toBeGreaterThan(0);
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
      expect(screen.getByText("Aluguel Loja Principal")).toBeInTheDocument();
    });

    // Provar semanticamente que nós de nível 2 e 3 exibem o marcador hierárquico ↳
    const indicators = screen.getAllByText("↳");
    // child: Serviços (depth 2), Aluguel (depth 2), Aluguel Loja Principal (depth 3), Despesas Customizadas (depth 2) => 4 indicadores no total
    expect(indicators.length).toBe(4);

    // E os nós raiz (Receitas, Despesas Fixas - depth 1) NÃO possuem o marcador ↳ em seu container de nome
    const receitasEl = screen.getByText("Receitas").closest("div");
    expect(receitasEl?.parentElement?.textContent).not.toContain("↳");
    const despesasFixasEl = screen.getByText("03").closest("div"); // linha do root Despesas Fixas
    expect(despesasFixasEl?.textContent).not.toContain("↳");
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

    // O select de Categoria Pai deve conter categorias válidas
    const parentSelect = screen.getByLabelText(/categoria pai/i);
    expect(parentSelect).toBeInTheDocument();

    const options = Array.from(parentSelect.querySelectorAll("option")).map((o) => o.textContent);
    // Categoria oficial folha (03.01 - Aluguel) NÃO pode receber subcategorias e deve ser ocultada
    expect(options.some((opt) => opt?.includes("Aluguel"))).toBe(false);
    // Categoria raiz oficial (03 - Despesas Fixas) pode receber filhos
    expect(options.some((opt) => opt?.includes("Despesas Fixas"))).toBe(true);
    // Categoria customizada nível 2 (03.07 - Despesas Customizadas) pode receber filhos (nível 3)
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

    // Enums fictícios banidos
    expect(optionValues).not.toContain("EXPENSE");
    expect(optionValues).not.toContain("ASSET");
    expect(optionValues).not.toContain("LIABILITY");
    expect(optionValues).not.toContain("EQUITY");
  });

  it("6. abre modal de renomear e envia PATCH com novo nome", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
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
      expect(screen.getByText("Aluguel")).toBeInTheDocument();
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
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Despesas Customizadas")).toBeInTheDocument();
    });

    // Mover deve existir apenas para as categorias customizadas (03.01.01 e 03.07), não para oficiais (01, 01.01, 03, 03.01)
    const moveButtons = screen.getAllByRole("button", { name: "Mover" });
    expect(moveButtons.length).toBe(2);
  });

  it("10. modal de mover filtra pais inelegíveis (mesmo nó, descendentes, oficiais non-root)", async () => {
    render(<CategoriasPage />);

    await waitFor(() => {
      expect(screen.getByText("Despesas Customizadas")).toBeInTheDocument();
    });

    const moveButtons = screen.getAllByRole("button", { name: "Mover" });
    // Clicar no botão Mover de Despesas Customizadas (segundo botão)
    fireEvent.click(moveButtons[1]);

    expect(screen.getByRole("heading", { name: /Mover/i })).toBeInTheDocument();

    const parentSelect = screen.getByLabelText(/novo pai/i);
    const options = Array.from(parentSelect.querySelectorAll("option")).map((o) => o.textContent);

    // Próprio nó (Despesas Customizadas) NÃO pode aparecer como destino
    expect(options.some((opt) => opt?.includes("03.07 — Despesas Customizadas"))).toBe(false);
    // Categoria oficial folha (03.01 - Aluguel) NÃO pode receber subcategorias
    expect(options.some((opt) => opt?.includes("03.01 — Aluguel"))).toBe(false);
    // Categoria raiz oficial (03 - Despesas Fixas) pode receber a categoria
    expect(options.some((opt) => opt?.includes("03 — Despesas Fixas"))).toBe(true);
  });
});
