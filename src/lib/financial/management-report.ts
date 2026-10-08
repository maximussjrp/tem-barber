import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import { todayIsoBR, localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";
import { listCategoriesTree, CategoryNode } from "./categories";
import {
  getFinancialTitlesForecast,
  getFinancialRoutinesForecast,
} from "./forecast";
import {
  FinancialCategoryClassification,
  FinancialEntryType,
  Prisma,
} from "@prisma/client";

// ============================================================================
// Errors
// ============================================================================

export class CategoryNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "Categoria não encontrada para esta barbearia.") {
    super(message);
    this.name = "CategoryNotFoundError";
  }
}

// ============================================================================
// Types & Contracts
// ============================================================================

export interface ManagementReportInput {
  barbershopId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  categoryId?: string | null;
}

export interface ManagementReportPeriodInfo {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  comparisonType: "CALENDAR_MONTH" | "CALENDAR_YEAR" | "CUSTOM_DAYS";
  today: string;
  timezone: string;
  basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST";
}

export interface ManagementReportRow {
  id: string;
  code: string;
  name: string;
  classification: FinancialCategoryClassification | "SPECIAL";
  depth: number;
  isLeaf: boolean;
  parentCategoryId: string | null;
  expected: string; // "1500.00"
  realized: string; // "1200.00"
  realizedPrevious: string; // "1000.00"
  avPercent: number | null; // ex: 80.0 ou null se receita == 0
  ahPercent: number | null; // ex: 20.0 ou null se anterior == 0
  children?: ManagementReportRow[];
}

export interface ManagementReportKPIs {
  revenueRealized: string;
  revenueExpected: string;
  variableCostRealized: string;
  variableCostExpected: string;
  marginRealized: string;
  marginExpected: string;
  marginAVPercent: number | null;
  marginAHPercent: number | null;
  fixedExpenseRealized: string;
  fixedExpenseExpected: string;
  resultBeforeInvestmentsRealized: string;
  resultBeforeInvestmentsExpected: string;
  investmentRealized: string;
  investmentExpected: string;
  operatingResultRealized: string;
  operatingResultExpected: string;
  operatingResultAVPercent: number | null;
  operatingResultAHPercent: number | null;
  nonOperatingInRealized: string;
  nonOperatingInExpected: string;
  nonOperatingOutRealized: string;
  nonOperatingOutExpected: string;
  netResultRealized: string;
  netResultExpected: string;
  netResultAVPercent: number | null;
  netResultAHPercent: number | null;
}

export interface OutsideResultItem {
  id: string;
  code: string;
  name: string;
  type: "TRANSFER" | "ADJUSTMENT" | "UNCLASSIFIED_ENTRY" | "ALLOCATION_RESIDUAL";
  realized: string;
  count: number;
}

export interface ManagementReportDataQuality {
  unclassifiedEntriesCount: number;
  unclassifiedEntriesAmount: string;
  allocationResidualsCount: number;
  allocationResidualsAmount: string;
  hasResidualsOrUnclassified: boolean;
}

export interface ManagementReport {
  period: ManagementReportPeriodInfo;
  kpis: ManagementReportKPIs;
  sections: {
    revenue: ManagementReportRow[];
    variableCost: ManagementReportRow[];
    fixedExpense: ManagementReportRow[];
    investment: ManagementReportRow[];
    nonOperatingIn: ManagementReportRow[];
    nonOperatingOut: ManagementReportRow[];
  };
  outsideResult: {
    transfers: OutsideResultItem[];
    adjustments: OutsideResultItem[];
    unclassified: OutsideResultItem[];
  };
  dataQuality: ManagementReportDataQuality;
}

// ============================================================================
// Helpers
// ============================================================================

