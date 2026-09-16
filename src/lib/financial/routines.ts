import { FinancialTitleKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/operations/money";
import { todayIsoBR } from "@/lib/time-utils";
import { PAYABLE_CLASSIFICATIONS, RECEIVABLE_CLASSIFICATIONS } from "./titles";
import {
  CreateFinancialRoutineInput,
  FinancialRoutineGenerationResult,
  FinancialRoutineGenerationStatus,
  FinancialRoutineGenerationSummary,
  GenerateRoutineMonthInput,
  GenerateRoutineMonthOutput,
  UpdateFinancialRoutineInput,
} from "./types";

export class FinancialRoutineError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FinancialRoutineError";
    this.code = code;
    this.status = status;
  }
}

export function isValidReferenceMonth(ref: unknown): ref is string {
  return typeof ref === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(ref);
}

export function parseReferenceMonth(ref: string): { year: number; month: number } {
  if (!isValidReferenceMonth(ref)) {
    throw new FinancialRoutineError("INVALID_REFERENCE_MONTH", `Mês de referência inválido: ${ref}`, 400);
  }
  const [y, m] = ref.split("-").map(Number);
  return { year: y, month: m };
}

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

export function parseCivilDateToUTC(dateStr: string): Date {
  if (!isValidISODateString(dateStr)) {
    throw new FinancialRoutineError("INVALID_DATE", `Data civil inválida: ${dateStr}`, 400);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function formatUTCToCivilDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calculateRoutineDueOnCivil(referenceMonth: string, dueDay: number): string {
  const { year, month } = parseReferenceMonth(referenceMonth);
  const lastDay = getDaysInMonth(year, month);
  const clampedDay = Math.min(Math.max(1, dueDay), lastDay);
  const mStr = String(month).padStart(2, "0");
  const dStr = String(clampedDay).padStart(2, "0");
  return `${year}-${mStr}-${dStr}`;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function validateCategoryForRoutine(
  tx: DbClient,
  barbershopId: string,
  categoryId: string,
  kind: FinancialTitleKind
): Promise<{ valid: boolean; reason?: string }> {
  const category = await tx.financialCategory.findFirst({
    where: { id: categoryId, barbershopId },
  });

  if (!category) {
    return { valid: false, reason: "Categoria não encontrada para esta barbearia." };
  }

  if (!category.isActive) {
    return { valid: false, reason: "A categoria está inativa." };
  }

  const childCount = await tx.financialCategory.count({
    where: { barbershopId, parentCategoryId: categoryId },
  });

  if (childCount > 0) {
    return { valid: false, reason: "Apenas categorias folha (sem subcategorias) podem ser vinculadas." };
  }

  if (kind === "PAYABLE" && !PAYABLE_CLASSIFICATIONS.includes(category.classification)) {
    return { valid: false, reason: `Classificação ${category.classification} incompatível com título PAYABLE.` };
  }

  if (kind === "RECEIVABLE" && !RECEIVABLE_CLASSIFICATIONS.includes(category.classification)) {
    return { valid: false, reason: `Classificação ${category.classification} incompatível com título RECEIVABLE.` };
  }

  return { valid: true };
}

export async function createFinancialRoutine(input: CreateFinancialRoutineInput) {
  const {
    barbershopId,
    createdById,
    categoryId,
    title,
    kind,
    amountMode,
    baseAmount,
    frequency = "MONTHLY",
    dueDay,
    startDate,
    endDate,
    notes,
  } = input;

  if (frequency !== "MONTHLY") {
    throw new FinancialRoutineError("INVALID_FREQUENCY", "Fase 4 suporta apenas frequência MONTHLY.", 400);
  }

  const cleanTitle = title?.trim();
  if (!cleanTitle) {
    throw new FinancialRoutineError("INVALID_TITLE", "Título da rotina é obrigatório.", 400);
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new FinancialRoutineError("INVALID_DUE_DAY", "Dia de vencimento deve ser um inteiro entre 1 e 31.", 400);
  }

  if (!isValidISODateString(startDate)) {
    throw new FinancialRoutineError("INVALID_START_DATE", "Data inicial (startDate) inválida.", 400);
  }

  if (endDate !== undefined && endDate !== null) {
    if (!isValidISODateString(endDate)) {
      throw new FinancialRoutineError("INVALID_END_DATE", "Data final (endDate) inválida.", 400);
    }
    if (endDate < startDate) {
      throw new FinancialRoutineError("INVALID_DATE_RANGE", "Data final não pode ser anterior à data inicial.", 400);
    }
  }

  let resolvedBaseAmount: Prisma.Decimal | null = null;

  if (amountMode === "FIXED") {
    if (baseAmount === undefined || baseAmount === null || baseAmount === "") {
      throw new FinancialRoutineError("FIXED_AMOUNT_REQUIRED", "Rotinas com valor FIXO exigem um valor base (baseAmount).", 400);
    }
    const cents = toCents(baseAmount);
    if (cents <= 0) {
      throw new FinancialRoutineError("INVALID_BASE_AMOUNT", "Valor base deve ser maior que zero.", 400);
    }
    resolvedBaseAmount = new Prisma.Decimal(fromCents(cents));
  } else if (amountMode === "VARIABLE") {
    if (baseAmount !== undefined && baseAmount !== null && baseAmount !== "") {
      const cents = toCents(baseAmount);
      if (cents <= 0) {
        throw new FinancialRoutineError("INVALID_BASE_AMOUNT", "Valor base deve ser maior que zero se informado.", 400);
      }
      resolvedBaseAmount = new Prisma.Decimal(fromCents(cents));
    }
  }

  const catVal = await validateCategoryForRoutine(prisma, barbershopId, categoryId, kind);
  if (!catVal.valid) {
    throw new FinancialRoutineError("INVALID_CATEGORY", catVal.reason ?? "Categoria inválida.", 400);
  }

  return await prisma.financialRoutine.create({
    data: {
      barbershopId,
      createdById,
      categoryId,
      title: cleanTitle,
      kind,
      amountMode,
      baseAmount: resolvedBaseAmount,
      frequency: "MONTHLY",
      dueDay,
      startDate: parseCivilDateToUTC(startDate),
      endDate: endDate ? parseCivilDateToUTC(endDate) : null,
      notes: notes?.trim() || null,
      isActive: true,
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
}

export async function listFinancialRoutines(params: { barbershopId: string; isActive?: boolean }) {
  const { barbershopId, isActive } = params;

  const where: Prisma.FinancialRoutineWhereInput = {
    barbershopId,
  };

  if (typeof isActive === "boolean") {
    where.isActive = isActive;
  }

  const routines = await prisma.financialRoutine.findMany({
    where,
    orderBy: [
      { isActive: "desc" },
      { title: "asc" },
      { createdAt: "desc" },
    ],
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          classification: true,
        },
      },
      _count: {
        select: {
          titles: true,
        },
      },
    },
  });

  return routines.map((r) => ({
    ...r,
    startDateCivil: formatUTCToCivilDate(r.startDate),
    endDateCivil: r.endDate ? formatUTCToCivilDate(r.endDate) : null,
    baseAmount: r.baseAmount ? r.baseAmount.toString() : null,
    titleCount: r._count.titles,
  }));
}

export async function getFinancialRoutineById(params: { barbershopId: string; routineId: string }) {
  const { barbershopId, routineId } = params;

  const routine = await prisma.financialRoutine.findFirst({
    where: { id: routineId, barbershopId },
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          classification: true,
        },
      },
      _count: {
        select: {
          titles: true,
        },
      },
    },
  });

  if (!routine) {
    throw new FinancialRoutineError("NOT_FOUND", "Rotina não encontrada.", 404);
  }

  return {
    ...routine,
    startDateCivil: formatUTCToCivilDate(routine.startDate),
    endDateCivil: routine.endDate ? formatUTCToCivilDate(routine.endDate) : null,
    baseAmount: routine.baseAmount ? routine.baseAmount.toString() : null,
    titleCount: routine._count.titles,
  };
}

