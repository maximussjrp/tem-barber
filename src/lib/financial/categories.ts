import { FinancialCategory, FinancialCategoryClassification, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { randomBytes } from "crypto";

export class FinancialCategoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "FinancialCategoryError";
    this.code = code;
    this.status = status;
  }
}

export interface CategoryNode {
  id: string;
  code: string;
  name: string;
  classification: FinancialCategoryClassification;
  parentCategoryId: string | null;
  isActive: boolean;
  depth: number;
  isLeaf: boolean;
  children: CategoryNode[];
}

import {
  DbClient,
  getTenantLockKey,
  lockFinancialCategoryTenant,
  withFinancialCategoryMutationTransaction,
} from "./category-lock";

export type { DbClient };
export {
  getTenantLockKey,
  lockFinancialCategoryTenant,
  withFinancialCategoryMutationTransaction,
};

/**
 * Verifica se uma categoria está diretamente vinculada em qualquer uma das 4 tabelas de lançamentos/regras.
 */
export async function isCategoryInUse(
  tx: DbClient,
  barbershopId: string,
  categoryId: string
): Promise<boolean> {
  const [titleCount, routineCount, mappingCount, allocationCount] = await Promise.all([
    tx.financialTitle.count({
      where: { barbershopId, categoryId },
    }),
    tx.financialRoutine.count({
      where: { barbershopId, categoryId },
    }),
    tx.financialCategorySystemMapping.count({
      where: { barbershopId, categoryId },
    }),
    tx.financialEntryAllocation.count({
      where: { barbershopId, financialCategoryId: categoryId },
    }),
  ]);

  return titleCount > 0 || routineCount > 0 || mappingCount > 0 || allocationCount > 0;
}

/**
 * Calcula a profundidade (1-indexed: Root = 1, Child = 2, Grandchild = 3) de um nó na árvore.
 */
export function calculateCategoryDepth(
  allCategories: FinancialCategory[],
  categoryId: string
): number {
  let depth = 1;
  let current = allCategories.find((c) => c.id === categoryId);
  const visited = new Set<string>();

  while (current && current.parentCategoryId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);

    const parent = allCategories.find((c) => c.id === current!.parentCategoryId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }

  return depth;
}

/**
 * Calcula a altura relativa da subárvore com raiz no nó fornecido.
 * Se o nó for folha, a altura da subárvore é 1.
 */
export function calculateSubtreeHeight(
  allCategories: FinancialCategory[],
  rootId: string
): number {
  const children = allCategories.filter((c) => c.parentCategoryId === rootId);
  if (children.length === 0) return 1;

  let maxChildHeight = 0;
  for (const child of children) {
    const childHeight = calculateSubtreeHeight(allCategories, child.id);
    if (childHeight > maxChildHeight) {
      maxChildHeight = childHeight;
    }
  }

  return 1 + maxChildHeight;
}

/**
 * Monta a estrutura completa de nós da árvore a partir da lista plana de categorias.
 */
export function buildTreeNodes(categories: FinancialCategory[]): CategoryNode[] {
  const childrenMap = new Map<string | null, FinancialCategory[]>();
  for (const cat of categories) {
    const parentKey = cat.parentCategoryId ?? null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(cat);
  }

  function buildNode(cat: FinancialCategory): CategoryNode {
    const childrenList = childrenMap.get(cat.id) || [];
    childrenList.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

    const depth = calculateCategoryDepth(categories, cat.id);
    const childrenNodes = childrenList.map(buildNode);
    const isLeaf = childrenNodes.length === 0;

    return {
      id: cat.id,
      code: cat.code,
      name: cat.name,
      classification: cat.classification,
      parentCategoryId: cat.parentCategoryId,
      isActive: cat.isActive,
      depth,
      isLeaf,
      children: childrenNodes,
    };
  }

  const rootCategories = childrenMap.get(null) || [];
  rootCategories.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

  return rootCategories.map(buildNode);
}

/**
 * Monta e retorna a árvore tenant-scoped contendo depth, isLeaf e filhos ordenados por code ASC, name ASC.
 */
export async function listCategoriesTree(
  barbershopId: string,
  client: DbClient = prisma
): Promise<CategoryNode[]> {
  const categories = await client.financialCategory.findMany({
    where: { barbershopId },
    orderBy: [{ code: "asc" }, { name: "asc" }],
  });

  return buildTreeNodes(categories);
}

