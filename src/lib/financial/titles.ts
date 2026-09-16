import {
  FinancialCategoryClassification,
  FinancialTitleKind,
  Prisma,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, MoneyValue, positiveCents, toCents } from "@/lib/operations/money";
import { todayIsoBR } from "@/lib/time-utils";

export class FinancialTitleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "FinancialTitleError";
    this.code = code;
    this.status = status;
  }
}

export type FinancialDerivedStatus =
  | "CANCELLED"
  | "PAID"
  | "OVERDUE"
  | "PARTIAL"
  | "OPEN";

export const RECEIVABLE_CLASSIFICATIONS: FinancialCategoryClassification[] = [
  "REVENUE",
  "NON_OPERATING_IN",
];

export const PAYABLE_CLASSIFICATIONS: FinancialCategoryClassification[] = [
  "VARIABLE_COST",
  "FIXED_EXPENSE",
  "INVESTMENT",
  "NON_OPERATING_OUT",
];

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
    throw new FinancialTitleError("INVALID_DATE", `Data civil inválida: ${dateStr}`, 400);
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

export function calculateTitleDerivedStatus(params: {
  cancelledAt: Date | null;
  originalAmountCents: number;
  settledPrincipalCents: number;
  dueOnCivil: string;
  civilTodayCivil?: string;
}): {
  status: FinancialDerivedStatus;
  settledPrincipalCents: number;
  outstandingPrincipalCents: number;
} {
  const { cancelledAt, originalAmountCents, settledPrincipalCents, dueOnCivil } = params;
  const civilToday = params.civilTodayCivil ?? todayIsoBR();

  const outstandingPrincipalCents = Math.max(0, originalAmountCents - settledPrincipalCents);

  if (cancelledAt !== null) {
    return { status: "CANCELLED", settledPrincipalCents, outstandingPrincipalCents };
  }

  if (outstandingPrincipalCents === 0) {
    return { status: "PAID", settledPrincipalCents, outstandingPrincipalCents };
  }

  if (dueOnCivil < civilToday) {
    return { status: "OVERDUE", settledPrincipalCents, outstandingPrincipalCents };
  }

  if (settledPrincipalCents > 0) {
    return { status: "PARTIAL", settledPrincipalCents, outstandingPrincipalCents };
  }

  return { status: "OPEN", settledPrincipalCents, outstandingPrincipalCents };
}

export async function validateTitleCategory(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  categoryId: string,
  kind: FinancialTitleKind
): Promise<void> {
  const category = await tx.financialCategory.findFirst({
    where: { id: categoryId, barbershopId },
  });

  if (!category || !category.isActive) {
    throw new FinancialTitleError(
      "FINANCIAL_CATEGORY_INVALID",
      "Categoria financeira não encontrada ou inativa.",
      409
    );
  }

  const childCount = await tx.financialCategory.count({
    where: { barbershopId, parentCategoryId: category.id },
  });

  if (childCount > 0) {
    throw new FinancialTitleError(
      "FINANCIAL_CATEGORY_NOT_LEAF",
      "A categoria selecionada possui subcategorias e não é uma categoria folha.",
      409
    );
  }

  if (kind === "RECEIVABLE" && !RECEIVABLE_CLASSIFICATIONS.includes(category.classification)) {
    throw new FinancialTitleError(
      "FINANCIAL_CATEGORY_CLASSIFICATION_MISMATCH",
      `Título RECEIVABLE não permite categoria de classificação ${category.classification}.`,
      409
    );
  }

  if (kind === "PAYABLE" && !PAYABLE_CLASSIFICATIONS.includes(category.classification)) {
    throw new FinancialTitleError(
      "FINANCIAL_CATEGORY_CLASSIFICATION_MISMATCH",
      `Título PAYABLE não permite categoria de classificação ${category.classification}.`,
      409
    );
  }
}

