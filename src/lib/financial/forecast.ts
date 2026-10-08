import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import { formatUTCToCivilDate } from "./titles";
import { calculateRoutineDueOnCivil } from "./routines";
import {
  FinancialCategoryClassification,
  FinancialTitleKind,
  Prisma,
} from "@prisma/client";

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

export interface TitleForecastFilterOptions {
  barbershopId: string;
  startDate: string;
  endDate: string;
  today: string;
  categoryId?: string;
  categoryIds?: Set<string>;
  direction?: "IN" | "OUT";
}

export interface ProjectedTitleItem {
  id: string;
  kind: FinancialTitleKind;
  title: string;
  dueOnStr: string; // YYYY-MM-DD civil
  originalAmountCents: number;
  settledAmountCents: number;
  outstandingCents: number;
  categoryId: string;
  category: {
    id: string;
    code: string;
    name: string;
    classification: FinancialCategoryClassification;
  };
  isOverdue: boolean; // dueOnStr < today
  isInPeriod: boolean; // dueOnStr >= startDate && dueOnStr <= endDate
  isUpcoming: boolean; // dueOnStr >= today && dueOnStr >= startDate && dueOnStr <= endDate
}

export interface RoutineForecastFilterOptions {
  barbershopId: string;
  startDate: string;
  endDate: string;
  today: string;
  categoryId?: string;
  categoryIds?: Set<string>;
  direction?: "IN" | "OUT";
}

export interface ProjectedRoutineItem {
  id: string; // routine-virt-${routine.id}-${refMonth}
  routineId: string;
  refMonth: string;
  kind: FinancialTitleKind;
  title: string; // ${routine.title} (${refMonth})
  dueOnStr: string; // YYYY-MM-DD civil
  amountCents: number;
  confidence: "COMMITTED" | "ESTIMATED";
  isVariable: boolean;
  categoryId: string;
  category: {
    id: string;
    code: string;
    name: string;
    classification: FinancialCategoryClassification;
  };
}

export interface RoutineForecastResult {
  items: ProjectedRoutineItem[];
  virtualRoutineCount: number;
  estimatedRoutineCount: number;
  unprojectableRoutineCount: number;
  committedProjectedCents: number;
  estimatedProjectedCents: number;
}

export function calculateTitleOutstandingCents(
  originalAmount: Prisma.Decimal | number | string,
  settlements: { principalAmount: Prisma.Decimal | number | string }[] = []
): { originalCents: number; settledCents: number; outstandingCents: number } {
  const originalCents = toCents(originalAmount);
  const settledCents = (settlements || []).reduce(
    (acc, s) => acc + toCents(s.principalAmount),
    0
  );
  const outstandingCents = Math.max(0, originalCents - settledCents);
  return { originalCents, settledCents, outstandingCents };
}

export async function getFinancialTitlesForecast(
  options: TitleForecastFilterOptions,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ProjectedTitleItem[]> {
  const { barbershopId, startDate, endDate, today, categoryId, categoryIds, direction } = options;

  let categoryCondition: Prisma.FinancialTitleWhereInput | undefined = undefined;
  if (categoryId) {
    categoryCondition = { categoryId };
  } else if (categoryIds && categoryIds.size > 0) {
    categoryCondition = { categoryId: { in: Array.from(categoryIds) } };
  }

  const titles = await tx.financialTitle.findMany({
    where: {
      barbershopId,
      cancelledAt: null,
      ...categoryCondition,
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
          reversals: { none: {} },
        },
        select: {
          principalAmount: true,
        },
      },
    },
  });

  const projectedItems: ProjectedTitleItem[] = [];

  for (const t of titles) {
    const { originalCents, settledCents, outstandingCents } = calculateTitleOutstandingCents(
      t.originalAmount,
      t.settlements
    );

    if (outstandingCents <= 0) continue;

    const dueOnStr = typeof t.dueOn === "string" ? t.dueOn : formatUTCToCivilDate(t.dueOn);
    const isOverdue = dueOnStr < today;
    const isInPeriod = dueOnStr >= startDate && dueOnStr <= endDate;
    const isUpcoming = dueOnStr >= today && dueOnStr >= startDate && dueOnStr <= endDate;

    projectedItems.push({
      id: t.id,
      kind: t.kind,
      title: t.title,
      dueOnStr,
      originalAmountCents: originalCents,
      settledAmountCents: settledCents,
      outstandingCents,
      categoryId: t.category.id,
      category: t.category,
      isOverdue,
      isInPeriod,
      isUpcoming,
    });
  }

  return projectedItems;
}

export async function getFinancialRoutinesForecast(
  options: RoutineForecastFilterOptions,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<RoutineForecastResult> {
  const { barbershopId, startDate, endDate, today, categoryId, categoryIds, direction } = options;

  let categoryCondition: Prisma.FinancialRoutineWhereInput | undefined = undefined;
  if (categoryId) {
    categoryCondition = { categoryId };
  } else if (categoryIds && categoryIds.size > 0) {
    categoryCondition = { categoryId: { in: Array.from(categoryIds) } };
  }

  const activeRoutines = await tx.financialRoutine.findMany({
    where: {
      barbershopId,
      isActive: true,
      ...categoryCondition,
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

  const periodMonths = generateReferenceMonths(startDate, endDate);
  const items: ProjectedRoutineItem[] = [];

  let virtualRoutineCount = 0;
  let estimatedRoutineCount = 0;
  let unprojectableRoutineCount = 0;
  let committedProjectedCents = 0;
  let estimatedProjectedCents = 0;

  for (const routine of activeRoutines) {
    for (const refMonth of periodMonths) {
      if (materializedRoutineMonthSet.has(`${routine.id}:${refMonth}`)) {
        continue;
      }

      const dueOnStr = calculateRoutineDueOnCivil(refMonth, routine.dueDay);

      if (dueOnStr < today) {
        continue;
      }

      const routineStartStr = typeof routine.startDate === "string"
        ? routine.startDate
        : formatUTCToCivilDate(routine.startDate);
      const routineEndStr = routine.endDate
        ? typeof routine.endDate === "string"
          ? routine.endDate
          : formatUTCToCivilDate(routine.endDate)
        : null;

      if (dueOnStr < routineStartStr) continue;
      if (routineEndStr && dueOnStr > routineEndStr) continue;
      if (dueOnStr < startDate || dueOnStr > endDate) continue;

      if (routine.amountMode === "VARIABLE" && !routine.baseAmount) {
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

      items.push({
        id: `routine-virt-${routine.id}-${refMonth}`,
        routineId: routine.id,
        refMonth,
        kind: routine.kind,
        title: `${routine.title} (${refMonth})`,
        dueOnStr,
        amountCents: routineCents,
        confidence,
        isVariable,
        categoryId: routine.category.id,
        category: routine.category,
      });
    }
  }

  return {
    items,
    virtualRoutineCount,
    estimatedRoutineCount,
    unprojectableRoutineCount,
    committedProjectedCents,
    estimatedProjectedCents,
  };
}
