import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialCategory, FinancialCategoryClassification, Prisma } from "@prisma/client";
import {
  createCategory,
  FinancialCategoryError,
  getCategoryById,
  isCategoryInUse,
  listCategoriesTree,
  moveCategory,
  retireCategory,
  updateCategory,
} from "@/lib/financial/categories";
import { analyzeFinancialPlan, bootstrapFinancialPlan, OFFICIAL_CATEGORIES, OFFICIAL_SYSTEM_MAPPINGS } from "@/lib/financial/default-plan";
import { requireFinancialSession } from "@/lib/financial/permissions";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    financialCategory: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    financialCategorySystemMapping: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    financialTitle: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    financialRoutine: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    financialEntryAllocation: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

function mockCat(overrides: Partial<FinancialCategory>): FinancialCategory {
  return {
    id: overrides.id || "cat-default",
    barbershopId: overrides.barbershopId || "barbershop-tenant-a",
    code: overrides.code || "01",
    name: overrides.name || "Categoria Teste",
    classification: overrides.classification || FinancialCategoryClassification.REVENUE,
    parentCategoryId: overrides.parentCategoryId ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
  };
}

describe("Fase 2 — Plano Financeiro / Categorias", () => {
  const TENANT_A = "barbershop-tenant-a";
  const TENANT_B = "barbershop-tenant-b";

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);
  });

  describe("PERMISSÕES E TENANT-SCOPING", () => {
    it("permite OWNER e MANAGER", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user-1", role: "OWNER", memberId: "mem-1", barbershopId: TENANT_A },
      });
      const sessionOwner = await requireFinancialSession();
      expect(sessionOwner.error).toBeNull();
      expect(sessionOwner.data?.role).toBe("OWNER");

      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user-2", role: "MANAGER", memberId: "mem-2", barbershopId: TENANT_A },
      });
      const sessionManager = await requireFinancialSession();
      expect(sessionManager.error).toBeNull();
      expect(sessionManager.data?.role).toBe("MANAGER");
    });

    it("nega BARBER com HTTP 403", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user-3", role: "BARBER", memberId: "mem-3", barbershopId: TENANT_A },
      });
      const sessionBarber = await requireFinancialSession();
      expect(sessionBarber.error).not.toBeNull();
      expect(sessionBarber.error?.status).toBe(403);
    });

    it("nega acesso se usuário não tiver barbearia vinculada", async () => {
      getAdminSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user-super", role: "SUPER_ADMIN", memberId: null, barbershopId: null },
      });
      const session = await requireFinancialSession();
      expect(session.error).not.toBeNull();
      expect(session.error?.status).toBe(403);
    });

    it("isolamento tenant: Tenant A não acessa categoria de Tenant B (404)", async () => {
      prismaMock.financialCategory.findMany.mockResolvedValue([]);
      const cat = await getCategoryById(TENANT_A, "cat-tenant-b");
      expect(cat).toBeNull();
    });

    it("isolamento tenant: Tenant A não move categoria de Tenant B", async () => {
      prismaMock.financialCategory.findFirst.mockResolvedValue(null);
      await expect(moveCategory(TENANT_A, "cat-tenant-b", null)).rejects.toThrow(
        FinancialCategoryError
      );
    });

    it("isolamento tenant: replacement de Tenant B em aposentadoria do Tenant A é bloqueado", async () => {
      const source = mockCat({ id: "c-source", barbershopId: TENANT_A, classification: FinancialCategoryClassification.REVENUE, isActive: true });
      prismaMock.financialCategory.findFirst
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(null);

      prismaMock.financialCategory.count.mockResolvedValue(0);
      prismaMock.financialTitle.count.mockResolvedValue(1);

      await expect(retireCategory(TENANT_A, "c-source", "rep-tenant-b")).rejects.toThrow(
        "Categoria de substituição não encontrada ou inativa no mesmo estabelecimento."
      );
      expect(prismaMock.financialCategory.findFirst).toHaveBeenLastCalledWith({
        where: { id: "rep-tenant-b", barbershopId: TENANT_A },
      });
    });
  });

  describe("REGRAS DE HIERARQUIA, PROFUNDIDADE E GET INDIVIDUAL", () => {
    it("isCategoryInUse detecta corretamente vínculos de lançamentos", async () => {
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(1);

      const inUse = await isCategoryInUse(prismaMock as unknown as Prisma.TransactionClient, TENANT_B, "cat-1");
      expect(inUse).toBe(true);
    });

    it("getCategoryById calcula subárvore completa e isLeaf verdadeiro quando filho possui neto", async () => {
      const rootCat = mockCat({ id: "c-root", barbershopId: TENANT_A, code: "01", name: "Receitas", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: null });
      const lev2 = mockCat({ id: "c-lev2", barbershopId: TENANT_A, code: "01.01", name: "Serviços", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: "c-root" });
      const lev3 = mockCat({ id: "c-lev3", barbershopId: TENANT_A, code: "01.01.01", name: "Corte", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: "c-lev2" });

      prismaMock.financialCategory.findMany.mockResolvedValue([rootCat, lev2, lev3]);

      const rootNode = await getCategoryById(TENANT_A, "c-root");
      expect(rootNode).not.toBeNull();
      expect(rootNode?.isLeaf).toBe(false);
      expect(rootNode?.children[0].id).toBe("c-lev2");
      expect(rootNode?.children[0].isLeaf).toBe(false); // TEM NETO (lev3), PORTANTO ISLEAF=FALSE!
      expect(rootNode?.children[0].children[0].id).toBe("c-lev3");
      expect(rootNode?.children[0].children[0].isLeaf).toBe(true);
    });

    it("bloqueia criação que resultaria em nível 4 (FINANCIAL_CATEGORY_MAX_DEPTH)", async () => {
      const rootCat = mockCat({ id: "c-root", barbershopId: TENANT_A, parentCategoryId: null, classification: FinancialCategoryClassification.REVENUE });
      const lev2 = mockCat({ id: "c-lev2", barbershopId: TENANT_A, parentCategoryId: "c-root", classification: FinancialCategoryClassification.REVENUE });
      const lev3 = mockCat({ id: "c-lev3", barbershopId: TENANT_A, parentCategoryId: "c-lev2", classification: FinancialCategoryClassification.REVENUE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(lev3);
      prismaMock.financialCategory.findMany.mockResolvedValue([rootCat, lev2, lev3]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      await expect(
        createCategory(TENANT_A, {
          name: "SubCorte Level 4",
          classification: FinancialCategoryClassification.REVENUE,
          parentCategoryId: "c-lev3",
        })
      ).rejects.toThrow("A profundidade da árvore não pode exceder 3 níveis.");
    });
  });

  describe("VALIDAÇÃO DE PAYLOADS E HIERARQUIA CANÔNICA (BLOCO C)", () => {
    it("rejeita payload inválido no POST (400)", async () => {
      await expect(createCategory(TENANT_A, { name: "", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: "p-1" })).rejects.toThrow(FinancialCategoryError);
      await expect(createCategory(TENANT_A, { name: "Nome", classification: "INVALID" as unknown as FinancialCategoryClassification, parentCategoryId: "p-1" })).rejects.toThrow(FinancialCategoryError);
      await expect(createCategory(TENANT_A, { name: "Nome", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: "" })).rejects.toThrow("É obrigatório selecionar uma categoria pai");
    });

    it("rejeita payload inválido no MOVE e RETIRE (400)", async () => {
      await expect(moveCategory(TENANT_A, "cat-1", null)).rejects.toThrow(FinancialCategoryError);
      await expect(retireCategory(TENANT_A, "cat-1", 123 as unknown as string)).rejects.toThrow(FinancialCategoryError);
      await expect(updateCategory(TENANT_A, "cat-1", { name: "" })).rejects.toThrow(FinancialCategoryError);
    });

    it("cria filho com primeiro slot livre 01 sob raiz 03", async () => {
      const parent = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(parent);
      prismaMock.financialCategory.findMany.mockResolvedValue([parent]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "created-id", ...args.data }))
      );

      const created = await createCategory(TENANT_A, {
        name: "Nova Despesa",
        classification: FinancialCategoryClassification.FIXED_EXPENSE,
        parentCategoryId: "p-03",
      });

      expect(created.code).toBe("03.01");
      expect(created.parentCategoryId).toBe("p-03");
    });

    it("preenche menor gap numérico livre (ex: 03.01 e 03.03 ocupados -> gera 03.02)", async () => {
      const parent = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const child1 = mockCat({ id: "c-03-01", code: "03.01", parentCategoryId: "p-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const child3 = mockCat({ id: "c-03-03", code: "03.03", parentCategoryId: "p-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(parent);
      prismaMock.financialCategory.findMany
        .mockResolvedValueOnce([parent, child1, child3]) // allCategories for depth
        .mockResolvedValueOnce([child1, child3]) // existingChildren
        .mockResolvedValueOnce([child1, child3]); // collidingCategories

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "created-id", ...args.data }))
      );

      const created = await createCategory(TENANT_A, {
        name: "Despesa Gap",
        classification: FinancialCategoryClassification.FIXED_EXPENSE,
        parentCategoryId: "p-03",
      });

      expect(created.code).toBe("03.02");
    });

    it("reserva códigos de categorias inativas (isActive=false não libera o slot)", async () => {
      const parent = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const inactiveChild = mockCat({ id: "c-03-01", code: "03.01", parentCategoryId: "p-03", isActive: false, classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(parent);
      prismaMock.financialCategory.findMany
        .mockResolvedValueOnce([parent, inactiveChild])
        .mockResolvedValueOnce([inactiveChild])
        .mockResolvedValueOnce([inactiveChild]);

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "created-id", ...args.data }))
      );

      const created = await createCategory(TENANT_A, {
        name: "Nova Após Inativa",
        classification: FinancialCategoryClassification.FIXED_EXPENSE,
        parentCategoryId: "p-03",
      });

      expect(created.code).toBe("03.02");
    });

    it("nunca atribui o slot 99 e lança CATEGORY_SLOTS_EXHAUSTED se 01..98 estiverem ocupados", async () => {
      const parent = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const fullChildren: FinancialCategory[] = [];
      for (let i = 1; i <= 98; i++) {
        fullChildren.push(
          mockCat({
            id: `c-03-${i}`,
            code: `03.${String(i).padStart(2, "0")}`,
            parentCategoryId: "p-03",
            classification: FinancialCategoryClassification.FIXED_EXPENSE,
          })
        );
      }

      prismaMock.financialCategory.findFirst.mockResolvedValue(parent);
      prismaMock.financialCategory.findMany
        .mockResolvedValueOnce([parent, ...fullChildren])
        .mockResolvedValueOnce(fullChildren)
        .mockResolvedValueOnce(fullChildren);

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      await expect(
        createCategory(TENANT_A, {
          name: "Excedente",
          classification: FinancialCategoryClassification.FIXED_EXPENSE,
          parentCategoryId: "p-03",
        })
      ).rejects.toThrow("Não há slots numéricos disponíveis (01 a 98)");
    });

    it("impede criação sob categoria de bucket terminal (.99)", async () => {
      const parent99 = mockCat({ id: "p-03-99", code: "03.99", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(parent99);
      prismaMock.financialCategory.findMany.mockResolvedValue([parent99]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      await expect(
        createCategory(TENANT_A, {
          name: "Sub de outras",
          classification: FinancialCategoryClassification.FIXED_EXPENSE,
          parentCategoryId: "p-03-99",
        })
      ).rejects.toThrow("é um bucket reservado (.99) e não pode receber subcategorias");
    });

    it("impede criação sob pai com formato de código inválido (ex: legado CUSTOM-)", async () => {
      const legacyParent = mockCat({ id: "p-legacy", code: "CUSTOM-12345678", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(legacyParent);
      prismaMock.financialCategory.findMany.mockResolvedValue([legacyParent]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      await expect(
        createCategory(TENANT_A, {
          name: "Filho de Legacy",
          classification: FinancialCategoryClassification.FIXED_EXPENSE,
          parentCategoryId: "p-legacy",
        })
      ).rejects.toThrow("não segue o padrão hierárquico oficial");
    });

    it("cria filho com código nível 3 (ex: 03.07.01) sob categoria customizada nível 2", async () => {
      const root = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const customL2 = mockCat({ id: "c-03-07", code: "03.07", parentCategoryId: "p-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(customL2);
      prismaMock.financialCategory.findMany
        .mockResolvedValueOnce([root, customL2]) // allCategories
        .mockResolvedValueOnce([]) // existingChildren
        .mockResolvedValueOnce([]); // collidingCategories

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "c-03-07-01", ...args.data }))
      );

      const res = await createCategory(TENANT_A, {
        name: "Subcustomizada L3",
        classification: FinancialCategoryClassification.FIXED_EXPENSE,
        parentCategoryId: "c-03-07",
      });

      expect(res.code).toBe("03.07.01");
    });

    it("bloqueia criação sob categoria oficial folha (ex: 03.01) com FINANCIAL_CATEGORY_OFFICIAL_NON_ROOT_CHILD_BLOCKED", async () => {
      const root = mockCat({ id: "p-03", code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const officialLeaf = mockCat({ id: "c-03-01", code: "03.01", parentCategoryId: "p-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(officialLeaf);
      prismaMock.financialCategory.findMany.mockResolvedValue([root, officialLeaf]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      await expect(
        createCategory(TENANT_A, {
          name: "Sub folha oficial",
          classification: FinancialCategoryClassification.FIXED_EXPENSE,
          parentCategoryId: "c-03-01",
        })
      ).rejects.toMatchObject({
        code: "FINANCIAL_CATEGORY_OFFICIAL_NON_ROOT_CHILD_BLOCKED",
      });
    });
  });

  describe("CRUD, COMPOUND SELECTOR E MUTATION HARDENING", () => {
    it("updateCategory usa selector composto tenant-safe id_barbershopId", async () => {
      const existing = mockCat({ id: "cat-1", barbershopId: TENANT_A, name: "Nome Velho" });
      prismaMock.financialCategory.findFirst.mockResolvedValue(existing);
      prismaMock.financialCategory.update.mockResolvedValue({ ...existing, name: "Nome Novo" });

      await updateCategory(TENANT_A, "cat-1", { name: "Nome Novo" });

      expect(prismaMock.financialCategory.update).toHaveBeenCalledWith({
        where: { id_barbershopId: { id: "cat-1", barbershopId: TENANT_A } },
        data: { name: "Nome Novo" },
      });
    });

    it("moveCategory protege raiz oficial (01..08) contra movimentação", async () => {
      const officialRoot = mockCat({ id: "cat-01", code: "01", parentCategoryId: null, classification: FinancialCategoryClassification.REVENUE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(officialRoot);

      await expect(
        moveCategory(TENANT_A, "cat-01", "other-parent")
      ).rejects.toMatchObject({
        code: "FINANCIAL_CATEGORY_OFFICIAL_STRUCTURE_IMMUTABLE",
      });
    });

    it("moveCategory protege categoria oficial folha (ex: 03.01) contra movimentação", async () => {
      const officialLeaf = mockCat({ id: "cat-03-01", code: "03.01", parentCategoryId: "cat-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(officialLeaf);

      await expect(
        moveCategory(TENANT_A, "cat-03-01", "other-parent")
      ).rejects.toMatchObject({
        code: "FINANCIAL_CATEGORY_OFFICIAL_STRUCTURE_IMMUTABLE",
      });
    });

    it("moveCategory protege categoria oficial .99 (ex: 03.99) contra movimentação", async () => {
      const official99 = mockCat({ id: "cat-03-99", code: "03.99", parentCategoryId: "cat-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      prismaMock.financialCategory.findFirst.mockResolvedValue(official99);

      await expect(
        moveCategory(TENANT_A, "cat-03-99", "other-parent")
      ).rejects.toMatchObject({
        code: "FINANCIAL_CATEGORY_OFFICIAL_STRUCTURE_IMMUTABLE",
      });
    });

    it("moveCategory recodifica nó e subárvore com novo prefixo hierárquico", async () => {
      const source = mockCat({ id: "cat-src", code: "CUSTOM-EXP", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const child = mockCat({ id: "cat-child", code: "CUSTOM-CHILD", parentCategoryId: "cat-src", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const newParent = mockCat({ id: "root-03", code: "03", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve(null);
        }
        return Promise.resolve(source);
      });
      prismaMock.financialCategory.findMany.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve([]); // collidingCategories under newParent
        }
        if (args?.where?.parentCategoryId === "root-03") {
          return Promise.resolve([]); // existingChildren under newParent
        }
        return Promise.resolve([source, child, newParent]); // allCategories
      });

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.update.mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        return Promise.resolve({ ...source, ...args.data });
      });

      const moved = await moveCategory(TENANT_A, "cat-src", "root-03");

      expect(moved.code).toBe("03.01");
      expect(prismaMock.financialCategory.update).toHaveBeenCalledWith({
        where: { id_barbershopId: { id: "cat-child", barbershopId: TENANT_A } },
        data: { code: "03.01.01" },
      });
    });

    it("moveCategory permite normalizar CUSTOM- legado sob raiz oficial preservando UUID", async () => {
      const legacy = mockCat({ id: "uuid-legacy", code: "CUSTOM-ABC12345", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const root03 = mockCat({ id: "root-03", code: "03", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve(null);
        }
        return Promise.resolve(legacy);
      });
      prismaMock.financialCategory.findMany.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve([]);
        }
        if (args?.where?.parentCategoryId === "root-03") {
          return Promise.resolve([]);
        }
        return Promise.resolve([legacy, root03]);
      });

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.update.mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        return Promise.resolve({ ...legacy, ...args.data });
      });

      const moved = await moveCategory(TENANT_A, "uuid-legacy", "root-03");

      expect(moved.id).toBe("uuid-legacy");
      expect(moved.code).toBe("03.01");
      expect(moved.parentCategoryId).toBe("root-03");
    });

    it("moveCategory aloca próximo slot livre no destino sem alterar filhos existentes do destino (isolamento de colisão)", async () => {
      // 03 -> 03.07 (SOURCE)
      // 03 -> 03.08 (TARGET) -> 03.08.01 (EXISTING_TARGET_CHILD)
      const root03 = mockCat({ id: "root-03", code: "03", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const source = mockCat({ id: "cat-src-07", code: "03.07", parentCategoryId: "root-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const target = mockCat({ id: "cat-tgt-08", code: "03.08", parentCategoryId: "root-03", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const existingTargetChild = mockCat({ id: "cat-tgt-child-01", code: "03.08.01", parentCategoryId: "cat-tgt-08", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve(null);
        }
        return Promise.resolve(source);
      });
      prismaMock.financialCategory.findMany.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve([existingTargetChild]); // collidingCategories under target
        }
        if (args?.where?.parentCategoryId === "cat-tgt-08") {
          return Promise.resolve([existingTargetChild]); // existingChildren under target
        }
        return Promise.resolve([root03, source, target, existingTargetChild]); // allCategories
      });

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      const updatedEntities: { id: string; code?: string; parentCategoryId?: string }[] = [];
      prismaMock.financialCategory.update.mockImplementation((args: { where: { id_barbershopId: { id: string } }; data: Record<string, unknown> }) => {
        const item = { id: args.where.id_barbershopId.id, ...args.data };
        updatedEntities.push(item);
        return Promise.resolve(mockCat({ id: args.where.id_barbershopId.id, ...args.data }));
      });

      const moved = await moveCategory(TENANT_A, "cat-src-07", "cat-tgt-08");

      // SOURCE deve receber primeiro slot livre sob TARGET (03.08.02)
      expect(moved.code).toBe("03.08.02");
      expect(moved.id).toBe("cat-src-07");

      // EXISTING_TARGET_CHILD não deve ter sido tocado na lista de atualizações definitivas
      const existingChildTouch = updatedEntities.find((u) => u.id === "cat-tgt-child-01");
      expect(existingChildTouch).toBeUndefined();
    });

    it("moveCategory recodifica múltiplos filhos de forma determinística por [code, name, id]", async () => {
      const source = mockCat({ id: "cat-src", code: "CUSTOM-SRC", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const target = mockCat({ id: "root-03", code: "03", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });

      const childB = mockCat({ id: "c-b", code: "CUSTOM-B", name: "B", parentCategoryId: "cat-src", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const childA = mockCat({ id: "c-a", code: "CUSTOM-A", name: "A", parentCategoryId: "cat-src", classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const childC = mockCat({ id: "c-c", code: "CUSTOM-C", name: "C", parentCategoryId: "cat-src", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve(null);
        }
        return Promise.resolve(source);
      });
      prismaMock.financialCategory.findMany.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") {
          return Promise.resolve([]);
        }
        if (args?.where?.parentCategoryId === "root-03") {
          return Promise.resolve([]);
        }
        // Retornar lista fora de ordem para testar estabilidade
        return Promise.resolve([source, target, childB, childC, childA]);
      });

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      const finalCodes = new Map<string, string>();
      prismaMock.financialCategory.update.mockImplementation((args: { where: { id_barbershopId: { id: string } }; data: { code?: string } }) => {
        if (args.data.code && !args.data.code.startsWith("__TB_MOVE_TMP__")) {
          finalCodes.set(args.where.id_barbershopId.id, args.data.code);
        }
        return Promise.resolve(mockCat({ id: args.where.id_barbershopId.id, ...args.data }));
      });

      await moveCategory(TENANT_A, "cat-src", "root-03");

      // Fonte vira 03.01
      expect(finalCodes.get("cat-src")).toBe("03.01");
      // Filhos ordenados determinísticamente: childA ("CUSTOM-A", "A") -> 03.01.01, childB ("CUSTOM-B", "B") -> 03.01.02, childC ("CUSTOM-C", "C") -> 03.01.03
      expect(finalCodes.get("c-a")).toBe("03.01.01");
      expect(finalCodes.get("c-b")).toBe("03.01.02");
      expect(finalCodes.get("c-c")).toBe("03.01.03");
    });

    it("isolamento de tenant: tenants A e B podem ter o mesmo código sem colisão", async () => {
      const parentTenantB = mockCat({ id: "p-b", barbershopId: TENANT_B, code: "03", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockResolvedValue(parentTenantB);
      prismaMock.financialCategory.findMany
        .mockResolvedValueOnce([parentTenantB]) // allCategories do Tenant B
        .mockResolvedValueOnce([]) // existingChildren do Tenant B (nenhum ainda)
        .mockResolvedValueOnce([]); // collidingCategories do Tenant B

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "created-b", ...args.data }))
      );

      // Criar no Tenant B: deve conseguir gerar 03.01 mesmo que Tenant A já possua 03.01
      const createdB = await createCategory(TENANT_B, {
        name: "Aluguel Tenant B",
        classification: FinancialCategoryClassification.FIXED_EXPENSE,
        parentCategoryId: "p-b",
      });

      expect(createdB.code).toBe("03.01");
      expect(createdB.barbershopId).toBe(TENANT_B);
    });

    it("falha no meio da transação de recodificação aciona rollback sem vazar códigos temporários", async () => {
      const source = mockCat({ id: "cat-src", code: "CUSTOM-SRC", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const target = mockCat({ id: "root-03", code: "03", parentCategoryId: null, classification: FinancialCategoryClassification.FIXED_EXPENSE });
      const child = mockCat({ id: "cat-child", code: "CUSTOM-CHILD", parentCategoryId: "cat-src", classification: FinancialCategoryClassification.FIXED_EXPENSE });

      prismaMock.financialCategory.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") return Promise.resolve(null);
        return Promise.resolve(source);
      });
      prismaMock.financialCategory.findMany.mockImplementation((args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.code && typeof args.where.code === "object") return Promise.resolve([]);
        if (args?.where?.parentCategoryId === "root-03") return Promise.resolve([]);
        return Promise.resolve([source, target, child]);
      });

      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);

      // Simular erro durante a transação
      prismaMock.financialCategory.update.mockRejectedValueOnce(new Error("Database write failure during recode"));

      await expect(moveCategory(TENANT_A, "cat-src", "root-03")).rejects.toThrow("Database write failure during recode");
    });
  });

  describe("RETIREMENT E MESCLAGEM DECIMAL DE ALOCAÇÕES", () => {
    it("migra títulos, rotinas, mappings e alocações com soma Decimal perfeita", async () => {
      const source = mockCat({ id: "c-source", barbershopId: TENANT_A, classification: FinancialCategoryClassification.REVENUE, isActive: true });
      const replacement = mockCat({ id: "c-rep", barbershopId: TENANT_A, classification: FinancialCategoryClassification.REVENUE, isActive: true });

      prismaMock.financialCategory.findFirst
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(replacement);

      prismaMock.financialCategory.count.mockResolvedValue(0);
      prismaMock.financialTitle.count.mockResolvedValue(1);

      const sourceAlloc1 = { id: "alloc-src-1", barbershopId: TENANT_A, financialEntryId: "entry-1", allocatedAmount: new Prisma.Decimal("50.00") };
      const sourceAlloc2 = { id: "alloc-src-2", barbershopId: TENANT_A, financialEntryId: "entry-2", allocatedAmount: new Prisma.Decimal("30.00") };

      prismaMock.financialEntryAllocation.findMany.mockResolvedValue([sourceAlloc1, sourceAlloc2]);

      const targetAlloc1 = { id: "alloc-tgt-1", barbershopId: TENANT_A, financialEntryId: "entry-1", allocatedAmount: new Prisma.Decimal("100.00") };
      prismaMock.financialEntryAllocation.findFirst
        .mockResolvedValueOnce(targetAlloc1)
        .mockResolvedValueOnce(null);

      const res = await retireCategory(TENANT_A, "c-source", "c-rep");

      expect(res.success).toBe(true);
      expect(res.migrated).toBe(true);

      expect(prismaMock.financialTitle.updateMany).toHaveBeenCalledWith({
        where: { barbershopId: TENANT_A, categoryId: "c-source" },
        data: { categoryId: "c-rep" },
      });
      expect(prismaMock.financialEntryAllocation.update).toHaveBeenCalledWith({
        where: { id: "alloc-tgt-1" },
        data: { allocatedAmount: new Prisma.Decimal("150.00") },
      });
    });
  });

  describe("BOOTSTRAP, READ-ONLY ANALYSIS E CONFLITO DE ROOT COM PAI", () => {
    it("analyzeFinancialPlan realiza leitura sem escrever e identifica falta de categorias", async () => {
      prismaMock.financialCategory.findMany.mockResolvedValue([]);
      prismaMock.financialCategorySystemMapping.findMany.mockResolvedValue([]);

      const analysis = await analyzeFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);

      expect(analysis.missingCategories.length).toBe(OFFICIAL_CATEGORIES.length);
      expect(analysis.missingMappings.length).toBe(OFFICIAL_SYSTEM_MAPPINGS.length);
      expect(analysis.structuralConflicts.length).toBe(0);
      expect(prismaMock.financialCategory.create).not.toHaveBeenCalled();
    });

    it("detecta conflito de root oficial que possui pai (parentCategoryId != null)", async () => {
      const badRoot = mockCat({
        id: "cat-root-bad",
        barbershopId: TENANT_A,
        code: "01", // Root oficial 01
        name: "Receitas Com Pai",
        classification: FinancialCategoryClassification.REVENUE,
        parentCategoryId: "outra-cat", // CONFLITO: Categoria root oficial com pai!
      });

      prismaMock.financialCategory.findMany.mockResolvedValue([badRoot]);

      const analysis = await analyzeFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);
      expect(analysis.structuralConflicts.length).toBeGreaterThan(0);
      expect(analysis.structuralConflicts[0]).toContain("categoria oficial root 01: categoria possui pai");

      await expect(bootstrapFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A)).rejects.toThrow(
        "categoria oficial root 01: categoria possui pai"
      );
    });

    it("preserva mapping de sistema já existente sem sobrescrever e registra PRESERVED_EXISTING_MAPPING", async () => {
      const existingMapping = {
        id: "map-1",
        barbershopId: TENANT_A,
        systemKey: "COMANDA_SERVICE_REVENUE",
        categoryId: "custom-cat-id",
      };

      prismaMock.financialCategory.findMany.mockResolvedValue([]);
      prismaMock.financialCategorySystemMapping.findMany.mockResolvedValue([existingMapping]);

      const analysis = await analyzeFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);

      expect(analysis.preservedMappings).toHaveLength(1);
      expect(analysis.preservedMappings[0]).toEqual({
        systemKey: "COMANDA_SERVICE_REVENUE",
        existingCategoryId: "custom-cat-id",
        status: "PRESERVED_EXISTING_MAPPING",
      });
    });

    it("bootstrap não sobrescreve nomes customizados de categorias oficiais existentes", async () => {
      const codeToIdMap = new Map(OFFICIAL_CATEGORIES.map((def, idx) => [def.code, `cat-id-${idx}`]));
      const existingCats = OFFICIAL_CATEGORIES.map((def, idx) => mockCat({
        id: `cat-id-${idx}`,
        barbershopId: TENANT_A,
        code: def.code,
        name: def.code === "01.01" ? "Cortes e Barbas do Zé" : def.name,
        classification: def.classification,
        parentCategoryId: def.parentCode ? codeToIdMap.get(def.parentCode)! : null,
        isActive: true,
      }));

      prismaMock.financialCategory.findMany.mockResolvedValue(existingCats);
      prismaMock.financialCategorySystemMapping.findMany.mockResolvedValue([]);

      const analysis = await analyzeFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);
      expect(analysis.preservedCustomNames).toHaveLength(1);
      expect(analysis.preservedCustomNames[0].customName).toBe("Cortes e Barbas do Zé");

      await bootstrapFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);
      expect(prismaMock.financialCategory.update).not.toHaveBeenCalled();
    });
  });

  describe("ADVISORY LOCK FAIL-CLOSED E BOOTSTRAP LOCK", () => {
    it("listCategoriesTree monta a árvore tenant-scoped", async () => {
      const c1 = mockCat({ id: "c1", barbershopId: TENANT_A, code: "01", name: "Receitas", parentCategoryId: null });
      prismaMock.financialCategory.findMany.mockResolvedValue([c1]);
      const tree = await listCategoriesTree(TENANT_A);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe("c1");
    });

    it("LOCK_FAILURE_ABORTS_MUTATION: erro no advisory lock aborta mutações e não chama create/update", async () => {
      prismaMock.$executeRawUnsafe.mockRejectedValueOnce(new Error("PostgreSQL Advisory Lock Connection Failure"));

      await expect(
        createCategory(TENANT_A, {
          name: "Categoria Bloqueada",
          classification: FinancialCategoryClassification.REVENUE,
          parentCategoryId: "p-01",
        })
      ).rejects.toThrow("PostgreSQL Advisory Lock Connection Failure");

      expect(prismaMock.financialCategory.create).not.toHaveBeenCalled();
      expect(prismaMock.financialCategory.update).not.toHaveBeenCalled();
    });

    it("BOOTSTRAP_TENANT_LOCK & BOOTSTRAP_LOCK_FAILURE_ABORTS_WRITE: bootstrap adquire lock e aborta se o lock falhar", async () => {
      // 1. Prova de ordem: Lock -> Analyze -> Writes
      const callOrder: string[] = [];
      prismaMock.$executeRawUnsafe.mockImplementationOnce(() => {
        callOrder.push("LOCK");
        return Promise.resolve(1);
      });
      prismaMock.financialCategory.findMany.mockImplementationOnce(() => {
        callOrder.push("ANALYZE");
        return Promise.resolve([]);
      });
      prismaMock.financialCategorySystemMapping.findMany.mockResolvedValue([]);
      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) => {
        callOrder.push("WRITE_CAT");
        return Promise.resolve({ id: "created-cat", ...args.data });
      });

      await bootstrapFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A);
      expect(callOrder[0]).toBe("LOCK");
      expect(callOrder[1]).toBe("ANALYZE");
      expect(callOrder).toContain("WRITE_CAT");

      // 2. Prova de aborto se lock falha
      vi.clearAllMocks();
      prismaMock.$executeRawUnsafe.mockRejectedValueOnce(new Error("Lock Fail"));

      await expect(
        bootstrapFinancialPlan(prismaMock as unknown as Prisma.TransactionClient, TENANT_A)
      ).rejects.toThrow("Lock Fail");

      expect(prismaMock.financialCategory.create).not.toHaveBeenCalled();
      expect(prismaMock.financialCategorySystemMapping.create).not.toHaveBeenCalled();
    });
  });
});