export async function lockTitleRow(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  titleId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM financial_titles
    WHERE id = ${titleId} AND barbershop_id = ${barbershopId}
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new FinancialTitleError(
      "FINANCIAL_TITLE_NOT_FOUND",
      "Título financeiro não encontrado.",
      404
    );
  }
}

export interface CreateTitleInput {
  kind: unknown;
  categoryId: unknown;
  title: unknown;
  description?: unknown;
  originalAmount: unknown;
  issuedOn: unknown;
  dueOn: unknown;
}

export async function createTitle(
  barbershopId: string,
  createdById: string,
  input: CreateTitleInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (input.kind !== "PAYABLE" && input.kind !== "RECEIVABLE") {
    throw new FinancialTitleError(
      "INVALID_KIND",
      "kind deve ser PAYABLE ou RECEIVABLE.",
      400
    );
  }
  const kind = input.kind as FinancialTitleKind;

  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    throw new FinancialTitleError("INVALID_TITLE", "Título é obrigatório.", 400);
  }
  const cleanTitle = input.title.trim();

  let cleanDescription: string | null = null;
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") {
      throw new FinancialTitleError("INVALID_DESCRIPTION", "Descrição deve ser string.", 400);
    }
    const trimmed = input.description.trim();
    if (trimmed.length > 0) cleanDescription = trimmed;
  }

  if (typeof input.categoryId !== "string" || input.categoryId.trim().length === 0) {
    throw new FinancialTitleError("INVALID_CATEGORY_ID", "categoryId é obrigatório.", 400);
  }
  const categoryId = input.categoryId.trim();

  const originalAmountCents = positiveCents(input.originalAmount as MoneyValue, "Valor original");

  if (!isValidISODateString(input.issuedOn)) {
    throw new FinancialTitleError("INVALID_ISSUED_ON", "issuedOn deve ser YYYY-MM-DD válido.", 400);
  }
  if (!isValidISODateString(input.dueOn)) {
    throw new FinancialTitleError("INVALID_DUE_ON", "dueOn deve ser YYYY-MM-DD válido.", 400);
  }

  const issuedOnStr = input.issuedOn;
  const dueOnStr = input.dueOn;

  if (dueOnStr < issuedOnStr) {
    throw new FinancialTitleError(
      "INVALID_DUE_DATE",
      "Data de vencimento (dueOn) não pode ser anterior à data de emissão (issuedOn).",
      400
    );
  }

  const runTx = async (tx: Prisma.TransactionClient) => {
    await validateTitleCategory(tx, barbershopId, categoryId, kind);

    const titleRecord = await tx.financialTitle.create({
      data: {
        barbershopId,
        categoryId,
        kind,
        title: cleanTitle,
        description: cleanDescription,
        originalAmount: fromCents(originalAmountCents),
        issuedOn: parseCivilDateToUTC(issuedOnStr),
        dueOn: parseCivilDateToUTC(dueOnStr),
        createdById,
      },
    });

    await tx.financialTitleEvent.create({
      data: {
        barbershopId,
        titleId: titleRecord.id,
        type: "CREATED",
        payload: {
          kind,
          categoryId,
          originalAmount: fromCents(originalAmountCents).toFixed(2),
          issuedOn: issuedOnStr,
          dueOn: dueOnStr,
        },
        actorUserId: createdById,
      },
    });

    return titleRecord;
  };

  if ("$transaction" in client && typeof client.$transaction === "function") {
    return client.$transaction(runTx);
  }
  return runTx(client as Prisma.TransactionClient);
}

export interface UpdateTitleInput {
  title?: unknown;
  description?: unknown;
  categoryId?: unknown;
  originalAmount?: unknown;
  issuedOn?: unknown;
  dueOn?: unknown;
  kind?: unknown;
}

