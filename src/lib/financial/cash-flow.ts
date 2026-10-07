import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import { todayIsoBR, localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";
import { calculateRoutineDueOnCivil } from "./routines";
import { formatUTCToCivilDate } from "./titles";
import { Prisma } from "@prisma/client";

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

// Gera meses de referência YYYY-MM que cruzam o intervalo
export function generateReferenceMonths(startStr: string, endStr: string): string[] {
  const startMonth = startStr.slice(0, 7);
  const endMonth = endStr.slice(0, 7);
  const months: string[] = [];

  let [currY, currM] = startMonth.split("-").map(Number);
  const [endY, endM] = endMonth.split("-").map(Number);

  while (currY < endY || (currY === endY && currM <= endM)) {
    months.push(`${currY}-${String(currM).padStart(2, "0")}`);
    currM++;
    if (currM > 12) {
      currM = 1;
      currY++;
    }
  }

  return months;
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
  // 3. PREVISÃO & VENCIDOS: FinancialTitles (Canônico)
  // --------------------------------------------------------------------------
  // Buscar todos os títulos não cancelados da barbearia que possuem pendência
  // ou que caem no período.
  const titles = await tx.financialTitle.findMany({
    where: {
      barbershopId,
      cancelledAt: null,
      ...(categoryId ? { categoryId } : {}),
      ...(direction ? { kind: direction === "IN" ? "RECEIVABLE" : "PAYABLE" } : {}),
    },
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          classification: true,
        },
      },
      settlements: {
        where: {
          reversals: { none: {} }, // Ignora settlements estornados
        },
        select: {
          principalAmount: true,
        },
      },
    },
  });

  let overdueReceivableCents = 0;
  let overduePayableCents = 0;

  const upcomingList: UpcomingCashFlowItem[] = [];

  for (const t of titles) {
    const origCents = toCents(t.originalAmount);
    const settledCents = t.settlements.reduce(
      (acc, s) => acc + toCents(s.principalAmount),
      0
    );
    const outstandingCents = Math.max(0, origCents - settledCents);

    // Se estiver quitado (PAID), não projeta
    if (outstandingCents <= 0) continue;

    const dueOnStr = typeof t.dueOn === "string" ? t.dueOn : formatUTCToCivilDate(t.dueOn); // YYYY-MM-DD
    const isReceivable = t.kind === "RECEIVABLE";

    // Checar se é VENCIDO: dueOn < today
    if (dueOnStr < today) {
      if (isReceivable) {
        overdueReceivableCents += outstandingCents;
      } else {
        overduePayableCents += outstandingCents;
      }
    }

    // Checar se cai no período visual/solicitado: startDate <= dueOn <= endDate
    if (dueOnStr >= startDate && dueOnStr <= endDate) {
      const dayItem = dailyMap.get(dueOnStr);
      if (dayItem) {
        if (isReceivable) {
          dayItem.projectedInCents += outstandingCents;
        } else {
          dayItem.projectedOutCents += outstandingCents;
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
        b.projectedInCents += outstandingCents;
      } else {
        b.projectedOutCents += outstandingCents;
      }
    }

    // Se a data de vencimento for no futuro ou hoje ou vencer dentro do período, pode ser candidato a upcoming
    // Apenas títulos que vencem a partir do máximo entre today e startDate (e até endDate) entram em upcoming
    if (dueOnStr >= today && dueOnStr >= startDate && dueOnStr <= endDate) {
      upcomingList.push({
        id: t.id,
        source: "TITLE",
        kind: t.kind,
        title: t.title,
        dueOn: dueOnStr,
        amount: formatCentsToString(outstandingCents),
        category: t.category,
        confidence: "COMMITTED",
        isOverdue: false,
      });
    }
  }

  // --------------------------------------------------------------------------
  // 4. PREVISÃO VIRTUAL EM MEMÓRIA: FinancialRoutine (Recorrências Futuras)
  // --------------------------------------------------------------------------
  // Buscar rotinas ativas
  const activeRoutines = await tx.financialRoutine.findMany({
    where: {
      barbershopId,
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(direction ? { kind: direction === "IN" ? "RECEIVABLE" : "PAYABLE" } : {}),
    },
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          classification: true,
        },
      },
    },
  });

  // Para evitar duplicar títulos já materializados (inclusive CANCELLED), buscar todos os títulos que vieram de rotina
  const existingRoutineTitles = await tx.financialTitle.findMany({
    where: {
      barbershopId,
      routineId: { not: null },
      referenceMonth: { not: null },
    },
    select: {
      routineId: true,
      referenceMonth: true,
    },
  });

  const materializedRoutineMonthSet = new Set<string>();
  for (const et of existingRoutineTitles) {
    if (et.routineId && et.referenceMonth) {
      materializedRoutineMonthSet.add(`${et.routineId}:${et.referenceMonth}`);
    }
  }

  let virtualRoutineCount = 0;
  let estimatedRoutineCount = 0;
  let unprojectableRoutineCount = 0;

  let committedProjectedCents = 0;
  let estimatedProjectedCents = 0;

  // Somar títulos da seção 3 em committed
  for (const t of titles) {
    const origCents = toCents(t.originalAmount);
    const settledCents = t.settlements.reduce(
      (acc, s) => acc + toCents(s.principalAmount),
      0
    );
    const outstandingCents = Math.max(0, origCents - settledCents);
    const dueOnStr = typeof t.dueOn === "string" ? t.dueOn : formatUTCToCivilDate(t.dueOn);
    if (outstandingCents > 0 && dueOnStr >= startDate && dueOnStr <= endDate) {
      committedProjectedCents += outstandingCents;
    }
  }

  // Meses de referência cruzados com o período
  const periodMonths = generateReferenceMonths(startDate, endDate);

  for (const routine of activeRoutines) {
    for (const refMonth of periodMonths) {
      // 9.4 Não duplicar se já houver FinancialTitle para routineId + refMonth
      if (materializedRoutineMonthSet.has(`${routine.id}:${refMonth}`)) {
        continue;
      }

      // Calcular data civil calculada
      const dueOnStr = calculateRoutineDueOnCivil(refMonth, routine.dueDay);

      // 10. Recorrência histórica: virtual forecasts somente quando dueOn >= today
      if (dueOnStr < today) {
        continue;
      }

      // Validar limites de vigência da rotina (@db.Date preservando data civil)
      const routineStartStr = typeof routine.startDate === "string"
        ? routine.startDate
        : formatUTCToCivilDate(routine.startDate);
      const routineEndStr = routine.endDate
        ? typeof routine.endDate === "string"
          ? routine.endDate
          : formatUTCToCivilDate(routine.endDate)
        : null;

      if (dueOnStr < routineStartStr) {
        continue;
      }
      if (routineEndStr && dueOnStr > routineEndStr) {
        continue;
      }

      // Validar se dueOn está dentro do intervalo consultado [startDate, endDate]
      if (dueOnStr < startDate || dueOnStr > endDate) {
        continue;
      }

      // Tratar valor por modo: FIXED vs VARIABLE
      if (routine.amountMode === "VARIABLE" && !routine.baseAmount) {
        // 9.3 VARIABLE sem base: fail-closed, incrementa unprojectable
        unprojectableRoutineCount++;
        continue;
      }

      const projectedAmount = routine.baseAmount;
      if (!projectedAmount) continue;

      const routineCents = toCents(projectedAmount);
      if (routineCents <= 0) continue;

      const isVariable = routine.amountMode === "VARIABLE";
      const confidence = isVariable ? "ESTIMATED" : "COMMITTED";

      virtualRoutineCount++;
      if (isVariable) {
        estimatedRoutineCount++;
        estimatedProjectedCents += routineCents;
      } else {
        committedProjectedCents += routineCents;
      }

      const isReceivable = routine.kind === "RECEIVABLE";
      const dayItem = dailyMap.get(dueOnStr);
      if (dayItem) {
        if (isReceivable) {
          dayItem.projectedInCents += routineCents;
        } else {
          dayItem.projectedOutCents += routineCents;
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
        b.projectedInCents += routineCents;
      } else {
        b.projectedOutCents += routineCents;
      }

      upcomingList.push({
        id: `routine-virt-${routine.id}-${refMonth}`,
        source: "ROUTINE_FORECAST",
        kind: routine.kind,
        title: `${routine.title} (${refMonth})`,
        dueOn: dueOnStr,
        amount: formatCentsToString(routineCents),
        category: routine.category,
        confidence,
        isOverdue: false,
      });
    }
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