export async function updateFinancialRoutine(input: UpdateFinancialRoutineInput) {
  const { barbershopId, routineId, ...data } = input;

  return await prisma.$transaction(async (tx) => {
    // Parameterized row locking
    await tx.$executeRaw`SELECT 1 FROM financial_routines WHERE id = ${routineId} AND barbershop_id = ${barbershopId} FOR UPDATE;`;

    const existing = await tx.financialRoutine.findFirst({
      where: { id: routineId, barbershopId },
    });

    if (!existing) {
      throw new FinancialRoutineError("NOT_FOUND", "Rotina não encontrada.", 404);
    }

    if (data.kind !== undefined && data.kind !== existing.kind) {
      const generatedCount = await tx.financialTitle.count({
        where: { barbershopId, routineId },
      });
      if (generatedCount > 0) {
        throw new FinancialRoutineError(
          "KIND_IMMUTABLE",
          "O tipo (kind) da rotina não pode ser alterado após a geração de títulos.",
          400
        );
      }
    }

    const updatedKind = data.kind ?? existing.kind;
    const updatedCategoryId = data.categoryId ?? existing.categoryId;

    if (data.categoryId !== undefined || data.kind !== undefined) {
      const catVal = await validateCategoryForRoutine(tx, barbershopId, updatedCategoryId, updatedKind);
      if (!catVal.valid) {
        throw new FinancialRoutineError("INVALID_CATEGORY", catVal.reason ?? "Categoria inválida.", 400);
      }
    }

    if (data.title !== undefined) {
      const clean = data.title.trim();
      if (!clean) {
        throw new FinancialRoutineError("INVALID_TITLE", "Título não pode ser vazio.", 400);
      }
    }

    if (data.dueDay !== undefined) {
      if (!Number.isInteger(data.dueDay) || data.dueDay < 1 || data.dueDay > 31) {
        throw new FinancialRoutineError("INVALID_DUE_DAY", "Dia de vencimento deve ser um inteiro entre 1 e 31.", 400);
      }
    }

    const updatedStartDateCivil = data.startDate ?? formatUTCToCivilDate(existing.startDate);
    const updatedEndDateCivil = data.endDate !== undefined ? data.endDate : (existing.endDate ? formatUTCToCivilDate(existing.endDate) : null);

    if (!isValidISODateString(updatedStartDateCivil)) {
      throw new FinancialRoutineError("INVALID_START_DATE", "Data inicial inválida.", 400);
    }

    if (updatedEndDateCivil !== null) {
      if (!isValidISODateString(updatedEndDateCivil)) {
        throw new FinancialRoutineError("INVALID_END_DATE", "Data final inválida.", 400);
      }
      if (updatedEndDateCivil < updatedStartDateCivil) {
        throw new FinancialRoutineError("INVALID_DATE_RANGE", "Data final não pode ser anterior à data inicial.", 400);
      }
    }

    const updatedAmountMode = data.amountMode ?? existing.amountMode;
    let resolvedBaseAmount: Prisma.Decimal | null = existing.baseAmount;

    if (data.amountMode !== undefined || data.baseAmount !== undefined) {
      const newBaseAmount = data.baseAmount !== undefined ? data.baseAmount : existing.baseAmount;

      if (updatedAmountMode === "FIXED") {
        if (newBaseAmount === null || newBaseAmount === undefined || newBaseAmount === "") {
          throw new FinancialRoutineError("FIXED_AMOUNT_REQUIRED", "Rotinas FIXAS exigem um valor base (baseAmount).", 400);
        }
        const cents = toCents(newBaseAmount);
        if (cents <= 0) {
          throw new FinancialRoutineError("INVALID_BASE_AMOUNT", "Valor base deve ser maior que zero.", 400);
        }
        resolvedBaseAmount = new Prisma.Decimal(fromCents(cents));
      } else {
        if (newBaseAmount !== null && newBaseAmount !== undefined && newBaseAmount !== "") {
          const cents = toCents(newBaseAmount);
          if (cents <= 0) {
            throw new FinancialRoutineError("INVALID_BASE_AMOUNT", "Valor base deve ser maior que zero se informado.", 400);
          }
          resolvedBaseAmount = new Prisma.Decimal(fromCents(cents));
        } else {
          resolvedBaseAmount = null;
        }
      }
    }

    const updatePayload: Prisma.FinancialRoutineUpdateInput = {
      title: data.title !== undefined ? data.title.trim() : undefined,
      kind: updatedKind,
      amountMode: updatedAmountMode,
      baseAmount: resolvedBaseAmount,
      dueDay: data.dueDay !== undefined ? data.dueDay : undefined,
      startDate: parseCivilDateToUTC(updatedStartDateCivil),
      endDate: updatedEndDateCivil ? parseCivilDateToUTC(updatedEndDateCivil) : null,
      notes: data.notes !== undefined ? (data.notes?.trim() || null) : undefined,
      isActive: data.isActive !== undefined ? data.isActive : undefined,
    };

    if (data.categoryId !== undefined) {
      updatePayload.category = {
        connect: { id_barbershopId: { id: data.categoryId, barbershopId } },
      };
    }

    return await tx.financialRoutine.update({
      where: { id_barbershopId: { id: routineId, barbershopId } },
      data: updatePayload,
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
  });
}

export async function deactivateFinancialRoutine(params: { barbershopId: string; routineId: string }) {
  const { barbershopId, routineId } = params;

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM financial_routines WHERE id = ${routineId} AND barbershop_id = ${barbershopId} FOR UPDATE;`;

    const existing = await tx.financialRoutine.findFirst({
      where: { id: routineId, barbershopId },
    });

    if (!existing) {
      throw new FinancialRoutineError("NOT_FOUND", "Rotina não encontrada.", 404);
    }

    return await tx.financialRoutine.update({
      where: { id_barbershopId: { id: routineId, barbershopId } },
      data: { isActive: false },
    });
  });
}

export async function generateRoutineOccurrencesForMonth(
  input: GenerateRoutineMonthInput
): Promise<GenerateRoutineMonthOutput> {
  const { barbershopId, referenceMonth, source, actorUserId, amountOverrides = {}, routineId } = input;

  if (!isValidReferenceMonth(referenceMonth)) {
    throw new FinancialRoutineError("INVALID_REFERENCE_MONTH", `Mês de referência inválido: ${referenceMonth}`, 400);
  }

  // Pre-validate all amountOverrides
  const overrideEntries = Object.entries(amountOverrides);
  if (overrideEntries.length > 0) {
    const overrideRoutineIds = overrideEntries.map(([id]) => id);
    const matchedRoutines = await prisma.financialRoutine.findMany({
      where: {
        barbershopId,
        id: { in: overrideRoutineIds },
      },
      select: { id: true, amountMode: true },
    });

    if (matchedRoutines.length !== overrideRoutineIds.length) {
      throw new FinancialRoutineError("INVALID_OVERRIDE_ROUTINE", "Chave de override de valor inválida ou de outro estabelecimento.", 400);
    }

    for (const [rId, amtStr] of overrideEntries) {
      const routine = matchedRoutines.find((r) => r.id === rId)!;
      if (routine.amountMode === "FIXED") {
        throw new FinancialRoutineError(
          "FIXED_OVERRIDE_FORBIDDEN",
          "Overrides de valor não são permitidos para rotinas com valor FIXO.",
          400
        );
      }
      const cents = toCents(amtStr);
      if (cents <= 0) {
        throw new FinancialRoutineError("INVALID_OVERRIDE_AMOUNT", "Valor de override deve ser maior que zero.", 400);
      }
    }
  }

  const routineWhere: Prisma.FinancialRoutineWhereInput = {
    barbershopId,
  };
  if (routineId) {
    routineWhere.id = routineId;
  }

  const routines = await prisma.financialRoutine.findMany({
    where: routineWhere,
    orderBy: { createdAt: "asc" },
  });

  const results: FinancialRoutineGenerationResult[] = [];

  for (const routine of routines) {
    try {
      // Transaction per routine
      const result = await prisma.$transaction(async (tx) => {
        // Lock routine row
        await tx.$executeRaw`SELECT 1 FROM financial_routines WHERE id = ${routine.id} AND barbershop_id = ${barbershopId} FOR UPDATE;`;

        // Re-read routine state
        const currentRoutine = await tx.financialRoutine.findFirst({
          where: { id: routine.id, barbershopId },
        });

        if (!currentRoutine) {
          return {
            routineId: routine.id,
            routineTitle: routine.title,
            status: "FAILED" as FinancialRoutineGenerationStatus,
            reason: "Rotina não encontrada sob trava.",
          };
        }

        // Idempotency check: title already exists for routine + referenceMonth?
        const existingTitle = await tx.financialTitle.findFirst({
          where: { barbershopId, routineId: currentRoutine.id, referenceMonth },
        });

        if (existingTitle) {
          return {
            routineId: currentRoutine.id,
            routineTitle: currentRoutine.title,
            status: "REPLAYED" as FinancialRoutineGenerationStatus,
            titleId: existingTitle.id,
            reason: "Título já gerado anteriormente para este mês de referência.",
          };
        }

        if (!currentRoutine.isActive) {
          return {
            routineId: currentRoutine.id,
            routineTitle: currentRoutine.title,
            status: "SKIPPED_INACTIVE" as FinancialRoutineGenerationStatus,
            reason: "Rotina está desativada.",
          };
        }

        const dueOnCivil = calculateRoutineDueOnCivil(referenceMonth, currentRoutine.dueDay);
        const startDateCivil = formatUTCToCivilDate(currentRoutine.startDate);
        const endDateCivil = currentRoutine.endDate ? formatUTCToCivilDate(currentRoutine.endDate) : null;

        const isEligible =
          dueOnCivil >= startDateCivil &&
          (endDateCivil === null || dueOnCivil <= endDateCivil);

        if (!isEligible) {
          return {
            routineId: currentRoutine.id,
            routineTitle: currentRoutine.title,
            status: "SKIPPED_OUT_OF_PERIOD" as FinancialRoutineGenerationStatus,
            reason: `Data de vencimento (${dueOnCivil}) fora da vigência da rotina (${startDateCivil} a ${endDateCivil ?? "indefinido"}).`,
          };
        }

        const catVal = await validateCategoryForRoutine(
          tx,
          barbershopId,
          currentRoutine.categoryId,
          currentRoutine.kind
        );
        if (!catVal.valid) {
          return {
            routineId: currentRoutine.id,
            routineTitle: currentRoutine.title,
            status: "BLOCKED_CATEGORY_INVALID" as FinancialRoutineGenerationStatus,
            reason: catVal.reason ?? "Categoria inválida ou inativa.",
          };
        }

        let generationAmountCents = 0;

        if (currentRoutine.amountMode === "FIXED") {
          if (!currentRoutine.baseAmount) {
            return {
              routineId: currentRoutine.id,
              routineTitle: currentRoutine.title,
              status: "BLOCKED_AMOUNT_REQUIRED" as FinancialRoutineGenerationStatus,
              reason: "Rotina FIXA sem baseAmount.",
            };
          }
          generationAmountCents = toCents(currentRoutine.baseAmount.toString());
        } else {
          const overrideStr = amountOverrides[currentRoutine.id];
          if (overrideStr) {
            generationAmountCents = toCents(overrideStr);
          } else if (currentRoutine.baseAmount) {
            generationAmountCents = toCents(currentRoutine.baseAmount.toString());
          } else {
            return {
              routineId: currentRoutine.id,
              routineTitle: currentRoutine.title,
              status: "BLOCKED_AMOUNT_REQUIRED" as FinancialRoutineGenerationStatus,
              reason: "Rotina VARIÁVEL sem valor base estimado e sem override fornecido.",
            };
          }
        }

        if (generationAmountCents <= 0) {
          return {
            routineId: currentRoutine.id,
            routineTitle: currentRoutine.title,
            status: "BLOCKED_AMOUNT_REQUIRED" as FinancialRoutineGenerationStatus,
            reason: "Valor do título deve ser maior que zero.",
          };
        }

        const issuedOnCivil = todayIsoBR();
        const originalAmountDecimal = new Prisma.Decimal(fromCents(generationAmountCents));

        const title = await tx.financialTitle.create({
          data: {
            barbershopId,
            routineId: currentRoutine.id,
            categoryId: currentRoutine.categoryId,
            kind: currentRoutine.kind,
            title: currentRoutine.title,
            description: currentRoutine.notes,
            originalAmount: originalAmountDecimal,
            issuedOn: parseCivilDateToUTC(issuedOnCivil),
            dueOn: parseCivilDateToUTC(dueOnCivil),
            referenceMonth,
            createdById: currentRoutine.createdById,
          },
        });

        await tx.financialTitleEvent.create({
          data: {
            barbershopId,
            titleId: title.id,
            type: "CREATED",
            payload: {
              source,
              routineId: currentRoutine.id,
              referenceMonth,
            },
            actorUserId: actorUserId ?? null,
          },
        });

        return {
          routineId: currentRoutine.id,
          routineTitle: currentRoutine.title,
          status: "GENERATED" as FinancialRoutineGenerationStatus,
          titleId: title.id,
        };
      });

      results.push(result);
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.financialTitle.findFirst({
          where: { barbershopId, routineId: routine.id, referenceMonth },
        });
        if (existing) {
          results.push({
            routineId: routine.id,
            routineTitle: routine.title,
            status: "REPLAYED",
            titleId: existing.id,
            reason: "Título já gerado concorrentemente para este mês.",
          });
          continue;
        }
      }

      results.push({
        routineId: routine.id,
        routineTitle: routine.title,
        status: "FAILED",
        reason: err instanceof Error ? err.message : "Erro inesperado ao gerar ocorrência.",
      });
    }
  }

  const summary: FinancialRoutineGenerationSummary = {
    total: results.length,
    generated: results.filter((r) => r.status === "GENERATED").length,
    replayed: results.filter((r) => r.status === "REPLAYED").length,
    skipped: results.filter((r) => r.status.startsWith("SKIPPED")).length,
    blocked: results.filter((r) => r.status.startsWith("BLOCKED")).length,
    failed: results.filter((r) => r.status === "FAILED").length,
  };

  return {
    barbershopId,
    referenceMonth,
    results,
    summary,
  };
}