/**
 * Busca detalhes completos de uma categoria específica do tenant, construindo recursivamente a subárvore real.
 */
export async function getCategoryById(
  barbershopId: string,
  categoryId: string,
  client: DbClient = prisma
): Promise<CategoryNode | null> {
  const allCategories = await client.financialCategory.findMany({
    where: { barbershopId },
    orderBy: [{ code: "asc" }, { name: "asc" }],
  });

  const targetCategory = allCategories.find((c) => c.id === categoryId);
  if (!targetCategory) return null;

  const fullTree = buildTreeNodes(allCategories);

  function findNode(nodes: CategoryNode[]): CategoryNode | null {
    for (const node of nodes) {
      if (node.id === categoryId) return node;
      const found = findNode(node.children);
      if (found) return found;
    }
    return null;
  }

  return findNode(fullTree);
}

/**
 * Gerador de código para categoria customizada.
 */
function generateCustomCode(): string {
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `CUSTOM-${rand}`;
}

/**
 * Criar categoria customizada no tenant.
 */
export async function createCategory(
  barbershopId: string,
  input: {
    name: unknown;
    classification: unknown;
    parentCategoryId?: unknown;
  },
  client?: DbClient
): Promise<FinancialCategory> {
  const { name, classification, parentCategoryId } = input;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new FinancialCategoryError("INVALID_NAME", "Nome da categoria é obrigatório.", 400);
  }

  if (
    typeof classification !== "string" ||
    !Object.values(FinancialCategoryClassification).includes(classification as FinancialCategoryClassification)
  ) {
    throw new FinancialCategoryError("INVALID_CLASSIFICATION", "Classificação inválida.", 400);
  }

  if (
    parentCategoryId !== undefined &&
    parentCategoryId !== null &&
    typeof parentCategoryId !== "string"
  ) {
    throw new FinancialCategoryError(
      "INVALID_PARENT_ID",
      "parentCategoryId deve ser uma string ou null.",
      400
    );
  }

  const typedClassification = classification as FinancialCategoryClassification;
  const normalizedParentId = (parentCategoryId as string | null | undefined) || null;

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
    if (normalizedParentId) {
      const parent = await tx.financialCategory.findFirst({
        where: { id: normalizedParentId, barbershopId },
      });

      if (!parent || !parent.isActive) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_PARENT_NOT_FOUND",
          "Categoria pai não encontrada ou inativa.",
          404
        );
      }

      if (parent.classification !== typedClassification) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_CLASSIFICATION_MISMATCH",
          "A classificação da categoria deve ser igual à do pai.",
          409
        );
      }

      const allCategories = await tx.financialCategory.findMany({
        where: { barbershopId },
      });

      const parentDepth = calculateCategoryDepth(allCategories, parent.id);
      if (parentDepth >= 3) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_MAX_DEPTH",
          "A profundidade da árvore não pode exceder 3 níveis.",
          409
        );
      }

      const parentInUse = await isCategoryInUse(tx, barbershopId, parent.id);
      if (parentInUse) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_PARENT_IN_USE",
          "A categoria pai está em uso para lançamentos e não pode possuir subcategorias.",
          409
        );
      }
    }

    // Tentar criar com retry seguro e tratamento de colisão unique (P2002)
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    let createdCategory: FinancialCategory | null = null;

    while (attempts < MAX_ATTEMPTS) {
      const code = generateCustomCode();
      const existingCode = await tx.financialCategory.findUnique({
        where: { barbershopId_code: { barbershopId, code } },
      });

      if (existingCode) {
        attempts += 1;
        continue;
      }

      try {
        createdCategory = await tx.financialCategory.create({
          data: {
            barbershopId,
            code,
            name: name.trim(),
            classification: typedClassification,
            parentCategoryId: normalizedParentId,
            isActive: true,
          },
        });
        break;
      } catch (err: unknown) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          attempts += 1;
          continue;
        }
        throw err;
      }
    }

    if (!createdCategory) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_CODE_CONFLICT",
        "Não foi possível gerar um código único para a categoria após várias tentativas.",
        409
      );
    }

    return createdCategory;
  });
}

/**
 * Renomear categoria (altera apenas name).
 */
