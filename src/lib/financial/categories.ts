import { FinancialCategory, FinancialCategoryClassification, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { randomUUID } from "crypto";

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
import { OFFICIAL_CATEGORIES } from "./default-plan";

export type { DbClient };
export {
  getTenantLockKey,
  lockFinancialCategoryTenant,
  withFinancialCategoryMutationTransaction,
};

/**
 * Códigos oficiais do plano padrão de contas.
 */
export const OFFICIAL_CATEGORY_CODES = new Set(OFFICIAL_CATEGORIES.map((c) => c.code));

/**
 * Códigos das raízes oficiais (01 a 08).
 */
export const OFFICIAL_ROOT_CODES = new Set(
  OFFICIAL_CATEGORIES.filter((c) => c.parentCode === null).map((c) => c.code)
);

export function isOfficialCategoryCode(code: string): boolean {
  return OFFICIAL_CATEGORY_CODES.has(code);
}

export function isOfficialRootCode(code: string): boolean {
  return OFFICIAL_ROOT_CODES.has(code);
}

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
 * Valida se um código de categoria segue a regra hierárquica canônica:
 * Segmentos de 2 dígitos separados por ponto (ex: "01", "01.01", "01.01.01"), até 3 níveis.
 */
export function isValidHierarchicalCategoryCode(code: string): boolean {
  return /^\d{2}(\.\d{2}){0,2}$/.test(code);
}

/**
 * Verifica se um código termina no bucket reservado .99 (ou é 99).
 */
export function isTerminal99Bucket(code: string): boolean {
  return /(^|\.)99$/.test(code);
}

/**
 * Gera o próximo código hierárquico dentro do pai informado.
 * - Encontra o menor slot numérico livre entre 01 e 98.
 * - O slot 99 é reservado exclusivamente para "Outras ..." e nunca é atribuído automaticamente.
 * - Considera categorias ativas e inativas (códigos inativos continuam reservados).
 * - Lança CATEGORY_SLOTS_EXHAUSTED se todos os slots 01..98 estiverem ocupados.
 */
export async function generateNextHierarchicalCategoryCode(
  tx: DbClient,
  barbershopId: string,
  parent: FinancialCategory
): Promise<string> {
  if (!isValidHierarchicalCategoryCode(parent.code)) {
    throw new FinancialCategoryError(
      "FINANCIAL_CATEGORY_PARENT_INVALID_CODE",
      `O código da categoria pai "${parent.code}" não segue o padrão hierárquico oficial (ex: "01", "01.01").`,
      409
    );
  }

  if (isTerminal99Bucket(parent.code)) {
    throw new FinancialCategoryError(
      "FINANCIAL_CATEGORY_TERMINAL_BUCKET",
      `A categoria "${parent.code}" é um bucket reservado (.99) e não pode receber subcategorias.`,
      409
    );
  }

  // Buscar todos os filhos existentes do pai (tanto ativos quanto inativos)
  const existingChildren = await tx.financialCategory.findMany({
    where: { barbershopId, parentCategoryId: parent.id },
    select: { code: true },
  });

  // Também verificar no tenant qualquer categoria que use o prefixo do pai para prevenir colisões de código
  const prefix = `${parent.code}.`;
  const collidingCategories = await tx.financialCategory.findMany({
    where: {
      barbershopId,
      code: { startsWith: prefix },
    },
    select: { code: true },
  });

  const usedSlots = new Set<number>();

  for (const child of [...existingChildren, ...collidingCategories]) {
    if (child.code.startsWith(prefix)) {
      const rest = child.code.slice(prefix.length);
      const segment = rest.split(".")[0];
      if (/^\d{2}$/.test(segment)) {
        const num = parseInt(segment, 10);
        if (!isNaN(num)) {
          usedSlots.add(num);
        }
      }
    }
  }

  // Encontrar o menor slot livre entre 1 e 98
  for (let slot = 1; slot <= 98; slot++) {
    if (!usedSlots.has(slot)) {
      const formattedSlot = String(slot).padStart(2, "0");
      return `${parent.code}.${formattedSlot}`;
    }
  }

  throw new FinancialCategoryError(
    "CATEGORY_SLOTS_EXHAUSTED",
    `Não há slots numéricos disponíveis (01 a 98) sob a categoria "${parent.code}".`,
    409
  );
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

  if (!parentCategoryId || typeof parentCategoryId !== "string" || parentCategoryId.trim().length === 0) {
    throw new FinancialCategoryError(
      "FINANCIAL_CATEGORY_PARENT_REQUIRED",
      "É obrigatório selecionar uma categoria pai para criar uma nova categoria.",
      400
    );
  }

  const typedClassification = classification as FinancialCategoryClassification;
  const normalizedParentId = parentCategoryId.trim();

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
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

    if (isTerminal99Bucket(parent.code)) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_TERMINAL_BUCKET",
        `A categoria "${parent.code}" é um bucket reservado (.99) e não pode receber subcategorias.`,
        409
      );
    }

    if (isOfficialCategoryCode(parent.code) && !isOfficialRootCode(parent.code)) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_OFFICIAL_NON_ROOT_CHILD_BLOCKED",
        `A categoria oficial folha "${parent.code} - ${parent.name}" é estrutural e não pode receber subcategorias customizadas.`,
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

    const code = await generateNextHierarchicalCategoryCode(tx, barbershopId, parent);

    try {
      return await tx.financialCategory.create({
        data: {
          barbershopId,
          code,
          name: name.trim(),
          classification: typedClassification,
          parentCategoryId: normalizedParentId,
          isActive: true,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_CODE_CONFLICT",
          `Conflito de unicidade ao registrar a categoria com o código ${code}.`,
          409
        );
      }
      throw err;
    }
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
 * Mover categoria para novo pai.
 * Serializado por tenant via pg_advisory_xact_lock dentro de transação.
 * - Impede movimentação de raízes oficiais ("01" a "08").
 * - Impede mover categorias comuns para a raiz (parentCategoryId null).
 * - Recalcula deterministicamente o código da categoria e de todas as subcategorias da sua subárvore.
 * - Utiliza códigos temporários para evitar violação do índice único @@unique([barbershopId, code]).
 */
export async function moveCategory(
  barbershopId: string,
  categoryId: string,
  targetParentCategoryId: unknown,
  client?: DbClient
): Promise<FinancialCategory> {
  if (
    targetParentCategoryId === undefined ||
    targetParentCategoryId === null ||
    typeof targetParentCategoryId !== "string" ||
    targetParentCategoryId.trim().length === 0
  ) {
    throw new FinancialCategoryError(
      "FINANCIAL_CATEGORY_PARENT_REQUIRED",
      "É obrigatório selecionar uma categoria pai de destino.",
      400
    );
  }

  const normalizedParentId = targetParentCategoryId.trim();

  return withFinancialCategoryMutationTransaction(barbershopId, client, async (tx) => {
    // 1. Reler source dentro da transação após lock
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

    // 2. Proteger todas as categorias oficiais contra movimentação
    if (isOfficialCategoryCode(source.code)) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_OFFICIAL_STRUCTURE_IMMUTABLE",
        `A categoria oficial "${source.code} - ${source.name}" possui posição canônica fixa e não pode ser movida.`,
        409
      );
    }

    if (source.parentCategoryId === normalizedParentId) {
      return source;
    }

    // 3. Reler árvore completa do tenant após lock
    const allCategories = await tx.financialCategory.findMany({
      where: { barbershopId },
    });

    // 4. Validar parent de destino
    const parent = allCategories.find((c) => c.id === normalizedParentId);

    if (!parent || !parent.isActive) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_PARENT_NOT_FOUND",
        "Categoria pai de destino não encontrada ou inativa.",
        404
      );
    }

    if (isTerminal99Bucket(parent.code)) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_TERMINAL_BUCKET",
        `A categoria "${parent.code}" é um bucket reservado (.99) e não pode receber subcategorias.`,
        409
      );
    }

    if (isOfficialCategoryCode(parent.code) && !isOfficialRootCode(parent.code)) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_OFFICIAL_NON_ROOT_CHILD_BLOCKED",
        `A categoria oficial folha "${parent.code} - ${parent.name}" é estrutural e não pode receber subcategorias.`,
        409
      );
    }

    if (parent.id === source.id) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_CYCLE",
        "Uma categoria não pode ser pai de si mesma.",
        409
      );
    }

    // 5. Validar classification
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

    // 7. Validar parent-in-use
    const parentInUse = await isCategoryInUse(tx, barbershopId, parent.id);
    if (parentInUse) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_PARENT_IN_USE",
        "A categoria pai de destino está em uso para lançamentos.",
        409
      );
    }

    const targetParentDepth = calculateCategoryDepth(allCategories, parent.id);

    // 8. Validar subtree depth
    const sourceSubtreeHeight = calculateSubtreeHeight(allCategories, source.id);
    const finalMaxDepth = targetParentDepth + sourceSubtreeHeight;

    if (finalMaxDepth > 3) {
      throw new FinancialCategoryError(
        "FINANCIAL_CATEGORY_MAX_DEPTH",
        "A movimentação resultaria em uma profundidade superior a 3 níveis.",
        409
      );
    }

    // 9. Gerar novo código hierárquico para o nó de origem
    const newSourceCode = await generateNextHierarchicalCategoryCode(tx, barbershopId, parent);

    // 10. Coletar todos os nós da subárvore do source (em largura/nível para recodificação ordenada)
    // Map de parentId -> filhos
    const childrenByParent = new Map<string, FinancialCategory[]>();
    for (const cat of allCategories) {
      if (cat.parentCategoryId) {
        if (!childrenByParent.has(cat.parentCategoryId)) {
          childrenByParent.set(cat.parentCategoryId, []);
        }
        childrenByParent.get(cat.parentCategoryId)!.push(cat);
      }
    }

    // Função para coletar nós da subárvore
    const subtreeNodes: FinancialCategory[] = [];
    const queue = [source.id];
    while (queue.length > 0) {
      const currentParentId = queue.shift()!;
      const children = childrenByParent.get(currentParentId) || [];
      // Ordenar deterministicamente por code ASC, name ASC, id ASC
      children.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      for (const ch of children) {
        subtreeNodes.push(ch);
        queue.push(ch.id);
      }
    }

    // 11. Para evitar violação de unicidade [barbershopId, code], atribuir códigos temporários
    // primeiro ao source e a todos os nós da subárvore usando namespace reservado e verificação prévia.
    const allToRecode = [source, ...subtreeNodes];
    let operationId = randomUUID();
    let temporaryCodes = allToRecode.map((node) => `__TB_MOVE_TMP__${operationId}__${node.id}`);

    // Pre-check de colisão inesperada com códigos existentes no tenant
    let existingTmpCollision = await tx.financialCategory.findFirst({
      where: {
        barbershopId,
        code: { in: temporaryCodes },
      },
    });

    if (existingTmpCollision) {
      operationId = randomUUID();
      temporaryCodes = allToRecode.map((node) => `__TB_MOVE_TMP__${operationId}__${node.id}`);
      existingTmpCollision = await tx.financialCategory.findFirst({
        where: {
          barbershopId,
          code: { in: temporaryCodes },
        },
      });
      if (existingTmpCollision) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_TEMPORARY_CODE_COLLISION",
          "Conflito inesperado ao alocar códigos temporários para recodificação da árvore.",
          409
        );
      }
    }

    for (let i = 0; i < allToRecode.length; i++) {
      const node = allToRecode[i];
      await tx.financialCategory.update({
        where: { id_barbershopId: { id: node.id, barbershopId } },
        data: {
          code: temporaryCodes[i],
        },
      });
    }

    // 12. Atualizar o source para o novo pai e novo código
    const updatedSource = await tx.financialCategory.update({
      where: { id_barbershopId: { id: source.id, barbershopId } },
      data: {
        parentCategoryId: normalizedParentId,
        code: newSourceCode,
      },
    });

    // 13. Recodificar recursivamente os filhos da subárvore
    // Mapear id -> novo código definitivo
    const finalCodeById = new Map<string, string>();
    finalCodeById.set(source.id, newSourceCode);

    // Processar nível a nível:
    const recodeQueue = [source.id];
    while (recodeQueue.length > 0) {
      const currentParentId = recodeQueue.shift()!;
      const parentCode = finalCodeById.get(currentParentId)!;
      const children = childrenByParent.get(currentParentId) || [];
      children.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

      // Separar bucket terminal .99 legado (se existir) de filhos normais
      const legacy99Children = children.filter((c) => isTerminal99Bucket(c.code));
      const normalChildren = children.filter((c) => !isTerminal99Bucket(c.code));

      if (legacy99Children.length > 1) {
        throw new FinancialCategoryError(
          "FINANCIAL_CATEGORY_AMBIGUOUS_99_BUCKET",
          `A categoria possui mais de um bucket reservado .99 sob o mesmo nó (${parentCode}).`,
          409
        );
      }

      if (normalChildren.length > 98) {
        throw new FinancialCategoryError(
          "CATEGORY_SLOTS_EXHAUSTED",
          `A subárvore sob "${parentCode}" excede o limite de 98 categorias irmãs (01 a 98).`,
          409
        );
      }

      let slotIndex = 1;
      for (const child of normalChildren) {
        const childCode = `${parentCode}.${String(slotIndex).padStart(2, "0")}`;
        slotIndex++;
        finalCodeById.set(child.id, childCode);

        await tx.financialCategory.update({
          where: { id_barbershopId: { id: child.id, barbershopId } },
          data: { code: childCode },
        });

        recodeQueue.push(child.id);
      }

      if (legacy99Children.length === 1) {
        const child99 = legacy99Children[0];
        const child99Code = `${parentCode}.99`;
        finalCodeById.set(child99.id, child99Code);

        await tx.financialCategory.update({
          where: { id_barbershopId: { id: child99.id, barbershopId } },
          data: { code: child99Code },
        });

        recodeQueue.push(child99.id);
      }
    }

    return updatedSource;
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
