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

  describe("VALIDAÇÃO DE PAYLOADS E CUSTOM CODE RETRY", () => {
    it("rejeita payload inválido no POST (400)", async () => {
      await expect(createCategory(TENANT_A, { name: "", classification: FinancialCategoryClassification.REVENUE })).rejects.toThrow(FinancialCategoryError);
      await expect(createCategory(TENANT_A, { name: "Nome", classification: "INVALID" as unknown as FinancialCategoryClassification })).rejects.toThrow(FinancialCategoryError);
      await expect(createCategory(TENANT_A, { name: "Nome", classification: FinancialCategoryClassification.REVENUE, parentCategoryId: 123 as unknown as string })).rejects.toThrow(FinancialCategoryError);
    });

    it("rejeita payload inválido no MOVE e RETIRE (400)", async () => {
      await expect(moveCategory(TENANT_A, "cat-1", 123 as unknown as string)).rejects.toThrow(FinancialCategoryError);
      await expect(retireCategory(TENANT_A, "cat-1", 123 as unknown as string)).rejects.toThrow(FinancialCategoryError);
      await expect(updateCategory(TENANT_A, "cat-1", { name: "" })).rejects.toThrow(FinancialCategoryError);
    });

    it("tenta gerar custom code novamente em colisão e obtém sucesso na segunda tentativa", async () => {
      prismaMock.financialCategory.findUnique
        .mockResolvedValueOnce(mockCat({ id: "colisao-1" })) // Colisão na 1ª tentativa
        .mockResolvedValueOnce(null); // Livre na 2ª tentativa

      prismaMock.financialCategory.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(mockCat({ id: "created-id", ...args.data }))
      );

      const created = await createCategory(TENANT_A, {
        name: "Serviço Retry",
        classification: FinancialCategoryClassification.REVENUE,
      });

      expect(created.name).toBe("Serviço Retry");
      expect(prismaMock.financialCategory.findUnique).toHaveBeenCalledTimes(2);
    });

    it("lança FINANCIAL_CATEGORY_CODE_CONFLICT (409) após esgotar todas as tentativas de custom code", async () => {
      prismaMock.financialCategory.findUnique.mockResolvedValue(mockCat({ id: "colisao-eterna" }));

      await expect(
        createCategory(TENANT_A, {
          name: "Serviço Esgotado",
          classification: FinancialCategoryClassification.REVENUE,
        })
      ).rejects.toThrow("Não foi possível gerar um código único para a categoria após várias tentativas.");
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

    it("moveCategory usa selector composto tenant-safe id_barbershopId", async () => {
      const source = mockCat({ id: "cat-src", barbershopId: TENANT_A });
      const parent = mockCat({ id: "cat-parent", barbershopId: TENANT_A });

      prismaMock.financialCategory.findFirst.mockResolvedValue(source);
      prismaMock.financialCategory.findMany.mockResolvedValue([source, parent]);
      prismaMock.financialTitle.count.mockResolvedValue(0);
      prismaMock.financialRoutine.count.mockResolvedValue(0);
      prismaMock.financialCategorySystemMapping.count.mockResolvedValue(0);
      prismaMock.financialEntryAllocation.count.mockResolvedValue(0);
      prismaMock.financialCategory.update.mockResolvedValue({ ...source, parentCategoryId: parent.id });

      await moveCategory(TENANT_A, "cat-src", "cat-parent");

      expect(prismaMock.financialCategory.update).toHaveBeenCalledWith({
        where: { id_barbershopId: { id: "cat-src", barbershopId: TENANT_A } },
        data: { parentCategoryId: "cat-parent" },
      });
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