export function isValidISODateString(str: unknown): str is string {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function formatCentsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function calculateDaysDifference(startStr: string, endStr: string): number {
  const [y1, m1, d1] = startStr.split("-").map(Number);
  const [y2, m2, d2] = endStr.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

export function calculateAV(rowRealizedCents: number, revenueRealizedCents: number): number | null {
  if (revenueRealizedCents === 0) return null;
  const val = (rowRealizedCents / revenueRealizedCents) * 100;
  return Math.round(val * 10) / 10;
}

export function calculateAH(currentCents: number, previousCents: number): number | null {
  if (previousCents === 0) return null;
  const val = ((currentCents - previousCents) / Math.abs(previousCents)) * 100;
  return Math.round(val * 10) / 10;
}

export function computePreviousPeriod(
  startDate: string,
  endDate: string
): { previousStartDate: string; previousEndDate: string; comparisonType: "CALENDAR_MONTH" | "CALENDAR_YEAR" | "CUSTOM_DAYS" } {
  const [sY, sM, sD] = startDate.split("-").map(Number);
  const [eY, eM, eD] = endDate.split("-").map(Number);

  // 1. Calendário Mensal completo: YYYY-MM-01 até o último dia do mesmo mês
  const lastDayOfMonth = new Date(Date.UTC(sY, sM, 0)).getUTCDate();
  if (sY === eY && sM === eM && sD === 1 && eD === lastDayOfMonth) {
    let pY = sY;
    let pM = sM - 1;
    if (pM === 0) {
      pM = 12;
      pY -= 1;
    }
    const pLastDay = new Date(Date.UTC(pY, pM, 0)).getUTCDate();
    const pStartStr = `${pY}-${String(pM).padStart(2, "0")}-01`;
    const pEndStr = `${pY}-${String(pM).padStart(2, "0")}-${String(pLastDay).padStart(2, "0")}`;
    return {
      previousStartDate: pStartStr,
      previousEndDate: pEndStr,
      comparisonType: "CALENDAR_MONTH",
    };
  }

  // 2. Calendário Anual completo: YYYY-01-01 até YYYY-12-31
  if (sY === eY && sM === 1 && sD === 1 && eM === 12 && eD === 31) {
    const pY = sY - 1;
    return {
      previousStartDate: `${pY}-01-01`,
      previousEndDate: `${pY}-12-31`,
      comparisonType: "CALENDAR_YEAR",
    };
  }

  // 3. Intervalo customizado de N dias: retrocede N dias a partir de shiftDateISO(startDate, -1)
  const days = calculateDaysDifference(startDate, endDate) + 1; // inclusive days count
  const pEndStr = shiftDateISO(startDate, -1);
  const pStartStr = shiftDateISO(pEndStr, -(days - 1));
  return {
    previousStartDate: pStartStr,
    previousEndDate: pEndStr,
    comparisonType: "CUSTOM_DAYS",
  };
}

// Tipos de entries excluídos por representarem passivos de terceiros / transações financeiras não econômicas
export const EXCLUDED_MANAGEMENT_REPORT_ENTRY_TYPES: FinancialEntryType[] = [
  FinancialEntryType.TIP_RECEIVED,
  FinancialEntryType.TIP_REFUND,
  FinancialEntryType.TIP_PAYOUT,
  FinancialEntryType.TIP_PAYOUT_REVERSAL,
  FinancialEntryType.CUSTOMER_CREDIT_DEPOSIT,
  FinancialEntryType.CUSTOMER_CREDIT_DEPOSIT_REFUND,
];

// ============================================================================
// Core Management Report Engine
// ============================================================================

export async function getManagementReport(
  input: ManagementReportInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ManagementReport> {
  const { barbershopId, startDate, endDate, categoryId } = input;

  if (!isValidISODateString(startDate)) {
    throw new Error("Formato de startDate inválido. Use YYYY-MM-DD.");
  }
  if (!isValidISODateString(endDate)) {
    throw new Error("Formato de endDate inválido. Use YYYY-MM-DD.");
  }
  if (endDate < startDate) {
    throw new Error("endDate não pode ser anterior a startDate.");
  }
  const daysDiff = calculateDaysDifference(startDate, endDate);
  if (daysDiff > 366) {
    throw new Error("Intervalo máximo permitido é de 366 dias.");
  }

  const today = todayIsoBR();
  const { previousStartDate, previousEndDate, comparisonType } = computePreviousPeriod(startDate, endDate);

  // Limites temporais UTC
  const currStartUTC = localDateToUTCBoundary(startDate);
  const currEndExclusiveUTC = localDateToUTCBoundary(shiftDateISO(endDate, 1));

  const prevStartUTC = localDateToUTCBoundary(previousStartDate);
  const prevEndExclusiveUTC = localDateToUTCBoundary(shiftDateISO(previousEndDate, 1));

  // --------------------------------------------------------------------------
  // 1. CARREGAR ÁRVORE DE CATEGORIAS DO TENANT
  // --------------------------------------------------------------------------
  const categoryTree = await listCategoriesTree(barbershopId, tx);

  // Mapear categorias planas para acesso rápido por ID e Code
  const flatCategoryMap = new Map<string, CategoryNode>();
  function flattenNodes(nodes: CategoryNode[]) {
    for (const n of nodes) {
      flatCategoryMap.set(n.id, n);
      if (n.children && n.children.length > 0) {
        flattenNodes(n.children);
      }
    }
  }
  flattenNodes(categoryTree);

  // Se houver categoryId, verificar se pertence ao tenant (404 / 400 amigável)
  if (categoryId && !flatCategoryMap.has(categoryId)) {
    throw new CategoryNotFoundError("Categoria não encontrada para esta barbearia.");
  }

  // Identificar quais categorias estão no escopo do filtro (se categoryId informado, inclui ele e seus descendentes)
  const scopedCategoryIds = new Set<string>();
  if (categoryId) {
    function addDescendants(node: CategoryNode) {
      scopedCategoryIds.add(node.id);
      for (const child of node.children) {
        addDescendants(child);
      }
    }
    const targetNode = flatCategoryMap.get(categoryId);
    if (targetNode) {
      addDescendants(targetNode);
    }
  }

  // --------------------------------------------------------------------------
  // 2. REALIZADO PERÍODO ATUAL: FinancialEntry & Allocations
  // --------------------------------------------------------------------------
  const currentEntries = await tx.financialEntry.findMany({
    where: {
      barbershopId,
      entryDate: {
        gte: currStartUTC,
        lt: currEndExclusiveUTC,
      },
      type: {
        notIn: EXCLUDED_MANAGEMENT_REPORT_ENTRY_TYPES,
      },
    },
    select: {
      id: true,
      amount: true,
      type: true,
      entryDate: true,
      description: true,
      allocations: {
        select: {
          allocatedAmount: true,
          financialCategoryId: true,
        },
      },
    },
  });

  // Mapas de centavos brutos com sinal preservado (id -> signed cents)
  const currRealizedByCat = new Map<string, number>();
  let currUnclassifiedCents = 0;
  let currUnclassifiedCount = 0;
  let currResidualCents = 0;
  let currResidualCount = 0;

  for (const entry of currentEntries) {
    const entryTotalCents = toCents(entry.amount);
    const allocs = entry.allocations;

    if (allocs.length === 0) {
      currUnclassifiedCount++;
      currUnclassifiedCents += entryTotalCents;
    } else {
      let sumAllocCents = 0;
      for (const a of allocs) {
        const catCents = toCents(a.allocatedAmount);
        sumAllocCents += catCents;

        if (categoryId && !scopedCategoryIds.has(a.financialCategoryId)) {
          continue;
        }

        const prev = currRealizedByCat.get(a.financialCategoryId) || 0;
        currRealizedByCat.set(a.financialCategoryId, prev + catCents);
      }

      const residual = entryTotalCents - sumAllocCents;
      if (residual !== 0) {
        currResidualCount++;
        currResidualCents += residual;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. REALIZADO PERÍODO ANTERIOR (Para Análise Horizontal)
  // --------------------------------------------------------------------------
  const prevEntries = await tx.financialEntry.findMany({
    where: {
      barbershopId,
      entryDate: {
        gte: prevStartUTC,
        lt: prevEndExclusiveUTC,
      },
      type: {
        notIn: EXCLUDED_MANAGEMENT_REPORT_ENTRY_TYPES,
      },
    },
    select: {
      id: true,
      amount: true,
      type: true,
      allocations: {
        select: {
          allocatedAmount: true,
          financialCategoryId: true,
        },
      },
    },
  });

  const prevRealizedByCat = new Map<string, number>();

  for (const entry of prevEntries) {
    const allocs = entry.allocations;
    if (allocs.length > 0) {
      for (const a of allocs) {
        if (categoryId && !scopedCategoryIds.has(a.financialCategoryId)) {
          continue;
        }
        const catCents = toCents(a.allocatedAmount);
        const prev = prevRealizedByCat.get(a.financialCategoryId) || 0;
        prevRealizedByCat.set(a.financialCategoryId, prev + catCents);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. PROJEÇÃO DATADA PARA O PERÍODO ATUAL (Via Forecast Engine Canônico)
  // --------------------------------------------------------------------------
  const titles = await getFinancialTitlesForecast(
    {
      barbershopId,
      startDate,
      endDate,
      today,
      categoryIds: scopedCategoryIds.size > 0 ? scopedCategoryIds : undefined,
    },
    tx
  );

  const currProjectedByCat = new Map<string, number>();

  for (const t of titles) {
    if (t.isInPeriod) {
      const prev = currProjectedByCat.get(t.categoryId) || 0;
      currProjectedByCat.set(t.categoryId, prev + t.outstandingCents);
    }
  }

  const routinesForecast = await getFinancialRoutinesForecast(
    {
      barbershopId,
      startDate,
      endDate,
      today,
      categoryIds: scopedCategoryIds.size > 0 ? scopedCategoryIds : undefined,
    },
    tx
  );

  for (const r of routinesForecast.items) {
    const prev = currProjectedByCat.get(r.categoryId) || 0;
    currProjectedByCat.set(r.categoryId, prev + r.amountCents);
  }

  // --------------------------------------------------------------------------
  // 5. CONSTRUÇÃO RECURSIVA DAS LINHAS E SEÇÕES (Com Preservação de Sinal)
  // --------------------------------------------------------------------------
  interface AggregatedNode {
    id: string;
    code: string;
    name: string;
    classification: FinancialCategoryClassification;
    depth: number;
    isLeaf: boolean;
    parentCategoryId: string | null;
    realizedCents: number;
    realizedPreviousCents: number;
    projectedCents: number;
    expectedCents: number;
    children: AggregatedNode[];
  }

  function aggregateNode(node: CategoryNode): AggregatedNode {
    const childAggs = (node.children || []).map(aggregateNode);

    let realizedCents = 0;
    let realizedPreviousCents = 0;
    let projectedCents = 0;

    if (node.isLeaf) {
      // Preservar e somar o sinal econômico canônico das allocations primeiro
      const rawRealized = currRealizedByCat.get(node.id) || 0;
      const rawPrev = prevRealizedByCat.get(node.id) || 0;

      // Normalizar representação por classificação
      switch (node.classification) {
        case FinancialCategoryClassification.REVENUE:
        case FinancialCategoryClassification.NON_OPERATING_IN:
          // Entradas: direção positiva natural (reembolsos/estornos com sinal negativo reduzem a receita)
          realizedCents = rawRealized;
          realizedPreviousCents = rawPrev;
          break;

        case FinancialCategoryClassification.VARIABLE_COST:
        case FinancialCategoryClassification.FIXED_EXPENSE:
        case FinancialCategoryClassification.INVESTMENT:
        case FinancialCategoryClassification.NON_OPERATING_OUT:
          // Saídas: no ledger canônico pagamentos são negativos; no relatório gerencial são representados como custos/despesas positivos
          // Reversões de custos/despesas (positivas no ledger) reduzem o custo do grupo
          realizedCents = -rawRealized;
          realizedPreviousCents = -rawPrev;
          break;

        case FinancialCategoryClassification.TRANSFER:
        case FinancialCategoryClassification.ADJUSTMENT:
        default:
          realizedCents = rawRealized;
          realizedPreviousCents = rawPrev;
          break;
      }

      projectedCents = currProjectedByCat.get(node.id) || 0;
    } else {
      // Se for nó sintético/pai, soma estritamente dos filhos já normalizados
      for (const c of childAggs) {
        realizedCents += c.realizedCents;
        realizedPreviousCents += c.realizedPreviousCents;
        projectedCents += c.projectedCents;
      }
    }

    const expectedCents = realizedCents + projectedCents;

    return {
      id: node.id,
      code: node.code,
      name: node.name,
      classification: node.classification,
      depth: node.depth,
      isLeaf: node.isLeaf,
      parentCategoryId: node.parentCategoryId,
      realizedCents,
      realizedPreviousCents,
      projectedCents,
      expectedCents,
      children: childAggs,
    };
  }

  const aggregatedRoots = categoryTree.map(aggregateNode);

  let relevantRoots = aggregatedRoots;
  if (categoryId) {
    function findSubtree(nodes: AggregatedNode[]): AggregatedNode | null {
      for (const n of nodes) {
        if (n.id === categoryId) return n;
        const found = findSubtree(n.children);
        if (found) return found;
      }
      return null;
    }
    const foundSub = findSubtree(aggregatedRoots);
    relevantRoots = foundSub ? [foundSub] : [];
  }

  // --------------------------------------------------------------------------
  // 6. TOTALIZAÇÃO DOS MACRO-GRUPOS PARA KPIs E AV/AH
  // --------------------------------------------------------------------------
  function sumClassificationCents(cls: FinancialCategoryClassification): {
    realizedCents: number;
    realizedPreviousCents: number;
    expectedCents: number;
  } {
    let r = 0;
    let rp = 0;
    let exp = 0;
    for (const root of aggregatedRoots) {
      if (root.classification === cls) {
        r += root.realizedCents;
        rp += root.realizedPreviousCents;
        exp += root.expectedCents;
      }
    }
    return { realizedCents: r, realizedPreviousCents: rp, expectedCents: exp };
  }

  const revTotals = sumClassificationCents(FinancialCategoryClassification.REVENUE);
  const vcTotals = sumClassificationCents(FinancialCategoryClassification.VARIABLE_COST);
  const feTotals = sumClassificationCents(FinancialCategoryClassification.FIXED_EXPENSE);
  const invTotals = sumClassificationCents(FinancialCategoryClassification.INVESTMENT);
  const noInTotals = sumClassificationCents(FinancialCategoryClassification.NON_OPERATING_IN);
  const noOutTotals = sumClassificationCents(FinancialCategoryClassification.NON_OPERATING_OUT);

  const revenueBaseCents = revTotals.realizedCents;

  function toReportRow(node: AggregatedNode): ManagementReportRow {
    return {
      id: node.id,
      code: node.code,
      name: node.name,
      classification: node.classification,
      depth: node.depth,
      isLeaf: node.isLeaf,
      parentCategoryId: node.parentCategoryId,
      expected: formatCentsToString(node.expectedCents),
      realized: formatCentsToString(node.realizedCents),
      realizedPrevious: formatCentsToString(node.realizedPreviousCents),
      avPercent: calculateAV(node.realizedCents, revenueBaseCents),
      ahPercent: calculateAH(node.realizedCents, node.realizedPreviousCents),
      children: node.children.map(toReportRow),
    };
  }

  const revenueRows: ManagementReportRow[] = [];
  const vcRows: ManagementReportRow[] = [];
  const feRows: ManagementReportRow[] = [];
  const invRows: ManagementReportRow[] = [];
  const noInRows: ManagementReportRow[] = [];
  const noOutRows: ManagementReportRow[] = [];
  const transferRows: OutsideResultItem[] = [];
  const adjustmentRows: OutsideResultItem[] = [];

  for (const root of relevantRoots) {
    const row = toReportRow(root);
    switch (root.classification) {
      case FinancialCategoryClassification.REVENUE:
        revenueRows.push(row);
        break;
      case FinancialCategoryClassification.VARIABLE_COST:
        vcRows.push(row);
        break;
      case FinancialCategoryClassification.FIXED_EXPENSE:
        feRows.push(row);
        break;
      case FinancialCategoryClassification.INVESTMENT:
        invRows.push(row);
        break;
      case FinancialCategoryClassification.NON_OPERATING_IN:
        noInRows.push(row);
        break;
      case FinancialCategoryClassification.NON_OPERATING_OUT:
        noOutRows.push(row);
        break;
      case FinancialCategoryClassification.TRANSFER:
        transferRows.push({
          id: root.id,
          code: root.code,
          name: root.name,
          type: "TRANSFER",
          realized: formatCentsToString(root.realizedCents),
          count: 0,
        });
        break;
      case FinancialCategoryClassification.ADJUSTMENT:
        adjustmentRows.push({
          id: root.id,
          code: root.code,
          name: root.name,
          type: "ADJUSTMENT",
          realized: formatCentsToString(root.realizedCents),
          count: 0,
        });
        break;
    }
  }

  // --------------------------------------------------------------------------
  // 7. CÁLCULO DOS RESULTADOS INTERMEDIÁRIOS & FINAIS (KPIs)
  // --------------------------------------------------------------------------
  // Margem de Contribuição = Receita - Custo Variável
  const marginRealizedCents = revTotals.realizedCents - vcTotals.realizedCents;
  const marginExpectedCents = revTotals.expectedCents - vcTotals.expectedCents;
  const marginPrevCents = revTotals.realizedPreviousCents - vcTotals.realizedPreviousCents;

  // Resultado Antes dos Investimentos = Margem - Despesas Fixas
  const resBeforeInvRealizedCents = marginRealizedCents - feTotals.realizedCents;
  const resBeforeInvExpectedCents = marginExpectedCents - feTotals.expectedCents;

  // Resultado Operacional = Resultado Antes dos Investimentos - Investimentos
  const opResultRealizedCents = resBeforeInvRealizedCents - invTotals.realizedCents;
  const opResultExpectedCents = resBeforeInvExpectedCents - invTotals.expectedCents;
  const opResultPrevCents = (revTotals.realizedPreviousCents - vcTotals.realizedPreviousCents - feTotals.realizedPreviousCents) - invTotals.realizedPreviousCents;

  // Resultado Líquido = Resultado Operacional + Entradas Não Operacionais - Saídas Não Operacionais
  const netResultRealizedCents = opResultRealizedCents + noInTotals.realizedCents - noOutTotals.realizedCents;
  const netResultExpectedCents = opResultExpectedCents + noInTotals.expectedCents - noOutTotals.expectedCents;
  const netResultPrevCents = opResultPrevCents + noInTotals.realizedPreviousCents - noOutTotals.realizedPreviousCents;

  const kpis: ManagementReportKPIs = {
    revenueRealized: formatCentsToString(revTotals.realizedCents),
    revenueExpected: formatCentsToString(revTotals.expectedCents),
    variableCostRealized: formatCentsToString(vcTotals.realizedCents),
    variableCostExpected: formatCentsToString(vcTotals.expectedCents),
    marginRealized: formatCentsToString(marginRealizedCents),
    marginExpected: formatCentsToString(marginExpectedCents),
    marginAVPercent: calculateAV(marginRealizedCents, revenueBaseCents),
    marginAHPercent: calculateAH(marginRealizedCents, marginPrevCents),
    fixedExpenseRealized: formatCentsToString(feTotals.realizedCents),
    fixedExpenseExpected: formatCentsToString(feTotals.expectedCents),
    resultBeforeInvestmentsRealized: formatCentsToString(resBeforeInvRealizedCents),
    resultBeforeInvestmentsExpected: formatCentsToString(resBeforeInvExpectedCents),
    investmentRealized: formatCentsToString(invTotals.realizedCents),
    investmentExpected: formatCentsToString(invTotals.expectedCents),
    operatingResultRealized: formatCentsToString(opResultRealizedCents),
    operatingResultExpected: formatCentsToString(opResultExpectedCents),
    operatingResultAVPercent: calculateAV(opResultRealizedCents, revenueBaseCents),
    operatingResultAHPercent: calculateAH(opResultRealizedCents, opResultPrevCents),
    nonOperatingInRealized: formatCentsToString(noInTotals.realizedCents),
    nonOperatingInExpected: formatCentsToString(noInTotals.expectedCents),
    nonOperatingOutRealized: formatCentsToString(noOutTotals.realizedCents),
    nonOperatingOutExpected: formatCentsToString(noOutTotals.expectedCents),
    netResultRealized: formatCentsToString(netResultRealizedCents),
    netResultExpected: formatCentsToString(netResultExpectedCents),
    netResultAVPercent: calculateAV(netResultRealizedCents, revenueBaseCents),
    netResultAHPercent: calculateAH(netResultRealizedCents, netResultPrevCents),
  };

  // --------------------------------------------------------------------------
  // 8. FORA DA ESTRUTURA PRINCIPAL & QUALIDADE DE DADOS
  // --------------------------------------------------------------------------
  const unclassifiedItems: OutsideResultItem[] = [];

  if (currUnclassifiedCount > 0) {
    unclassifiedItems.push({
      id: "unclassified_entries",
      code: "99.01",
      name: "Lançamentos Não Categorizados",
      type: "UNCLASSIFIED_ENTRY",
      realized: formatCentsToString(currUnclassifiedCents),
      count: currUnclassifiedCount,
    });
  }

  if (currResidualCount > 0) {
    unclassifiedItems.push({
      id: "allocation_residuals",
      code: "99.02",
      name: "Resíduos de Rateio",
      type: "ALLOCATION_RESIDUAL",
      realized: formatCentsToString(currResidualCents),
      count: currResidualCount,
    });
  }

  const dataQuality: ManagementReportDataQuality = {
    unclassifiedEntriesCount: currUnclassifiedCount,
    unclassifiedEntriesAmount: formatCentsToString(currUnclassifiedCents),
    allocationResidualsCount: currResidualCount,
    allocationResidualsAmount: formatCentsToString(currResidualCents),
    hasResidualsOrUnclassified: currUnclassifiedCount > 0 || currResidualCount > 0,
  };

  return {
    period: {
      startDate,
      endDate,
      previousStartDate,
      previousEndDate,
      comparisonType,
      today,
      timezone: "America/Sao_Paulo",
      basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST",
    },
    kpis,
    sections: {
      revenue: revenueRows,
      variableCost: vcRows,
      fixedExpense: feRows,
      investment: invRows,
      nonOperatingIn: noInRows,
      nonOperatingOut: noOutRows,
    },
    outsideResult: {
      transfers: transferRows,
      adjustments: adjustmentRows,
      unclassified: unclassifiedItems,
    },
    dataQuality,
  };
}