export async function updateCategory(
  barbershopId: string,
  categoryId: string,
  input: { name: unknown },
  client?: DbClient
): Promise<FinancialCategory> {
  if (!input.name || typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new FinancialCategoryError("INVALID_NAME", "Nome da categoria é obrigatório.", 400);
  }

  const cleanName = input.name.trim();

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
    const category = await tx.financialCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });

    if (!category) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_NOT_FOUND",
        "Categoria não encontrada.",
        404
      );
    }

    return tx.financialCategory.update({
      where: { id_barbershopId: { id: categoryId, barbershopId } },
      data: {
        name: cleanName,
      },
    });
  });
}

/**
 * Mover categoria para novo pai ou para root.
 * Serializado por tenant via pg_advisory_xact_lock dentro de transação.
 */
export async function moveCategory(
  barbershopId: string,
  categoryId: string,
  targetParentCategoryId: unknown,
  client?: DbClient
): Promise<FinancialCategory> {
  if (
    targetParentCategoryId !== undefined &&
    targetParentCategoryId !== null &&
    typeof targetParentCategoryId !== "string"
  ) {
    throw new FinancialCategoryError(
      "INVALID_PARENT_ID",
      "parentCategoryId deve ser uma string ou null.",
      400
    );
  }

  const normalizedParentId = (targetParentCategoryId as string | null | undefined) || null;

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
    // 3. Reler source dentro da transação após lock
    const source = await tx.financialCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });

    if (!source) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_NOT_FOUND",
        "Categoria não encontrada.",
        404
      );
    }

    if (source.parentCategoryId === normalizedParentId) {
      return source;
    }

    // 4. Reler árvore completa do tenant após lock
    const allCategories = await tx.financialCategory.findMany({
      where: { barbershopId },
    });

    let targetParentDepth = 0;

    if (normalizedParentId) {
      // 5. Validar parent
      const parent = allCategories.find((c) => c.id === normalizedParentId);

      if (!parent || !parent.isActive) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_PARENT_NOT_FOUND",
          "Categoria pai de destino não encontrada ou inativa.",
          404
        );
      }

      if (parent.id === source.id) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_CYCLE",
          "Uma categoria não pode ser pai de si mesma.",
          409
        );
      }

      // 7. Validar classification
      if (parent.classification !== source.classification) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_CLASSIFICATION_MISMATCH",
          "A classificação da categoria deve ser igual à do pai.",
          409
        );
      }

      // 6. Validar cycle
      let curr: FinancialCategory | undefined = parent;
      const visited = new Set<string>();
      while (curr && curr.parentCategoryId) {
        if (visited.has(curr.id)) break;
        visited.add(curr.id);

        if (curr.parentCategoryId === source.id) {
          throw new FinancialCategoryError(
            "FINANCIAL_CATEGORY_CYCLE",
            "A movimentação criaria um ciclo na hierarquia.",
            409
          );
        }
        curr = allCategories.find((c) => c.id === curr!.parentCategoryId);
      }

      // 8. Validar parent-in-use
      const parentInUse = await isCategoryInUse(tx, barbershopId, parent.id);
      if (parentInUse) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_PARENT_IN_USE",
          "A categoria pai de destino está em uso para lançamentos.",
          409
        );
      }

      targetParentDepth = calculateCategoryDepth(allCategories, parent.id);
    }

    // 9. Validar subtree depth
    const sourceSubtreeHeight = calculateSubtreeHeight(allCategories, source.id);
    const finalMaxDepth = targetParentDepth + sourceSubtreeHeight;

    if (finalMaxDepth > 3) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_MAX_DEPTH",
        "A movimentação resultaria em uma profundidade superior a 3 níveis.",
        409
      );
    }

    // 10. Executar update usando chave composta tenant-safe
    return tx.financialCategory.update({
      where: { id_barbershopId: { id: source.id, barbershopId } },
      data: {
        parentCategoryId: normalizedParentId,
      },
    });
  });
}

/**
 * Aposentar (retire) categoria.
 * Executado dentro de transação com lock por tenant.
 */
