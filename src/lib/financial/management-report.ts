import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import {
  todayIsoBR,
  localDateToUTCBoundary,
  shiftDateISO,
  formatTimestampToCivilDateBR,
} from "@/lib/time-utils";
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

    const rawRealized = currRealizedByCat.get(node.id) || 0;
    const rawPrev = prevRealizedByCat.get(node.id) || 0;

    let realizedCents: number;
    let realizedPreviousCents: number;

    // Normalizar primeiro o valor direto do próprio nó. Isso preserva dados
    // legados alocados em pais sem contá-los novamente ao agregar os filhos.
    switch (node.classification) {
      case FinancialCategoryClassification.REVENUE:
      case FinancialCategoryClassification.NON_OPERATING_IN:
        realizedCents = rawRealized;
        realizedPreviousCents = rawPrev;
        break;

      case FinancialCategoryClassification.VARIABLE_COST:
      case FinancialCategoryClassification.FIXED_EXPENSE:
      case FinancialCategoryClassification.INVESTMENT:
      case FinancialCategoryClassification.NON_OPERATING_OUT:
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

    let projectedCents = currProjectedByCat.get(node.id) || 0;

    for (const c of childAggs) {
      realizedCents += c.realizedCents;
      realizedPreviousCents += c.realizedPreviousCents;
      projectedCents += c.projectedCents;
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

// ============================================================================
// Monthly Comparative Management Report (Bloco A)
// ============================================================================

export interface MonthWindowItem {
  key: string; // YYYY-MM
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface MonthlyWindow {
  months: MonthWindowItem[];
  previousMonth: MonthWindowItem;
}

export function isValidYearMonth(str: unknown): str is string {
  if (typeof str !== "string" || !/^\d{4}-\d{2}$/.test(str)) return false;
  const [y, m] = str.split("-").map(Number);
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12;
}

export function shiftMonthKey(monthKey: string, offset: number): string {
  if (!isValidYearMonth(monthKey)) {
    throw new Error(`monthKey inválido: ${monthKey}`);
  }
  const [y, m] = monthKey.split("-").map(Number);
  // Converte para índice base 0: y * 12 + (m - 1)
  const totalMonths = y * 12 + (m - 1) + offset;
  const newY = Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}`;
}

export function monthKeyToDateRange(monthKey: string): { startDate: string; endDate: string } {
  if (!isValidYearMonth(monthKey)) {
    throw new Error(`monthKey inválido: ${monthKey}`);
  }
  const [y, m] = monthKey.split("-").map(Number);
  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  // Último dia do mês m no ano y (dia 0 do mês m+1 em UTC)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

export function generateMonthWindow(endMonth: string, count: number): MonthlyWindow {
  if (!isValidYearMonth(endMonth)) {
    throw new Error(`endMonth inválido: ${endMonth}`);
  }
  if (![3, 6, 12].includes(count)) {
    throw new Error(`count inválido: ${count}. Permitidos: 3, 6, 12.`);
  }

  const months: MonthWindowItem[] = [];
  // Gera em ordem cronológica crescente (ASC)
  for (let i = count - 1; i >= 0; i--) {
    const key = shiftMonthKey(endMonth, -i);
    const range = monthKeyToDateRange(key);
    months.push({ key, ...range });
  }

  // previousMonth é o mês imediatamente anterior à janela exibida (ou seja, anterior a months[0])
  const prevKey = shiftMonthKey(months[0].key, -1);
  const prevRange = monthKeyToDateRange(prevKey);
  const previousMonth: MonthWindowItem = {
    key: prevKey,
    ...prevRange,
  };

  return { months, previousMonth };
}

export interface MonthlyManagementCell {
  expected: string;
  realized: string;
  avPercent: number | null;
  ahPercent: number | null;
}

export interface MonthlyManagementReportRow {
  id: string;
  code: string;
  name: string;
  classification: FinancialCategoryClassification;
  depth: number;
  isLeaf: boolean;
  parentCategoryId: string | null;
  valuesByMonth: Record<string, MonthlyManagementCell>;
  children?: MonthlyManagementReportRow[];
}

export interface MonthlyManagementReportPeriodInfo {
  startMonth: string;
  endMonth: string;
  previousMonth: string;
  count: number;
  today: string;
  timezone: string;
  basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST";
}

export interface MonthlyManagementReportKPIs extends ManagementReportKPIs {
  resultBeforeInvestmentsAVPercent: number | null;
  resultBeforeInvestmentsAHPercent: number | null;
}

export interface MonthlyManagementReportInput {
  barbershopId: string;
  endMonth: string;
  count: number;
  categoryId?: string | null;
}

export interface MonthlyManagementReport {
  period: MonthlyManagementReportPeriodInfo;
  months: MonthWindowItem[];
  sections: {
    revenue: MonthlyManagementReportRow[];
    variableCost: MonthlyManagementReportRow[];
    fixedExpense: MonthlyManagementReportRow[];
    investment: MonthlyManagementReportRow[];
    nonOperatingIn: MonthlyManagementReportRow[];
    nonOperatingOut: MonthlyManagementReportRow[];
  };
  kpisByMonth: Record<string, MonthlyManagementReportKPIs>;
  dataQuality: ManagementReportDataQuality;
}

export async function getMonthlyManagementReport(
  input: MonthlyManagementReportInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<MonthlyManagementReport> {
  const { barbershopId, endMonth, count, categoryId } = input;

  const window = generateMonthWindow(endMonth, count);
  const displayedMonths = window.months;
  const previousMonth = window.previousMonth;
  const allMonths = [previousMonth, ...displayedMonths]; // [prev, m1, m2, ...]

  const today = todayIsoBR();

  // Limite total de busca no banco para FinancialEntry:
  // Desde o início do previousMonth (00:00 BRT) até o início do mês seguinte ao endMonth (00:00 BRT exclusivo)
  const fullStartDate = previousMonth.startDate;
  const fullEndDate = displayedMonths[displayedMonths.length - 1].endDate;

  const queryStartUTC = localDateToUTCBoundary(fullStartDate);
  const queryEndExclusiveUTC = localDateToUTCBoundary(shiftDateISO(fullEndDate, 1));

  // 1. CARREGAR ÁRVORE DE CATEGORIAS UMA VEZ
  const categoryTree = await listCategoriesTree(barbershopId, tx);

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

  if (categoryId && !flatCategoryMap.has(categoryId)) {
    throw new CategoryNotFoundError("Categoria não encontrada para esta barbearia.");
  }

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

  // 2. QUERY ÚNICA BATCH DE FINANCIALENTRY PARA TODA A JANELA (INCLUINDO PREVIOUSMONTH)
  const batchEntries = await tx.financialEntry.findMany({
    where: {
      barbershopId,
      entryDate: {
        gte: queryStartUTC,
        lt: queryEndExclusiveUTC,
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

  // Mapas por mês: monthKey -> (categoryId -> signed cents)
  const realizedByMonthAndCat = new Map<string, Map<string, number>>();
  for (const m of allMonths) {
    realizedByMonthAndCat.set(m.key, new Map<string, number>());
  }

  // Qualidade de dados calculada estritamente na janela exibida (ignora previousMonth)
  const displayedMonthKeys = new Set(displayedMonths.map((m) => m.key));
  let unclassifiedCount = 0;
  let unclassifiedCents = 0;
  let residualCount = 0;
  let residualCents = 0;

  for (const entry of batchEntries) {
    // IMPORTANTE: Bucketing civil de São Paulo para evitar shift UTC
    const civilDateBR = formatTimestampToCivilDateBR(entry.entryDate);
    const monthKey = civilDateBR.slice(0, 7);

    const monthMap = realizedByMonthAndCat.get(monthKey);
    if (!monthMap) {
      // Fora dos meses monitorados (caso de borda)
      continue;
    }

    const entryTotalCents = toCents(entry.amount);
    const allocs = entry.allocations;

    if (allocs.length === 0) {
      if (displayedMonthKeys.has(monthKey)) {
        unclassifiedCount++;
        unclassifiedCents += entryTotalCents;
      }
    } else {
      let sumAllocCents = 0;
      for (const a of allocs) {
        const catCents = toCents(a.allocatedAmount);
        sumAllocCents += catCents;

        if (categoryId && !scopedCategoryIds.has(a.financialCategoryId)) {
          continue;
        }

        const prev = monthMap.get(a.financialCategoryId) || 0;
        monthMap.set(a.financialCategoryId, prev + catCents);
      }

      const residual = entryTotalCents - sumAllocCents;
      if (residual !== 0 && displayedMonthKeys.has(monthKey)) {
        residualCount++;
        residualCents += residual;
      }
    }
  }

  // 3. FORECAST BATCH ÚNICO PARA A JANELA EXIBIDA
  // (Nota: previousMonth NÃO recebe forecast pois serve unicamente para o AH do primeiro mês)
  const windowStartDisplayed = displayedMonths[0].startDate;
  const windowEndDisplayed = displayedMonths[displayedMonths.length - 1].endDate;

  const titlesForecast = await getFinancialTitlesForecast(
    {
      barbershopId,
      startDate: windowStartDisplayed,
      endDate: windowEndDisplayed,
      today,
      categoryIds: scopedCategoryIds.size > 0 ? scopedCategoryIds : undefined,
    },
    tx
  );

  const projectedByMonthAndCat = new Map<string, Map<string, number>>();
  for (const m of displayedMonths) {
    projectedByMonthAndCat.set(m.key, new Map<string, number>());
  }

  for (const t of titlesForecast) {
    if (t.isInPeriod && t.dueOnStr) {
      const titleMonthKey = t.dueOnStr.slice(0, 7);
      const monthMap = projectedByMonthAndCat.get(titleMonthKey);
      if (monthMap) {
        const prev = monthMap.get(t.categoryId) || 0;
        monthMap.set(t.categoryId, prev + t.outstandingCents);
      }
    }
  }

  const routinesForecast = await getFinancialRoutinesForecast(
    {
      barbershopId,
      startDate: windowStartDisplayed,
      endDate: windowEndDisplayed,
      today,
      categoryIds: scopedCategoryIds.size > 0 ? scopedCategoryIds : undefined,
    },
    tx
  );

  for (const r of routinesForecast.items) {
    if (r.dueOnStr) {
      const routineMonthKey = r.dueOnStr.slice(0, 7);
      const monthMap = projectedByMonthAndCat.get(routineMonthKey);
      if (monthMap) {
        const prev = monthMap.get(r.categoryId) || 0;
        monthMap.set(r.categoryId, prev + r.amountCents);
      }
    }
  }

  // 4. AGREGAÇÃO HIERÁRQUICA MENSAL
  interface MonthlyAggregatedNode {
    id: string;
    code: string;
    name: string;
    classification: FinancialCategoryClassification;
    depth: number;
    isLeaf: boolean;
    parentCategoryId: string | null;
    // Valores acumulados por monthKey
    realizedCentsByMonth: Record<string, number>;
    projectedCentsByMonth: Record<string, number>;
    expectedCentsByMonth: Record<string, number>;
    children: MonthlyAggregatedNode[];
  }

  function aggregateMonthlyNode(node: CategoryNode): MonthlyAggregatedNode {
    const childAggs = (node.children || []).map(aggregateMonthlyNode);

    const realizedCentsByMonth: Record<string, number> = {};
    const projectedCentsByMonth: Record<string, number> = {};
    const expectedCentsByMonth: Record<string, number> = {};

    for (const m of allMonths) {
      realizedCentsByMonth[m.key] = 0;
      projectedCentsByMonth[m.key] = 0;
      expectedCentsByMonth[m.key] = 0;
    }

    // 1. Valores diretos do próprio nó (suporta tanto nó folha quanto nó pai com lançamentos diretos)
    for (const m of allMonths) {
      const rawRealized = realizedByMonthAndCat.get(m.key)?.get(node.id) || 0;

      let normRealized = 0;
      switch (node.classification) {
        case FinancialCategoryClassification.REVENUE:
        case FinancialCategoryClassification.NON_OPERATING_IN:
          normRealized = rawRealized;
          break;
        case FinancialCategoryClassification.VARIABLE_COST:
        case FinancialCategoryClassification.FIXED_EXPENSE:
        case FinancialCategoryClassification.INVESTMENT:
        case FinancialCategoryClassification.NON_OPERATING_OUT:
          normRealized = -rawRealized;
          break;
        case FinancialCategoryClassification.TRANSFER:
        case FinancialCategoryClassification.ADJUSTMENT:
        default:
          normRealized = rawRealized;
          break;
      }

      const proj = projectedByMonthAndCat.get(m.key)?.get(node.id) || 0;
      realizedCentsByMonth[m.key] = normRealized;
      projectedCentsByMonth[m.key] = proj;
      expectedCentsByMonth[m.key] = normRealized + proj;
    }

    // 2. Se possuir filhos, soma os valores dos filhos aos valores já acumulados
    if (childAggs.length > 0) {
      for (const c of childAggs) {
        for (const m of allMonths) {
          realizedCentsByMonth[m.key] += c.realizedCentsByMonth[m.key];
          projectedCentsByMonth[m.key] += c.projectedCentsByMonth[m.key];
          expectedCentsByMonth[m.key] += c.expectedCentsByMonth[m.key];
        }
      }
    }

    return {
      id: node.id,
      code: node.code,
      name: node.name,
      classification: node.classification,
      depth: node.depth,
      isLeaf: node.isLeaf,
      parentCategoryId: node.parentCategoryId,
      realizedCentsByMonth,
      projectedCentsByMonth,
      expectedCentsByMonth,
      children: childAggs,
    };
  }

  const aggregatedRoots = categoryTree.map(aggregateMonthlyNode);

  let relevantRoots = aggregatedRoots;
  if (categoryId) {
    function findSubtree(nodes: MonthlyAggregatedNode[]): MonthlyAggregatedNode | null {
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

  // 5. CÁLCULO DE KPIs PARA CADA MÊS (INCLUINDO PREVIOUSMONTH PARA AH)
  function sumMonthlyClassificationCents(
    cls: FinancialCategoryClassification,
    monthKey: string
  ): { realizedCents: number; expectedCents: number } {
    let r = 0;
    let exp = 0;
    for (const root of aggregatedRoots) {
      if (root.classification === cls) {
        r += root.realizedCentsByMonth[monthKey] || 0;
        exp += root.expectedCentsByMonth[monthKey] || 0;
      }
    }
    return { realizedCents: r, expectedCents: exp };
  }

  interface MonthIntermediateTotals {
    revenueRealized: number;
    revenueExpected: number;
    vcRealized: number;
    vcExpected: number;
    marginRealized: number;
    marginExpected: number;
    feRealized: number;
    feExpected: number;
    resBeforeInvRealized: number;
    resBeforeInvExpected: number;
    invRealized: number;
    invExpected: number;
    opResultRealized: number;
    opResultExpected: number;
    noInRealized: number;
    noInExpected: number;
    noOutRealized: number;
    noOutExpected: number;
    netResultRealized: number;
    netResultExpected: number;
  }

  const monthTotalsMap = new Map<string, MonthIntermediateTotals>();
  for (const m of allMonths) {
    const rev = sumMonthlyClassificationCents(FinancialCategoryClassification.REVENUE, m.key);
    const vc = sumMonthlyClassificationCents(FinancialCategoryClassification.VARIABLE_COST, m.key);
    const fe = sumMonthlyClassificationCents(FinancialCategoryClassification.FIXED_EXPENSE, m.key);
    const inv = sumMonthlyClassificationCents(FinancialCategoryClassification.INVESTMENT, m.key);
    const noIn = sumMonthlyClassificationCents(FinancialCategoryClassification.NON_OPERATING_IN, m.key);
    const noOut = sumMonthlyClassificationCents(FinancialCategoryClassification.NON_OPERATING_OUT, m.key);

    const marginRealized = rev.realizedCents - vc.realizedCents;
    const marginExpected = rev.expectedCents - vc.expectedCents;

    const resBeforeInvRealized = marginRealized - fe.realizedCents;
    const resBeforeInvExpected = marginExpected - fe.expectedCents;

    const opResultRealized = resBeforeInvRealized - inv.realizedCents;
    const opResultExpected = resBeforeInvExpected - inv.expectedCents;

    const netResultRealized = opResultRealized + noIn.realizedCents - noOut.realizedCents;
    const netResultExpected = opResultExpected + noIn.expectedCents - noOut.expectedCents;

    monthTotalsMap.set(m.key, {
      revenueRealized: rev.realizedCents,
      revenueExpected: rev.expectedCents,
      vcRealized: vc.realizedCents,
      vcExpected: vc.expectedCents,
      marginRealized,
      marginExpected,
      feRealized: fe.realizedCents,
      feExpected: fe.expectedCents,
      resBeforeInvRealized,
      resBeforeInvExpected,
      invRealized: inv.realizedCents,
      invExpected: inv.expectedCents,
      opResultRealized,
      opResultExpected,
      noInRealized: noIn.realizedCents,
      noInExpected: noIn.expectedCents,
      noOutRealized: noOut.realizedCents,
      noOutExpected: noOut.expectedCents,
      netResultRealized,
      netResultExpected,
    });
  }

  // KPIs dos meses exibidos
  const kpisByMonth: Record<string, MonthlyManagementReportKPIs> = {};
  for (let idx = 0; idx < displayedMonths.length; idx++) {
    const currKey = displayedMonths[idx].key;
    const prevKey = idx === 0 ? previousMonth.key : displayedMonths[idx - 1].key;

    const curr = monthTotalsMap.get(currKey)!;
    const prev = monthTotalsMap.get(prevKey)!;

    kpisByMonth[currKey] = {
      revenueRealized: formatCentsToString(curr.revenueRealized),
      revenueExpected: formatCentsToString(curr.revenueExpected),
      variableCostRealized: formatCentsToString(curr.vcRealized),
      variableCostExpected: formatCentsToString(curr.vcExpected),
      marginRealized: formatCentsToString(curr.marginRealized),
      marginExpected: formatCentsToString(curr.marginExpected),
      marginAVPercent: calculateAV(curr.marginRealized, curr.revenueRealized),
      marginAHPercent: calculateAH(curr.marginRealized, prev.marginRealized),
      fixedExpenseRealized: formatCentsToString(curr.feRealized),
      fixedExpenseExpected: formatCentsToString(curr.feExpected),
      resultBeforeInvestmentsRealized: formatCentsToString(curr.resBeforeInvRealized),
      resultBeforeInvestmentsExpected: formatCentsToString(curr.resBeforeInvExpected),
      resultBeforeInvestmentsAVPercent: calculateAV(
        curr.resBeforeInvRealized,
        curr.revenueRealized
      ),
      resultBeforeInvestmentsAHPercent: calculateAH(
        curr.resBeforeInvRealized,
        prev.resBeforeInvRealized
      ),
      investmentRealized: formatCentsToString(curr.invRealized),
      investmentExpected: formatCentsToString(curr.invExpected),
      operatingResultRealized: formatCentsToString(curr.opResultRealized),
      operatingResultExpected: formatCentsToString(curr.opResultExpected),
      operatingResultAVPercent: calculateAV(curr.opResultRealized, curr.revenueRealized),
      operatingResultAHPercent: calculateAH(curr.opResultRealized, prev.opResultRealized),
      nonOperatingInRealized: formatCentsToString(curr.noInRealized),
      nonOperatingInExpected: formatCentsToString(curr.noInExpected),
      nonOperatingOutRealized: formatCentsToString(curr.noOutRealized),
      nonOperatingOutExpected: formatCentsToString(curr.noOutExpected),
      netResultRealized: formatCentsToString(curr.netResultRealized),
      netResultExpected: formatCentsToString(curr.netResultExpected),
      netResultAVPercent: calculateAV(curr.netResultRealized, curr.revenueRealized),
      netResultAHPercent: calculateAH(curr.netResultRealized, prev.netResultRealized),
    };
  }

  // 6. SERIALIZAÇÃO DAS LINHAS COM VALORES POR MÊS
  function toMonthlyReportRow(node: MonthlyAggregatedNode): MonthlyManagementReportRow {
    const valuesByMonth: Record<string, MonthlyManagementCell> = {};

    for (let idx = 0; idx < displayedMonths.length; idx++) {
      const currKey = displayedMonths[idx].key;
      const prevKey = idx === 0 ? previousMonth.key : displayedMonths[idx - 1].key;

      const currRealized = node.realizedCentsByMonth[currKey] || 0;
      const currExpected = node.expectedCentsByMonth[currKey] || 0;
      const prevRealized = node.realizedCentsByMonth[prevKey] || 0;

      const monthRevBase = monthTotalsMap.get(currKey)?.revenueRealized || 0;

      valuesByMonth[currKey] = {
        expected: formatCentsToString(currExpected),
        realized: formatCentsToString(currRealized),
        avPercent: calculateAV(currRealized, monthRevBase),
        ahPercent: calculateAH(currRealized, prevRealized),
      };
    }

    return {
      id: node.id,
      code: node.code,
      name: node.name,
      classification: node.classification,
      depth: node.depth,
      isLeaf: node.isLeaf,
      parentCategoryId: node.parentCategoryId,
      valuesByMonth,
      children: node.children.map(toMonthlyReportRow),
    };
  }

  const revenueRows: MonthlyManagementReportRow[] = [];
  const vcRows: MonthlyManagementReportRow[] = [];
  const feRows: MonthlyManagementReportRow[] = [];
  const invRows: MonthlyManagementReportRow[] = [];
  const noInRows: MonthlyManagementReportRow[] = [];
  const noOutRows: MonthlyManagementReportRow[] = [];

  for (const root of relevantRoots) {
    const row = toMonthlyReportRow(root);
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
      case FinancialCategoryClassification.ADJUSTMENT:
        // Fora do resultado econômico principal, não incluído na tabela mensal
        break;
    }
  }

  const dataQuality: ManagementReportDataQuality = {
    unclassifiedEntriesCount: unclassifiedCount,
    unclassifiedEntriesAmount: formatCentsToString(unclassifiedCents),
    allocationResidualsCount: residualCount,
    allocationResidualsAmount: formatCentsToString(residualCents),
    hasResidualsOrUnclassified: unclassifiedCount > 0 || residualCount > 0,
  };

  return {
    period: {
      startMonth: displayedMonths[0].key,
      endMonth: displayedMonths[displayedMonths.length - 1].key,
      previousMonth: previousMonth.key,
      count,
      today,
      timezone: "America/Sao_Paulo",
      basis: "MANAGEMENT_REALIZED_PLUS_DATED_FORECAST",
    },
    months: displayedMonths,
    sections: {
      revenue: revenueRows,
      variableCost: vcRows,
      fixedExpense: feRows,
      investment: invRows,
      nonOperatingIn: noInRows,
      nonOperatingOut: noOutRows,
    },
    kpisByMonth,
    dataQuality,
  };
}
