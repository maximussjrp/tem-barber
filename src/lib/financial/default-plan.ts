import { FinancialCategory, FinancialCategoryClassification, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

import { lockFinancialCategoryTenant } from "./category-lock";

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface OfficialCategoryDef {
  code: string;
  name: string;
  classification: FinancialCategoryClassification;
  parentCode: string | null;
}

export const OFFICIAL_CATEGORIES: OfficialCategoryDef[] = [
  // 01 REVENUE
  { code: "01", name: "Receitas", classification: FinancialCategoryClassification.REVENUE, parentCode: null },
  { code: "01.01", name: "Serviços", classification: FinancialCategoryClassification.REVENUE, parentCode: "01" },
  { code: "01.02", name: "Produtos", classification: FinancialCategoryClassification.REVENUE, parentCode: "01" },
  { code: "01.03", name: "Clube", classification: FinancialCategoryClassification.REVENUE, parentCode: "01" },
  { code: "01.04", name: "Estornos de Receita", classification: FinancialCategoryClassification.REVENUE, parentCode: "01" },
  { code: "01.99", name: "Outras Receitas", classification: FinancialCategoryClassification.REVENUE, parentCode: "01" },

  // 02 VARIABLE_COST
  { code: "02", name: "Custos Variáveis", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: null },
  { code: "02.01", name: "Comissões", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },
  { code: "02.02", name: "Adiantamentos de Comissão", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },
  { code: "02.03", name: "Taxas de Pagamento", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },
  { code: "02.04", name: "Custo de Produtos", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },
  { code: "02.05", name: "Repasses do Clube", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },
  { code: "02.99", name: "Outros Custos Variáveis", classification: FinancialCategoryClassification.VARIABLE_COST, parentCode: "02" },

  // 03 FIXED_EXPENSE
  { code: "03", name: "Despesas Fixas", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: null },
  { code: "03.01", name: "Aluguel", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.02", name: "Água", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.03", name: "Energia", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.04", name: "Internet e Telefonia", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.05", name: "Sistemas e Software", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.06", name: "Contabilidade", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },
  { code: "03.99", name: "Outras Despesas Fixas", classification: FinancialCategoryClassification.FIXED_EXPENSE, parentCode: "03" },

  // 04 INVESTMENT
  { code: "04", name: "Investimentos", classification: FinancialCategoryClassification.INVESTMENT, parentCode: null },
  { code: "04.01", name: "Marketing", classification: FinancialCategoryClassification.INVESTMENT, parentCode: "04" },
  { code: "04.02", name: "Equipamentos", classification: FinancialCategoryClassification.INVESTMENT, parentCode: "04" },
  { code: "04.03", name: "Treinamentos", classification: FinancialCategoryClassification.INVESTMENT, parentCode: "04" },
  { code: "04.99", name: "Outros Investimentos", classification: FinancialCategoryClassification.INVESTMENT, parentCode: "04" },

  // 05 NON_OPERATING_IN
  { code: "05", name: "Entradas Não Operacionais", classification: FinancialCategoryClassification.NON_OPERATING_IN, parentCode: null },
  { code: "05.01", name: "Aportes", classification: FinancialCategoryClassification.NON_OPERATING_IN, parentCode: "05" },
  { code: "05.02", name: "Empréstimos Recebidos", classification: FinancialCategoryClassification.NON_OPERATING_IN, parentCode: "05" },
  { code: "05.99", name: "Outras Entradas Não Operacionais", classification: FinancialCategoryClassification.NON_OPERATING_IN, parentCode: "05" },

  // 06 NON_OPERATING_OUT
  { code: "06", name: "Saídas Não Operacionais", classification: FinancialCategoryClassification.NON_OPERATING_OUT, parentCode: null },
  { code: "06.01", name: "Retiradas Extraordinárias", classification: FinancialCategoryClassification.NON_OPERATING_OUT, parentCode: "06" },
  { code: "06.99", name: "Outras Saídas Não Operacionais", classification: FinancialCategoryClassification.NON_OPERATING_OUT, parentCode: "06" },

  // 07 TRANSFER
  { code: "07", name: "Transferências", classification: FinancialCategoryClassification.TRANSFER, parentCode: null },
  { code: "07.01", name: "Entre Contas", classification: FinancialCategoryClassification.TRANSFER, parentCode: "07" },

  // 08 ADJUSTMENT
  { code: "08", name: "Ajustes", classification: FinancialCategoryClassification.ADJUSTMENT, parentCode: null },
  { code: "08.01", name: "Ajuste de Entrada", classification: FinancialCategoryClassification.ADJUSTMENT, parentCode: "08" },
  { code: "08.02", name: "Ajuste de Saída", classification: FinancialCategoryClassification.ADJUSTMENT, parentCode: "08" },
];

export interface OfficialSystemMappingDef {
  systemKey: string;
  categoryCode: string;
}

export const OFFICIAL_SYSTEM_MAPPINGS: OfficialSystemMappingDef[] = [
  { systemKey: "COMANDA_SERVICE_REVENUE", categoryCode: "01.01" },
  { systemKey: "COMANDA_PRODUCT_REVENUE", categoryCode: "01.02" },
  { systemKey: "CLUB_REVENUE", categoryCode: "01.03" },
  { systemKey: "REFUND", categoryCode: "01.04" },
  { systemKey: "COMMISSION_PAYOUT", categoryCode: "02.01" },
  { systemKey: "COMMISSION_ADVANCE", categoryCode: "02.02" },
  { systemKey: "COMMISSION_ADVANCE_REVERSAL", categoryCode: "02.02" },
  { systemKey: "CLUB_BARBER_PAYOUT", categoryCode: "02.05" },
];

export interface FinancialPlanAnalysis {
  missingCategories: OfficialCategoryDef[];
  missingMappings: OfficialSystemMappingDef[];
  preservedCategories: string[];
  preservedCustomNames: { code: string; customName: string; officialName: string }[];
  preservedMappings: { systemKey: string; existingCategoryId: string; status: "PRESERVED_EXISTING_MAPPING" }[];
  structuralConflicts: string[];
}

/**
 * Realiza uma análise read-only da estrutura atual do tenant em relação ao Plano Financeiro Padrão V1.
 * NENHUMA alteração no banco de dados é feita durante esta chamada.
 */
export async function analyzeFinancialPlan(
  tx: DbClient,
  barbershopId: string
): Promise<FinancialPlanAnalysis> {
  const existingCategories = await tx.financialCategory.findMany({
    where: { barbershopId },
  });

  const categoryByCode = new Map<string, FinancialCategory>(
    existingCategories.map((c) => [c.code, c])
  );

  const missingCategories: OfficialCategoryDef[] = [];
  const preservedCategories: string[] = [];
  const preservedCustomNames: { code: string; customName: string; officialName: string }[] = [];
  const structuralConflicts: string[] = [];

  for (const def of OFFICIAL_CATEGORIES) {
    const existing = categoryByCode.get(def.code);

    if (existing) {
      preservedCategories.push(def.code);

      if (existing.name !== def.name) {
        preservedCustomNames.push({
          code: def.code,
          customName: existing.name,
          officialName: def.name,
        });
      }

      // 1. Checar incompatibilidade de classificação
      if (existing.classification !== def.classification) {
        structuralConflicts.push(
          `Incompatibilidade estrutural na categoria oficial ${def.code}: classificação no banco (${existing.classification}) difere da oficial (${def.classification}).`
        );
      }

      // 2. Checar root oficial que possui pai
      if (def.parentCode === null && existing.parentCategoryId !== null) {
        structuralConflicts.push(
          `Incompatibilidade estrutural na categoria oficial root ${def.code}: categoria possui pai (${existing.parentCategoryId}), mas deveria ser root.`
        );
      }

      // 3. Checar filha oficial com pai incorreto
      if (def.parentCode !== null) {
        const expectedParent = categoryByCode.get(def.parentCode);
        if (expectedParent && existing.parentCategoryId !== expectedParent.id) {
          structuralConflicts.push(
            `Incompatibilidade estrutural na categoria oficial ${def.code}: pai existente difere do pai oficial (${def.parentCode}).`
          );
        }
      }
    } else {
      missingCategories.push(def);
    }
  }

  // Análise dos Mappings
  const existingMappings = await tx.financialCategorySystemMapping.findMany({
    where: { barbershopId },
  });

  const existingMappingMap = new Map(existingMappings.map((m) => [m.systemKey, m.categoryId]));
  const missingMappings: OfficialSystemMappingDef[] = [];
  const preservedMappings: { systemKey: string; existingCategoryId: string; status: "PRESERVED_EXISTING_MAPPING" }[] = [];

  for (const mDef of OFFICIAL_SYSTEM_MAPPINGS) {
    if (existingMappingMap.has(mDef.systemKey)) {
      preservedMappings.push({
        systemKey: mDef.systemKey,
        existingCategoryId: existingMappingMap.get(mDef.systemKey)!,
        status: "PRESERVED_EXISTING_MAPPING",
      });
    } else {
      missingMappings.push(mDef);
    }
  }

  return {
    missingCategories,
    missingMappings,
    preservedCategories,
    preservedCustomNames,
    preservedMappings,
    structuralConflicts,
  };
}

/**
 * Cria ou garante o Plano Financeiro Padrão V1 e os Mappings de Sistema para um tenant.
 * Reutiliza a transação fornecida (tx) e é idempotente.
 */
export async function bootstrapFinancialPlan(
  tx: DbClient,
  barbershopId: string
): Promise<{ success: boolean; categoriesCreated: number; mappingsCreated: number }> {
  // Adquire o lock de categorias isolado por tenant explicitamente ANTES de analisar e escrever
  await lockFinancialCategoryTenant(tx, barbershopId);

  const analysis = await analyzeFinancialPlan(tx, barbershopId);

  if (analysis.structuralConflicts.length > 0) {
    throw new Error(analysis.structuralConflicts.join(" | "));
  }

  const existingCategories = await tx.financialCategory.findMany({
    where: { barbershopId },
  });

  const categoryByCode = new Map<string, FinancialCategory>(
    existingCategories.map((c) => [c.code, c])
  );

  let categoriesCreated = 0;
  let mappingsCreated = 0;

  for (const def of OFFICIAL_CATEGORIES) {
    if (!categoryByCode.has(def.code)) {
      let parentCategoryId: string | null = null;
      if (def.parentCode) {
        const parent = categoryByCode.get(def.parentCode);
        if (!parent) {
          throw new Error(`Categoria pai ${def.parentCode} não encontrada para ${def.code}.`);
        }
        parentCategoryId = parent.id;
      }

      const created = await tx.financialCategory.create({
        data: {
          barbershopId,
          code: def.code,
          name: def.name,
          classification: def.classification,
          parentCategoryId,
          isActive: true,
        },
      });

      categoryByCode.set(def.code, created);
      categoriesCreated += 1;
    }
  }

  for (const mDef of analysis.missingMappings) {
    const cat = categoryByCode.get(mDef.categoryCode);
    if (!cat) {
      throw new Error(
        `Categoria oficial ${mDef.categoryCode} não encontrada para o mapping ${mDef.systemKey}.`
      );
    }

    await tx.financialCategorySystemMapping.create({
      data: {
        barbershopId,
        systemKey: mDef.systemKey,
        categoryId: cat.id,
      },
    });

    mappingsCreated += 1;
  }

  return { success: true, categoriesCreated, mappingsCreated };
}
