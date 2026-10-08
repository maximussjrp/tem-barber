import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import { todayIsoBR, localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";
import {
  getFinancialTitlesForecast,
  getFinancialRoutinesForecast,
  generateReferenceMonths,
} from "./forecast";
import { Prisma } from "@prisma/client";

export { generateReferenceMonths };

// ============================================================================
// Types & Contracts
// ============================================================================

export interface CashFlowPeriodInput {
  barbershopId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  categoryId?: string | null;
  direction?: "IN" | "OUT" | null;
}

export interface CashFlowPeriodInfo {
  startDate: string;
  endDate: string;
  today: string;
  timezone: string;
  basis: string;
}

export interface RealizedTotals {
  inflow: string;
  outflow: string;
  net: string;
}

export interface ProjectedTotals {
  receivable: string;
  payable: string;
  net: string;
  committed: string;
  estimated: string;
}

export interface OverdueTotals {
  receivable: string;
  payable: string;
  net: string;
}

export interface UndatedTotals {
  customerReceivables: string;
  commissionPayables: string;
  tipPayables: string;
  clubApprovedPayables: string;
}

export interface ForecastMeta {
  virtualRoutineCount: number;
  estimatedRoutineCount: number;
  unprojectableRoutineCount: number;
  allocationResidualCount: number;
}

export interface DailyCashFlowItem {
  date: string;
  realizedIn: string;
  realizedOut: string;
  realizedNet: string;
  projectedIn: string;
  projectedOut: string;
  projectedNet: string;
  expectedNetDelta: string;
}

export interface UpcomingCashFlowItem {
  id: string;
  source: "TITLE" | "ROUTINE_FORECAST";
  kind: "RECEIVABLE" | "PAYABLE";
  title: string;
  dueOn: string;
  amount: string;
  category: {
    id: string;
    code: string;
    name: string;
    classification: string;
  };
  confidence: "COMMITTED" | "ESTIMATED";
  isOverdue: boolean;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  code: string;
  name: string;
  classification: string;
  realizedIn: string;
  realizedOut: string;
  projectedIn: string;
  projectedOut: string;
}

export interface CashFlowReport {
  period: CashFlowPeriodInfo;
  realized: RealizedTotals;
  projected: ProjectedTotals;
  expectedPeriodNet: string;
  overdue: OverdueTotals;
  undated: UndatedTotals;
  forecastMeta: ForecastMeta;
  daily: DailyCashFlowItem[];
  upcoming: UpcomingCashFlowItem[];
  categoryBreakdown: CategoryBreakdownItem[];
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

export function getCivilDateBRFromDate(date: Date): string {
  // Converte timestamp UTC para data civil de Brasília (UTC-3)
  const br = new Date(date.getTime() - 3 * 3600 * 1000);
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, "0");
  const d = String(br.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Gera lista contínua de YYYY-MM-DD
export function generateDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  let curr = startStr;
  while (curr <= endStr) {
    dates.push(curr);
    curr = shiftDateISO(curr, 1);
  }
  return dates;
}

// ============================================================================
// Main Domain Query & Calculation Engine
// ============================================================================

export async function getCashFlowReport(
  input: CashFlowPeriodInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<CashFlowReport> {
  const { barbershopId, startDate, endDate, categoryId, direction } = input;

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

  // Limites temporais para queries em colunas timestamp com fuso de Brasília
  const periodStartUTC = localDateToUTCBoundary(startDate);
  const periodEndExclusiveUTC = localDateToUTCBoundary(shiftDateISO(endDate, 1));

  // Mapa diário para acumulação de centavos
  const dailyMap = new Map<
    string,
    {
      realizedInCents: number;
      realizedOutCents: number;
      projectedInCents: number;
      projectedOutCents: number;
    }
  >();

  const dateList = generateDateRange(startDate, endDate);
  for (const d of dateList) {
    dailyMap.set(d, {
      realizedInCents: 0,
      realizedOutCents: 0,
      projectedInCents: 0,
      projectedOutCents: 0,
    });
  }

  // Mapa de breakdown por categoria
  const categoryBreakdownMap = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      classification: string;
      realizedInCents: number;
      realizedOutCents: number;
      projectedInCents: number;
      projectedOutCents: number;
    }
  >();

  const UNCATEGORIZED_KEY = "__UNCATEGORIZED__";
  const UNCATEGORIZED_RESIDUAL_KEY = "__UNCATEGORIZED_RESIDUAL__";

  let allocationResidualCount = 0;

  // --------------------------------------------------------------------------
  // 1. REALIZADO: Payments de Comandas (External Cash Only)
  // --------------------------------------------------------------------------
  // Buscar payments pagos no período cujo método != CUSTOMER_CREDIT
  const payments = await tx.payment.findMany({
    where: {
      barbershopId,
      paidAt: {
        gte: periodStartUTC,
        lt: periodEndExclusiveUTC,
      },
      method: {
        not: "CUSTOMER_CREDIT",
      },
    },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      method: true,
    },
  });

  const paymentIds = payments.map((p) => p.id);

  // Buscar FinancialEntry correspondente a esses payments para obter allocations
  const paymentEntries = paymentIds.length > 0
    ? await tx.financialEntry.findMany({
        where: {
          barbershopId,
          type: {
            in: ["COMMAND_REVENUE", "REFUND"],
          },
          entryDate: {
            gte: periodStartUTC,
            lt: periodEndExclusiveUTC,
          },
        },
        select: {
          id: true,
          paymentId: true,
          allocations: {
            select: {
              allocatedAmount: true,
              financialCategory: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  classification: true,
                },
              },
            },
          },
        },
      })
    : [];

  // Mapear paymentId -> allocations
  const paymentAllocationsMap = new Map<
    string,
    Array<{
      allocatedAmountCents: number;
      financialCategory: {
        id: string;
        code: string;
        name: string;
        classification: string;
      };
    }>
  >();

  for (const pe of paymentEntries) {
    const pid = pe.paymentId;
    if (pid) {
      paymentAllocationsMap.set(
        pid,
        pe.allocations.map((a) => ({
          allocatedAmountCents: toCents(a.allocatedAmount),
          financialCategory: a.financialCategory,
        }))
      );
    }
  }

  // Processar cada Payment
  for (const pay of payments) {
    if (!pay.paidAt) continue;
    const civilDate = getCivilDateBRFromDate(pay.paidAt);
    const payCents = toCents(pay.amount);
    const isOut = payCents < 0;
    const absPayCents = Math.abs(payCents);

    const allocs = paymentAllocationsMap.get(pay.id) || [];
    const sumAllocCents = allocs.reduce((acc, a) => acc + Math.abs(a.allocatedAmountCents), 0);
    const residualCents = absPayCents - sumAllocCents;

    if (allocs.length > 0 && residualCents !== 0) {
      allocationResidualCount++;
    }

    // Se houver filtro por categoryId:
    if (categoryId) {
      const matchingAlloc = allocs.find((a) => a.financialCategory.id === categoryId);
      if (matchingAlloc) {
        const matchCents = Math.abs(matchingAlloc.allocatedAmountCents);
        if (isOut) {
          if (direction !== "IN") {
            const dayItem = dailyMap.get(civilDate);
            if (dayItem) dayItem.realizedOutCents += matchCents;
          }
        } else {
          if (direction !== "OUT") {
            const dayItem = dailyMap.get(civilDate);
            if (dayItem) dayItem.realizedInCents += matchCents;
          }
        }
      }
    } else {
      // Sem filtro de categoria: soma o valor integral do pagamento no dia/total
      if (isOut) {
        if (direction !== "IN") {
          const dayItem = dailyMap.get(civilDate);
          if (dayItem) dayItem.realizedOutCents += absPayCents;
        }
      } else {
        if (direction !== "OUT") {
          const dayItem = dailyMap.get(civilDate);
          if (dayItem) dayItem.realizedInCents += absPayCents;
        }
      }
    }

    // Breakdown por categoria
    // Se direction=IN, ignora saídas no breakdown realizado; se direction=OUT, ignora entradas
    const allowRealizedInBreakdown = isOut ? direction !== "IN" : direction !== "OUT";

    if (allowRealizedInBreakdown) {
      if (allocs.length > 0) {
        for (const a of allocs) {
          const cat = a.financialCategory;
          // Se categoryId estiver definido, breakdown deve incluir SOMENTE a categoria selecionada
          if (categoryId && cat.id !== categoryId) {
            continue;
          }
          const aCents = Math.abs(a.allocatedAmountCents);
          if (!categoryBreakdownMap.has(cat.id)) {
            categoryBreakdownMap.set(cat.id, {
              id: cat.id,
              code: cat.code,
              name: cat.name,
              classification: cat.classification,
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(cat.id)!;
          if (isOut) {
            b.realizedOutCents += aCents;
          } else {
            b.realizedInCents += aCents;
          }
        }

        // Sem categoryId: insere resíduo de rateio se residualCents > 0
        if (!categoryId && residualCents > 0) {
          if (!categoryBreakdownMap.has(UNCATEGORIZED_RESIDUAL_KEY)) {
            categoryBreakdownMap.set(UNCATEGORIZED_RESIDUAL_KEY, {
              id: UNCATEGORIZED_RESIDUAL_KEY,
              code: "99.99",
              name: "Resíduo de Rateio",
              classification: "ADJUSTMENT",
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(UNCATEGORIZED_RESIDUAL_KEY)!;
          if (isOut) {
            b.realizedOutCents += residualCents;
          } else {
            b.realizedInCents += residualCents;
          }
        }
      } else {
        // Sem allocation (uncategorized): somente inclui se NÃO houver filtro por categoryId
        if (!categoryId) {
          if (!categoryBreakdownMap.has(UNCATEGORIZED_KEY)) {
            categoryBreakdownMap.set(UNCATEGORIZED_KEY, {
              id: UNCATEGORIZED_KEY,
              code: "99",
              name: "Não categorizado",
              classification: "ADJUSTMENT",
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(UNCATEGORIZED_KEY)!;
          if (isOut) {
            b.realizedOutCents += absPayCents;
          } else {
            b.realizedInCents += absPayCents;
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. REALIZADO: Outros FinancialEntry (NÃO COMMAND_REVENUE e NÃO REFUND)
  // --------------------------------------------------------------------------
  const otherEntries = await tx.financialEntry.findMany({
    where: {
      barbershopId,
      entryDate: {
        gte: periodStartUTC,
        lt: periodEndExclusiveUTC,
      },
      type: {
        notIn: ["COMMAND_REVENUE", "REFUND"],
      },
    },
    select: {
      id: true,
      amount: true,
      entryDate: true,
      type: true,
      allocations: {
        select: {
          allocatedAmount: true,
          financialCategory: {
            select: {
              id: true,
              code: true,
              name: true,
              classification: true,
            },
          },
        },
      },
    },
  });

  for (const entry of otherEntries) {
    const civilDate = entry.entryDate ? getCivilDateBRFromDate(entry.entryDate) : startDate;
    const signedCents = toCents(entry.amount);
    const isOut = signedCents < 0;
    const absCents = Math.abs(signedCents);

    const allocs = entry.allocations.map((a) => ({
      allocatedAmountCents: toCents(a.allocatedAmount),
      financialCategory: a.financialCategory,
    }));
    const sumAllocCents = allocs.reduce((acc, a) => acc + Math.abs(a.allocatedAmountCents), 0);
    const residualCents = absCents - sumAllocCents;

    if (allocs.length > 0 && residualCents !== 0) {
      allocationResidualCount++;
    }

    if (categoryId) {
      const matchingAlloc = allocs.find((a) => a.financialCategory.id === categoryId);
      if (matchingAlloc) {
        const matchCents = Math.abs(matchingAlloc.allocatedAmountCents);
        if (isOut) {
          if (direction !== "IN") {
            const dayItem = dailyMap.get(civilDate);
            if (dayItem) dayItem.realizedOutCents += matchCents;
          }
        } else {
          if (direction !== "OUT") {
            const dayItem = dailyMap.get(civilDate);
            if (dayItem) dayItem.realizedInCents += matchCents;
          }
        }
      }
    } else {
      if (isOut) {
        if (direction !== "IN") {
          const dayItem = dailyMap.get(civilDate);
          if (dayItem) dayItem.realizedOutCents += absCents;
        }
      } else {
        if (direction !== "OUT") {
          const dayItem = dailyMap.get(civilDate);
          if (dayItem) dayItem.realizedInCents += absCents;
        }
      }
    }

    // Breakdown por categoria
    const allowRealizedInBreakdown = isOut ? direction !== "IN" : direction !== "OUT";

    if (allowRealizedInBreakdown) {
      if (allocs.length > 0) {
        for (const a of allocs) {
          const cat = a.financialCategory;
          // Se categoryId estiver definido, breakdown deve incluir SOMENTE a categoria selecionada
          if (categoryId && cat.id !== categoryId) {
            continue;
          }
          const aCents = Math.abs(a.allocatedAmountCents);
          if (!categoryBreakdownMap.has(cat.id)) {
            categoryBreakdownMap.set(cat.id, {
              id: cat.id,
              code: cat.code,
              name: cat.name,
              classification: cat.classification,
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(cat.id)!;
          if (isOut) {
            b.realizedOutCents += aCents;
          } else {
            b.realizedInCents += aCents;
          }
        }

        // Sem categoryId: insere resíduo de rateio se residualCents > 0
        if (!categoryId && residualCents > 0) {
          if (!categoryBreakdownMap.has(UNCATEGORIZED_RESIDUAL_KEY)) {
            categoryBreakdownMap.set(UNCATEGORIZED_RESIDUAL_KEY, {
              id: UNCATEGORIZED_RESIDUAL_KEY,
              code: "99.99",
              name: "Resíduo de Rateio",
              classification: "ADJUSTMENT",
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(UNCATEGORIZED_RESIDUAL_KEY)!;
          if (isOut) {
            b.realizedOutCents += residualCents;
          } else {
            b.realizedInCents += residualCents;
          }
        }
      } else {
        // Sem allocation (uncategorized): somente inclui se NÃO houver filtro por categoryId
        if (!categoryId) {
          if (!categoryBreakdownMap.has(UNCATEGORIZED_KEY)) {
            categoryBreakdownMap.set(UNCATEGORIZED_KEY, {
              id: UNCATEGORIZED_KEY,
              code: "99",
              name: "Não categorizado",
              classification: "ADJUSTMENT",
              realizedInCents: 0,
              realizedOutCents: 0,
              projectedInCents: 0,
              projectedOutCents: 0,
            });
          }
          const b = categoryBreakdownMap.get(UNCATEGORIZED_KEY)!;
          if (isOut) {
            b.realizedOutCents += absCents;
          } else {
            b.realizedInCents += absCents;
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. PREVISÃO & VENCIDOS: FinancialTitles (Canônico via Forecast Engine)
  // --------------------------------------------------------------------------
  const titles = await getFinancialTitlesForecast(
    {
      barbershopId,
      startDate,
      endDate,
      today,
      categoryId: categoryId || undefined,
      direction: direction || undefined,
    },
    tx
  );

  let overdueReceivableCents = 0;
  let overduePayableCents = 0;
  let committedProjectedCents = 0;

  const upcomingList: UpcomingCashFlowItem[] = [];

  for (const t of titles) {
    const isReceivable = t.kind === "RECEIVABLE";

    // Checar se é VENCIDO: dueOn < today
    if (t.isOverdue) {
      if (isReceivable) {
        overdueReceivableCents += t.outstandingCents;
      } else {
        overduePayableCents += t.outstandingCents;
      }
    }

    // Checar se cai no período visual/solicitado: startDate <= dueOn <= endDate
    if (t.isInPeriod) {
      committedProjectedCents += t.outstandingCents;
      const dayItem = dailyMap.get(t.dueOnStr);
      if (dayItem) {
        if (isReceivable) {
          dayItem.projectedInCents += t.outstandingCents;
        } else {
          dayItem.projectedOutCents += t.outstandingCents;
        }
      }

      // Breakdown por categoria
      const cat = t.category;
      if (!categoryBreakdownMap.has(cat.id)) {
        categoryBreakdownMap.set(cat.id, {
          id: cat.id,
          code: cat.code,
          name: cat.name,
          classification: cat.classification,
          realizedInCents: 0,
          realizedOutCents: 0,
          projectedInCents: 0,
          projectedOutCents: 0,
        });
      }
      const b = categoryBreakdownMap.get(cat.id)!;
      if (isReceivable) {
        b.projectedInCents += t.outstandingCents;
      } else {
        b.projectedOutCents += t.outstandingCents;
      }
    }

    // Apenas títulos que vencem a partir do máximo entre today e startDate (e até endDate) entram em upcoming
    if (t.isUpcoming) {
      upcomingList.push({
        id: t.id,
        source: "TITLE",
        kind: t.kind,
        title: t.title,
        dueOn: t.dueOnStr,
        amount: formatCentsToString(t.outstandingCents),
        category: t.category,
        confidence: "COMMITTED",
        isOverdue: false,
      });
    }
  }

  // --------------------------------------------------------------------------
  // 4. PREVISÃO VIRTUAL EM MEMÓRIA: FinancialRoutine (Recorrências Futuras via Forecast Engine)
  // --------------------------------------------------------------------------
  const routinesForecast = await getFinancialRoutinesForecast(
    {
      barbershopId,
      startDate,
      endDate,
      today,
      categoryId: categoryId || undefined,
      direction: direction || undefined,
    },
    tx
  );

  const virtualRoutineCount = routinesForecast.virtualRoutineCount;
  const estimatedRoutineCount = routinesForecast.estimatedRoutineCount;
  const unprojectableRoutineCount = routinesForecast.unprojectableRoutineCount;
  committedProjectedCents += routinesForecast.committedProjectedCents;
  const estimatedProjectedCents = routinesForecast.estimatedProjectedCents;

  for (const routine of routinesForecast.items) {
    const isReceivable = routine.kind === "RECEIVABLE";
    const dayItem = dailyMap.get(routine.dueOnStr);
    if (dayItem) {
      if (isReceivable) {
        dayItem.projectedInCents += routine.amountCents;
      } else {
        dayItem.projectedOutCents += routine.amountCents;
      }
    }

    // Category breakdown
    const cat = routine.category;
    if (!categoryBreakdownMap.has(cat.id)) {
      categoryBreakdownMap.set(cat.id, {
        id: cat.id,
        code: cat.code,
        name: cat.name,
        classification: cat.classification,
        realizedInCents: 0,
        realizedOutCents: 0,
        projectedInCents: 0,
        projectedOutCents: 0,
      });
    }
    const b = categoryBreakdownMap.get(cat.id)!;
    if (isReceivable) {
      b.projectedInCents += routine.amountCents;
    } else {
      b.projectedOutCents += routine.amountCents;
    }

    upcomingList.push({
      id: routine.id,
      source: "ROUTINE_FORECAST",
      kind: routine.kind,
      title: routine.title,
      dueOn: routine.dueOnStr,
      amount: formatCentsToString(routine.amountCents),
      category: routine.category,
      confidence: routine.confidence,
      isOverdue: false,
    });
  }

  // --------------------------------------------------------------------------
  // 5. OBRIGAÇÕES E RECEBÍVEIS SEM VENCIMENTO (UNDATED)
  // --------------------------------------------------------------------------
  // 12. Recebíveis de clientes: Comandas não canceladas com remainingTotal > 0
  const comandasWithDebt = await tx.comanda.findMany({
    where: {
      barbershopId,
      status: { not: "CANCELLED" },
      remainingTotal: { gt: 0 },
    },
    select: {
      remainingTotal: true,
    },
  });
  const customerReceivablesCents = comandasWithDebt.reduce(
    (acc, c) => acc + toCents(c.remainingTotal),
    0
  );

  // 13.1 Comissões: CommissionCycle OPEN com remainingBalance > 0
  const openCycles = await tx.commissionCycle.findMany({
    where: {
      barbershopId,
      status: "OPEN",
      remainingBalance: { gt: 0 },
    },
    select: {
      remainingBalance: true,
    },
  });
  const commissionPayablesCents = openCycles.reduce(
    (acc, cy) => acc + toCents(cy.remainingBalance),
    0
  );

  // 13.2 Gorjetas: TipEntry outstanding = amount - refunded - paidOut
  const tips = await tx.tipEntry.findMany({
    where: {
      barbershopId,
    },
    select: {
      amount: true,
      refundedAmount: true,
      paidOutAmount: true,
    },
  });
  const tipPayablesCents = tips.reduce((acc, t) => {
    const totalCents = toCents(t.amount);
    const refCents = toCents(t.refundedAmount);
    const paidCents = toCents(t.paidOutAmount);
    const outstanding = Math.max(0, totalCents - refCents - paidCents);
    return acc + outstanding;
  }, 0);

  // 13.3 Clube: ClubSettlementMember com settlement.status = APPROVED e paidAt IS NULL
  const clubMembers = await tx.clubSettlementMember.findMany({
    where: {
      settlement: {
        barbershopId,
        status: "APPROVED",
      },
      paidAt: null,
    },
    select: {
      amount: true,
    },
  });
  const clubApprovedPayablesCents = clubMembers.reduce(
    (acc, m) => acc + toCents(m.amount),
    0
  );

  // --------------------------------------------------------------------------
  // 6. TOTALIZAÇÕES E SÉRIE DIÁRIA
  // --------------------------------------------------------------------------
  let totalRealizedInCents = 0;
  let totalRealizedOutCents = 0;
  let totalProjectedInCents = 0;
  let totalProjectedOutCents = 0;

  const daily: DailyCashFlowItem[] = [];

  for (const dateStr of dateList) {
    const item = dailyMap.get(dateStr)!;
    const rIn = item.realizedInCents;
    const rOut = item.realizedOutCents;
    const rNet = rIn - rOut;

    const pIn = item.projectedInCents;
    const pOut = item.projectedOutCents;
    const pNet = pIn - pOut;

    const expDelta = rNet + pNet;

    totalRealizedInCents += rIn;
    totalRealizedOutCents += rOut;
    totalProjectedInCents += pIn;
    totalProjectedOutCents += pOut;

    daily.push({
      date: dateStr,
      realizedIn: formatCentsToString(rIn),
      realizedOut: formatCentsToString(rOut),
      realizedNet: formatCentsToString(rNet),
      projectedIn: formatCentsToString(pIn),
      projectedOut: formatCentsToString(pOut),
      projectedNet: formatCentsToString(pNet),
      expectedNetDelta: formatCentsToString(expDelta),
    });
  }

  const realizedNetCents = totalRealizedInCents - totalRealizedOutCents;
  const projectedNetCents = totalProjectedInCents - totalProjectedOutCents;
  const expectedPeriodNetCents = realizedNetCents + projectedNetCents;

  const overdueNetCents = overdueReceivableCents - overduePayableCents;

  // Ordenar upcoming: dueOn ASC, id ASC
  upcomingList.sort((a, b) => {
    if (a.dueOn !== b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    return a.id.localeCompare(b.id);
  });

  const trimmedUpcoming = upcomingList.slice(0, 20);

  // Ordenar CategoryBreakdown por code ASC
  const categoryBreakdown: CategoryBreakdownItem[] = Array.from(
    categoryBreakdownMap.values()
  )
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((b) => ({
      categoryId: b.id,
      code: b.code,
      name: b.name,
      classification: b.classification,
      realizedIn: formatCentsToString(b.realizedInCents),
      realizedOut: formatCentsToString(b.realizedOutCents),
      projectedIn: formatCentsToString(b.projectedInCents),
      projectedOut: formatCentsToString(b.projectedOutCents),
    }));

  return {
    period: {
      startDate,
      endDate,
      today,
      timezone: "America/Sao_Paulo",
      basis: "OPERATIONAL_CASH_FLOW",
    },
    realized: {
      inflow: formatCentsToString(totalRealizedInCents),
      outflow: formatCentsToString(totalRealizedOutCents),
      net: formatCentsToString(realizedNetCents),
    },
    projected: {
      receivable: formatCentsToString(totalProjectedInCents),
      payable: formatCentsToString(totalProjectedOutCents),
      net: formatCentsToString(projectedNetCents),
      committed: formatCentsToString(committedProjectedCents),
      estimated: formatCentsToString(estimatedProjectedCents),
    },
    expectedPeriodNet: formatCentsToString(expectedPeriodNetCents),
    overdue: {
      receivable: formatCentsToString(overdueReceivableCents),
      payable: formatCentsToString(overduePayableCents),
      net: formatCentsToString(overdueNetCents),
    },
    undated: {
      customerReceivables: formatCentsToString(customerReceivablesCents),
      commissionPayables: formatCentsToString(commissionPayablesCents),
      tipPayables: formatCentsToString(tipPayablesCents),
      clubApprovedPayables: formatCentsToString(clubApprovedPayablesCents),
    },
    forecastMeta: {
      virtualRoutineCount,
      estimatedRoutineCount,
      unprojectableRoutineCount,
      allocationResidualCount,
    },
    daily,
    upcoming: trimmedUpcoming,
    categoryBreakdown,
  };
}