export async function updateTitle(
  barbershopId: string,
  titleId: string,
  actorUserId: string,
  input: UpdateTitleInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (input.kind !== undefined) {
    throw new FinancialTitleError("KIND_IMMUTABLE", "O tipo do título (kind) é imutável.", 409);
  }

  const runTx = async (tx: Prisma.TransactionClient) => {
    await lockTitleRow(tx, barbershopId, titleId);

    const titleRecord = await tx.financialTitle.findFirst({
      where: { id: titleId, barbershopId },
      include: {
        settlements: {
          include: {
            reversals: true,
          },
        },
      },
    });

    if (!titleRecord) {
      throw new FinancialTitleError("FINANCIAL_TITLE_NOT_FOUND", "Título não encontrado.", 404);
    }

    const totalHistoryCount = titleRecord.settlements.length;
    const activeSettlements = titleRecord.settlements.filter((s) => s.reversals.length === 0);
    const settledCents = activeSettlements.reduce(
      (sum, s) => sum + toCents(s.principalAmount),
      0
    );
    const originalCents = toCents(titleRecord.originalAmount);
    const dueOnCivil = formatUTCToCivilDate(titleRecord.dueOn);

    const derived = calculateTitleDerivedStatus({
      cancelledAt: titleRecord.cancelledAt,
      originalAmountCents: originalCents,
      settledPrincipalCents: settledCents,
      dueOnCivil,
    });

    if (derived.status === "PAID") {
      throw new FinancialTitleError("TITLE_PAID", "Título quitado não pode ser alterado.", 409);
    }
    if (derived.status === "CANCELLED") {
      throw new FinancialTitleError("TITLE_CANCELLED", "Título cancelado não pode ser alterado.", 409);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const dataToUpdate: Prisma.FinancialTitleUpdateInput = {};

    if (totalHistoryCount > 0) {
      if (input.categoryId !== undefined && input.categoryId !== titleRecord.categoryId) {
        throw new FinancialTitleError(
          "TITLE_HAS_SETTLEMENT_HISTORY",
          "Categoria não pode ser alterada após histórico de liquidações.",
          409
        );
      }
      if (
        input.originalAmount !== undefined &&
        toCents(input.originalAmount as MoneyValue) !== originalCents
      ) {
        throw new FinancialTitleError(
          "TITLE_HAS_SETTLEMENT_HISTORY",
          "Valor original não pode ser alterado após histórico de liquidações.",
          409
        );
      }
      if (
        input.issuedOn !== undefined &&
        input.issuedOn !== formatUTCToCivilDate(titleRecord.issuedOn)
      ) {
        throw new FinancialTitleError(
          "TITLE_HAS_SETTLEMENT_HISTORY",
          "Data de emissão não pode ser alterada após histórico de liquidações.",
          409
        );
      }
    }

    let finalIssuedOnStr = formatUTCToCivilDate(titleRecord.issuedOn);
    let finalDueOnStr = dueOnCivil;

    if (input.issuedOn !== undefined) {
      if (!isValidISODateString(input.issuedOn)) {
        throw new FinancialTitleError("INVALID_ISSUED_ON", "issuedOn deve ser YYYY-MM-DD válido.", 400);
      }
      finalIssuedOnStr = input.issuedOn;
    }

    if (input.dueOn !== undefined) {
      if (!isValidISODateString(input.dueOn)) {
        throw new FinancialTitleError("INVALID_DUE_ON", "dueOn deve ser YYYY-MM-DD válido.", 400);
      }
      finalDueOnStr = input.dueOn;
    }

    if (finalDueOnStr < finalIssuedOnStr) {
      throw new FinancialTitleError(
        "INVALID_DUE_DATE",
        "Data de vencimento (dueOn) não pode ser anterior à data de emissão (issuedOn).",
        400
      );
    }

    if (input.title !== undefined) {
      if (typeof input.title !== "string" || input.title.trim().length === 0) {
        throw new FinancialTitleError("INVALID_TITLE", "Título é obrigatório.", 400);
      }
      const newTitle = input.title.trim();
      if (newTitle !== titleRecord.title) {
        changes.title = { from: titleRecord.title, to: newTitle };
        dataToUpdate.title = newTitle;
      }
    }

    if (input.description !== undefined) {
      let newDesc: string | null = null;
      if (input.description !== null) {
        if (typeof input.description !== "string") {
          throw new FinancialTitleError("INVALID_DESCRIPTION", "Descrição deve ser string.", 400);
        }
        const trimmed = input.description.trim();
        if (trimmed.length > 0) newDesc = trimmed;
      }
      if (newDesc !== titleRecord.description) {
        changes.description = { from: titleRecord.description, to: newDesc };
        dataToUpdate.description = newDesc;
      }
    }

    if (input.dueOn !== undefined && finalDueOnStr !== dueOnCivil) {
      changes.dueOn = { from: dueOnCivil, to: finalDueOnStr };
      dataToUpdate.dueOn = parseCivilDateToUTC(finalDueOnStr);
    }

    if (totalHistoryCount === 0) {
      if (input.categoryId !== undefined && input.categoryId !== titleRecord.categoryId) {
        if (typeof input.categoryId !== "string" || input.categoryId.trim().length === 0) {
          throw new FinancialTitleError("INVALID_CATEGORY_ID", "categoryId é obrigatório.", 400);
        }
        const newCatId = input.categoryId.trim();
        await validateTitleCategory(tx, barbershopId, newCatId, titleRecord.kind);
        changes.categoryId = { from: titleRecord.categoryId, to: newCatId };
        dataToUpdate.category = { connect: { id_barbershopId: { id: newCatId, barbershopId } } };
      }

      if (input.originalAmount !== undefined) {
        const newCents = positiveCents(input.originalAmount as MoneyValue, "Valor original");
        if (newCents !== originalCents) {
          changes.originalAmount = {
            from: titleRecord.originalAmount.toFixed(2),
            to: fromCents(newCents).toFixed(2),
          };
          dataToUpdate.originalAmount = fromCents(newCents);
        }
      }

      if (input.issuedOn !== undefined && finalIssuedOnStr !== formatUTCToCivilDate(titleRecord.issuedOn)) {
        changes.issuedOn = {
          from: formatUTCToCivilDate(titleRecord.issuedOn),
          to: finalIssuedOnStr,
        };
        dataToUpdate.issuedOn = parseCivilDateToUTC(finalIssuedOnStr);
      }
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return titleRecord;
    }

    const updated = await tx.financialTitle.update({
      where: { id_barbershopId: { id: titleId, barbershopId } },
      data: dataToUpdate,
    });

    await tx.financialTitleEvent.create({
      data: {
        barbershopId,
        titleId: updated.id,
        type: "UPDATED",
        payload: { changes } as Prisma.InputJsonValue,
        actorUserId,
      },
    });

    return updated;
  };

  if ("$transaction" in client && typeof client.$transaction === "function") {
    return client.$transaction(runTx);
  }
  return runTx(client as Prisma.TransactionClient);
}

export async function cancelTitle(
  barbershopId: string,
  titleId: string,
  actorUserId: string,
  reasonInput: unknown,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (typeof reasonInput !== "string" || reasonInput.trim().length === 0) {
    throw new FinancialTitleError("INVALID_CANCEL_REASON", "Motivo de cancelamento é obrigatório.", 400);
  }
  const cleanReason = reasonInput.trim();

  const runTx = async (tx: Prisma.TransactionClient) => {
    await lockTitleRow(tx, barbershopId, titleId);

    const titleRecord = await tx.financialTitle.findFirst({
      where: { id: titleId, barbershopId },
      include: {
        settlements: {
          include: { reversals: true },
        },
      },
    });

    if (!titleRecord) {
      throw new FinancialTitleError("FINANCIAL_TITLE_NOT_FOUND", "Título não encontrado.", 404);
    }

    if (titleRecord.cancelledAt !== null) {
      throw new FinancialTitleError("TITLE_ALREADY_CANCELLED", "Título já está cancelado.", 409);
    }

    const activeSettlementsCount = titleRecord.settlements.filter(
      (s) => s.reversals.length === 0
    ).length;

    if (activeSettlementsCount > 0) {
      throw new FinancialTitleError(
        "TITLE_HAS_ACTIVE_SETTLEMENTS",
        "Não é possível cancelar um título que possui liquidações ativas.",
        409
      );
    }

    const updated = await tx.financialTitle.update({
      where: { id_barbershopId: { id: titleId, barbershopId } },
      data: {
        cancelledAt: new Date(),
        cancelledById: actorUserId,
        cancelReason: cleanReason,
      },
    });

    await tx.financialTitleEvent.create({
      data: {
        barbershopId,
        titleId: updated.id,
        type: "CANCELLED",
        payload: { reason: cleanReason },
        actorUserId,
      },
    });

    return updated;
  };

  if ("$transaction" in client && typeof client.$transaction === "function") {
    return client.$transaction(runTx);
  }
  return runTx(client as Prisma.TransactionClient);
}

export async function getTitleById(
  barbershopId: string,
  titleId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const title = await client.financialTitle.findFirst({
    where: { id: titleId, barbershopId },
    include: {
      category: true,
      createdBy: { select: { id: true, name: true, email: true } },
      cancelledBy: { select: { id: true, name: true, email: true } },
      settlements: {
        orderBy: { createdAt: "asc" },
        include: {
          createdBy: { select: { id: true, name: true } },
          reversals: {
            include: {
              createdBy: { select: { id: true, name: true } },
              financialEntry: true,
            },
          },
          financialEntry: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: {
          actorUser: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!title) return null;

  const activeSettlements = title.settlements.filter((s) => s.reversals.length === 0);
  const reversedSettlements = title.settlements.filter((s) => s.reversals.length > 0);

  const settledPrincipalCents = activeSettlements.reduce(
    (sum, s) => sum + toCents(s.principalAmount),
    0
  );

  const originalCents = toCents(title.originalAmount);
  const dueOnCivil = formatUTCToCivilDate(title.dueOn);

  const derived = calculateTitleDerivedStatus({
    cancelledAt: title.cancelledAt,
    originalAmountCents: originalCents,
    settledPrincipalCents,
    dueOnCivil,
  });

  return {
    id: title.id,
    barbershopId: title.barbershopId,
    kind: title.kind,
    title: title.title,
    description: title.description,
    originalAmount: title.originalAmount.toFixed(2),
    issuedOn: formatUTCToCivilDate(title.issuedOn),
    dueOn: dueOnCivil,
    cancelledAt: title.cancelledAt ? title.cancelledAt.toISOString() : null,
    cancelledById: title.cancelledById,
    cancelReason: title.cancelReason,
    createdById: title.createdById,
    createdAt: title.createdAt.toISOString(),
    updatedAt: title.updatedAt.toISOString(),
    category: {
      id: title.category.id,
      code: title.category.code,
      name: title.category.name,
      classification: title.category.classification,
    },
    createdBy: title.createdBy,
    cancelledBy: title.cancelledBy,
    derivedStatus: derived.status,
    settledPrincipal: fromCents(derived.settledPrincipalCents).toFixed(2),
    outstandingPrincipal: fromCents(derived.outstandingPrincipalCents).toFixed(2),
    activeSettlements: activeSettlements.map((s) => ({
      id: s.id,
      principalAmount: s.principalAmount.toFixed(2),
      discountAmount: s.discountAmount.toFixed(2),
      interestAmount: s.interestAmount.toFixed(2),
      fineAmount: s.fineAmount.toFixed(2),
      netCash: fromCents(
        toCents(s.principalAmount) -
          toCents(s.discountAmount) +
          toCents(s.interestAmount) +
          toCents(s.fineAmount)
      ).toFixed(2),
      method: s.method,
      settledAt: s.settledAt.toISOString(),
      notes: s.notes,
      idempotencyKey: s.idempotencyKey,
      createdById: s.createdById,
      createdBy: s.createdBy,
      financialEntry: s.financialEntry
        ? {
            id: s.financialEntry.id,
            type: s.financialEntry.type,
            amount: s.financialEntry.amount.toFixed(2),
            entryDate: s.financialEntry.entryDate.toISOString(),
          }
        : null,
    })),
    reversedSettlements: reversedSettlements.map((s) => ({
      id: s.id,
      principalAmount: s.principalAmount.toFixed(2),
      settledAt: s.settledAt.toISOString(),
      reversal: s.reversals[0]
        ? {
            id: s.reversals[0].id,
            reason: s.reversals[0].reason,
            reversedAt: s.reversals[0].reversedAt.toISOString(),
            idempotencyKey: s.reversals[0].idempotencyKey,
            createdBy: s.reversals[0].createdBy,
            financialEntry: s.reversals[0].financialEntry
              ? {
                  id: s.reversals[0].financialEntry.id,
                  type: s.reversals[0].financialEntry.type,
                  amount: s.reversals[0].financialEntry.amount.toFixed(2),
                  entryDate: s.reversals[0].financialEntry.entryDate.toISOString(),
                }
              : null,
          }
        : null,
    })),
    events: title.events.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      actorUser: e.actorUser,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export interface ListTitlesParams {
  kind?: string;
  status?: string;
  categoryId?: string;
  dueFrom?: string;
  dueTo?: string;
  q?: string;
  page?: number | string;
  limit?: number | string;
  civilToday?: string;
}

export async function listTitles(
  barbershopId: string,
  params: ListTitlesParams,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const page = Math.max(1, parseInt(String(params.page || 1), 10) || 1);
  const rawLimit = parseInt(String(params.limit || 25), 10) || 25;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;

  const civilToday =
    params.civilToday && isValidISODateString(params.civilToday)
      ? params.civilToday
      : todayIsoBR();

  const kindFilter =
    params.kind === "PAYABLE" || params.kind === "RECEIVABLE" ? params.kind : null;
  const categoryIdFilter =
    typeof params.categoryId === "string" && params.categoryId.trim().length > 0
      ? params.categoryId.trim()
      : null;
  const dueFromFilter = isValidISODateString(params.dueFrom) ? params.dueFrom : null;
  const dueToFilter = isValidISODateString(params.dueTo) ? params.dueTo : null;
  const qFilter =
    typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : null;
  const statusFilter =
    typeof params.status === "string" && params.status.trim().length > 0
      ? params.status.trim().toUpperCase()
      : null;

  const validStatuses: FinancialDerivedStatus[] = [
    "CANCELLED",
    "PAID",
    "OVERDUE",
    "PARTIAL",
    "OPEN",
  ];
  if (statusFilter && !validStatuses.includes(statusFilter as FinancialDerivedStatus)) {
    throw new FinancialTitleError("INVALID_STATUS_FILTER", `Status inválido: ${statusFilter}`, 400);
  }

  const queryResult = await client.$queryRaw<
    Array<{
      id: string;
      barbershop_id: string;
      kind: string;
      title: string;
      description: string | null;
      original_amount: Prisma.Decimal;
      issued_on: Date;
      due_on: Date;
      cancelled_at: Date | null;
      cancel_reason: string | null;
      category_id: string;
      category_code: string;
      category_name: string;
      category_classification: string;
      settled_principal: Prisma.Decimal;
      outstanding_principal: Prisma.Decimal;
      derived_status: string;
      full_count: bigint;
    }>
  >`
    WITH settlement_totals AS (
      SELECT
        s.title_id,
        COALESCE(SUM(
          CASE
            WHEN r.id IS NULL THEN s.principal_amount
            ELSE 0
          END
        ), 0) AS settled_principal
      FROM financial_settlements s
      LEFT JOIN financial_settlement_reversals r
        ON r.settlement_id = s.id AND r.barbershop_id = s.barbershop_id
      WHERE s.barbershop_id = ${barbershopId}
      GROUP BY s.title_id
    ),
    derived_titles AS (
      SELECT
        t.id,
        t.barbershop_id,
        t.kind,
        t.title,
        t.description,
        t.original_amount,
        t.issued_on,
        t.due_on,
        t.cancelled_at,
        t.cancel_reason,
        t.created_at,
        t.category_id,
        c.code AS category_code,
        c.name AS category_name,
        c.classification AS category_classification,
        COALESCE(st.settled_principal, 0) AS settled_principal,
        GREATEST(0, t.original_amount - COALESCE(st.settled_principal, 0)) AS outstanding_principal,
        CASE
          WHEN t.cancelled_at IS NOT NULL THEN 'CANCELLED'
          WHEN (t.original_amount - COALESCE(st.settled_principal, 0)) <= 0 THEN 'PAID'
          WHEN t.due_on < (${civilToday}::date) THEN 'OVERDUE'
          WHEN COALESCE(st.settled_principal, 0) > 0 THEN 'PARTIAL'
          ELSE 'OPEN'
        END AS derived_status
      FROM financial_titles t
      JOIN financial_categories c
        ON c.id = t.category_id AND c.barbershop_id = t.barbershop_id
      LEFT JOIN settlement_totals st
        ON st.title_id = t.id
      WHERE t.barbershop_id = ${barbershopId}
        ${kindFilter ? Prisma.sql`AND t.kind = ${kindFilter}::"FinancialTitleKind"` : Prisma.empty}
        ${categoryIdFilter ? Prisma.sql`AND t.category_id = ${categoryIdFilter}` : Prisma.empty}
        ${dueFromFilter ? Prisma.sql`AND t.due_on >= ${parseCivilDateToUTC(dueFromFilter)}` : Prisma.empty}
        ${dueToFilter ? Prisma.sql`AND t.due_on <= ${parseCivilDateToUTC(dueToFilter)}` : Prisma.empty}
        ${qFilter ? Prisma.sql`AND (t.title ILIKE ${`%${qFilter}%`} OR t.description ILIKE ${`%${qFilter}%`})` : Prisma.empty}
    ),
    filtered_titles AS (
      SELECT *, COUNT(*) OVER() AS full_count
      FROM derived_titles
      WHERE 1=1
        ${statusFilter ? Prisma.sql`AND derived_status = ${statusFilter}` : Prisma.empty}
    )
    SELECT *
    FROM filtered_titles
    ORDER BY due_on ASC, created_at DESC, id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = queryResult.length > 0 ? Number(queryResult[0].full_count) : 0;
  const totalPages = Math.ceil(total / limit);

  const items = queryResult.map((row) => ({
    id: row.id,
    barbershopId: row.barbershop_id,
    kind: row.kind as FinancialTitleKind,
    title: row.title,
    description: row.description,
    originalAmount: new Prisma.Decimal(row.original_amount).toFixed(2),
    issuedOn: formatUTCToCivilDate(row.issued_on),
    dueOn: formatUTCToCivilDate(row.due_on),
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    cancelReason: row.cancel_reason,
    category: {
      id: row.category_id,
      code: row.category_code,
      name: row.category_name,
      classification: row.category_classification as FinancialCategoryClassification,
    },
    derivedStatus: row.derived_status as FinancialDerivedStatus,
    settledPrincipal: new Prisma.Decimal(row.settled_principal).toFixed(2),
    outstandingPrincipal: new Prisma.Decimal(row.outstanding_principal).toFixed(2),
  }));

  return {
    items,
    page,
    limit,
    total,
    totalPages,
  };
}