export async function retireCategory(
  barbershopId: string,
  categoryId: string,
  replacementCategoryId?: unknown,
  client?: DbClient
): Promise<{ success: boolean; migrated: boolean }> {
  if (
    replacementCategoryId !== undefined &&
    replacementCategoryId !== null &&
    typeof replacementCategoryId !== "string"
  ) {
    throw new FinancialCategoryError(
      "INVALID_REPLACEMENT_ID",
      "replacementCategoryId deve ser uma string ou null.",
      400
    );
  }

  const typedReplacementId = (replacementCategoryId as string | null | undefined) || undefined;

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
    const source = await tx.financialCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });

    if (!source) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_NOT_FOUND",
        "Categoria não encontrada.",
        404
      );
    }

    const activeChildrenCount = await tx.financialCategory.count({
      where: { barbershopId, parentCategoryId: source.id, isActive: true },
    });

    if (activeChildrenCount > 0) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_HAS_ACTIVE_CHILDREN",
        "Não é possível inativar uma categoria que possui subcategorias ativas.",
        409
      );
    }

    const inUse = await isCategoryInUse(tx, barbershopId, source.id);

    if (!inUse) {
      await tx.financialCategory.update({
        where: { id_barbershopId: { id: source.id, barbershopId } },
        data: { isActive: false },
      });
      return { success: true, migrated: false };
    }

    if (!typedReplacementId) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_REPLACEMENT_REQUIRED",
        "Esta categoria está em uso e exige uma categoria de substituição para aposentadoria.",
        409
      );
    }

    if (typedReplacementId === source.id) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_INVALID_REPLACEMENT",
        "A categoria de substituição deve ser diferente da categoria a ser aposentada.",
        409
      );
    }

    const replacement = await tx.financialCategory.findFirst({
      where: { id: typedReplacementId, barbershopId },
    });

    if (!replacement || !replacement.isActive) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_INVALID_REPLACEMENT",
        "Categoria de substituição não encontrada ou inativa no mesmo estabelecimento.",
        409
      );
    }

    if (replacement.classification !== source.classification) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_INVALID_REPLACEMENT",
        "A categoria de substituição deve possuir a mesma classificação da categoria de origem.",
        409
      );
    }

    const replacementChildrenCount = await tx.financialCategory.count({
      where: { barbershopId, parentCategoryId: replacement.id },
    });

    if (replacementChildrenCount > 0) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_INVALID_REPLACEMENT",
        "A categoria de substituição deve ser uma categoria folha (leaf).",
        409
      );
    }

    await tx.financialTitle.updateMany({
      where: { barbershopId, categoryId: source.id },
      data: { categoryId: replacement.id },
    });

    await tx.financialRoutine.updateMany({
      where: { barbershopId, categoryId: source.id },
      data: { categoryId: replacement.id },
    });

    await tx.financialCategorySystemMapping.updateMany({
      where: { barbershopId, categoryId: source.id },
      data: { categoryId: replacement.id },
    });

    const sourceAllocations = await tx.financialEntryAllocation.findMany({
      where: { barbershopId, financialCategoryId: source.id },
    });

    for (const sourceAlloc of sourceAllocations) {
      const targetAlloc = await tx.financialEntryAllocation.findFirst({
        where: {
          barbershopId,
          financialEntryId: sourceAlloc.financialEntryId,
          financialCategoryId: replacement.id,
        },
      });

      if (targetAlloc) {
        const targetAmount = new Prisma.Decimal(targetAlloc.allocatedAmount);
        const sourceAmount = new Prisma.Decimal(sourceAlloc.allocatedAmount);
        const merged = targetAmount.add(sourceAmount);

        if (merged.equals(0)) {
          await tx.financialEntryAllocation.delete({ where: { id: targetAlloc.id } });
          await tx.financialEntryAllocation.delete({ where: { id: sourceAlloc.id } });
        } else {
          await tx.financialEntryAllocation.update({
            where: { id: targetAlloc.id },
            data: { allocatedAmount: merged },
          });
          await tx.financialEntryAllocation.delete({ where: { id: sourceAlloc.id } });
        }
      } else {
        await tx.financialEntryAllocation.update({
          where: { id: sourceAlloc.id },
          data: { financialCategoryId: replacement.id },
        });
      }
    }

    await tx.financialCategory.update({
      where: { id_barbershopId: { id: source.id, barbershopId } },
      data: { isActive: false },
    });

    return { success: true, migrated: true };
  });
}
