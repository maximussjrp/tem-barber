import {
  FinancialSettlementMethod,
  Prisma,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, MoneyValue, nonNegativeCents, positiveCents, toCents } from "@/lib/operations/money";
import {
  calculateTitleDerivedStatus,
  FinancialTitleError,
  formatUTCToCivilDate,
  lockTitleRow,
} from "./titles";

export class FinancialSettlementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "FinancialSettlementError";
    this.code = code;
    this.status = status;
  }
}

export function validateIdempotencyKeyHeader(keyInput: unknown): string {
  if (typeof keyInput !== "string" || keyInput.trim().length === 0) {
    throw new FinancialSettlementError(
      "MISSING_IDEMPOTENCY_KEY",
      "O header Idempotency-Key é obrigatório.",
      400
    );
  }

  const clean = keyInput.trim().toLowerCase();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(clean)) {
    throw new FinancialSettlementError(
      "INVALID_IDEMPOTENCY_KEY",
      "O header Idempotency-Key deve ser um UUID válido.",
      400
    );
  }

  return clean;
}

export interface CreateSettlementInput {
  principalAmount: unknown;
  discountAmount?: unknown;
  interestAmount?: unknown;
  fineAmount?: unknown;
  method?: unknown;
  notes?: unknown;
  settledAt?: unknown;
}

export interface CanonicalSettlementPayload {
  titleId: string;
  principalAmount: string;
  discountAmount: string;
  interestAmount: string;
  fineAmount: string;
  method: string | null;
  notes: string | null;
}

export function matchesCanonicalSettlementPayload(
  existing: {
    titleId: string;
    principalAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    interestAmount: Prisma.Decimal;
    fineAmount: Prisma.Decimal;
    method: FinancialSettlementMethod | null;
    notes: string | null;
  },
  expected: CanonicalSettlementPayload
): boolean {
  return (
    existing.titleId === expected.titleId &&
    existing.principalAmount.toFixed(2) === expected.principalAmount &&
    existing.discountAmount.toFixed(2) === expected.discountAmount &&
    existing.interestAmount.toFixed(2) === expected.interestAmount &&
    existing.fineAmount.toFixed(2) === expected.fineAmount &&
    (existing.method ?? null) === expected.method &&
    (existing.notes ?? null) === expected.notes
  );
}

export async function createSettlement(
  barbershopId: string,
  titleId: string,
  createdById: string,
  idempotencyKeyHeader: unknown,
  input: CreateSettlementInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const idempotencyKey = validateIdempotencyKeyHeader(idempotencyKeyHeader);

  if (input.settledAt !== undefined) {
    throw new FinancialSettlementError(
      "CLIENT_SETTLEMENT_TIMESTAMP_BLOCKED",
      "settledAt não pode ser enviado pelo cliente (gerado automaticamente no servidor).",
      400
    );
  }

  const principalCents = positiveCents(input.principalAmount as MoneyValue, "Valor principal");
  const discountCents = nonNegativeCents((input.discountAmount ?? 0) as MoneyValue, "Desconto");
  const interestCents = nonNegativeCents((input.interestAmount ?? 0) as MoneyValue, "Juros");
  const fineCents = nonNegativeCents((input.fineAmount ?? 0) as MoneyValue, "Multa");

  if (discountCents > principalCents) {
    throw new FinancialSettlementError(
      "DISCOUNT_EXCEEDS_PRINCIPAL",
      "O valor do desconto não pode exceder o valor do principal abatido.",
      409
    );
  }

  const netCashCents = principalCents - discountCents + interestCents + fineCents;

  let method: FinancialSettlementMethod | null = null;
  if (netCashCents === 0) {
    if (input.method !== undefined && input.method !== null) {
      throw new FinancialSettlementError(
        "ZERO_CASH_METHOD_MUST_BE_NULL",
        "Liquidações sem movimento financeiro (netCash = 0) não aceitam método de pagamento.",
        400
      );
    }
  } else {
    if (
      typeof input.method !== "string" ||
      !Object.values(FinancialSettlementMethod).includes(input.method as FinancialSettlementMethod)
    ) {
      throw new FinancialSettlementError(
        "MISSING_SETTLEMENT_METHOD",
        "Método de pagamento é obrigatório quando netCash > 0.",
        400
      );
    }
    method = input.method as FinancialSettlementMethod;
  }

  let cleanNotes: string | null = null;
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string") {
      throw new FinancialSettlementError("INVALID_NOTES", "Observações devem ser string.", 400);
    }
    const trimmed = input.notes.trim();
    if (trimmed.length > 0) cleanNotes = trimmed;
  }

  const canonicalPayload: CanonicalSettlementPayload = {
    titleId,
    principalAmount: fromCents(principalCents).toFixed(2),
    discountAmount: fromCents(discountCents).toFixed(2),
    interestAmount: fromCents(interestCents).toFixed(2),
    fineAmount: fromCents(fineCents).toFixed(2),
    method,
    notes: cleanNotes,
  };

  const preCheck = await client.financialSettlement.findUnique({
    where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
    include: { financialEntry: true },
  });

  if (preCheck) {
    if (matchesCanonicalSettlementPayload(preCheck, canonicalPayload)) {
      return { result: preCheck, isReplay: true };
    }
    throw new FinancialSettlementError(
      "IDEMPOTENCY_KEY_REUSED",
      "A chave de idempotência já foi utilizada com um payload diferente.",
      409
    );
  }

  const runTx = async (tx: Prisma.TransactionClient) => {
    await lockTitleRow(tx, barbershopId, titleId);

    const recheck = await tx.financialSettlement.findUnique({
      where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
      include: { financialEntry: true },
    });

    if (recheck) {
      if (matchesCanonicalSettlementPayload(recheck, canonicalPayload)) {
        return { result: recheck, isReplay: true };
      }
      throw new FinancialSettlementError(
        "IDEMPOTENCY_KEY_REUSED",
        "A chave de idempotência já foi utilizada com um payload diferente.",
        409
      );
    }

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
      throw new FinancialSettlementError(
        "TITLE_CANCELLED",
        "Não é possível liquidar um título cancelado.",
        409
      );
    }

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

    if (derived.status === "PAID" || derived.outstandingPrincipalCents === 0) {
      throw new FinancialSettlementError("TITLE_PAID", "Título já está totalmente quitado.", 409);
    }

    if (principalCents > derived.outstandingPrincipalCents) {
      throw new FinancialSettlementError(
        "OVERPAYMENT",
        `O principal a liquidar (${fromCents(principalCents).toFixed(2)}) excede o saldo devedor (${fromCents(derived.outstandingPrincipalCents).toFixed(2)}).`,
        409
      );
    }

    const now = new Date();

    const settlementRecord = await tx.financialSettlement.create({
      data: {
        barbershopId,
        titleId,
        principalAmount: fromCents(principalCents),
        discountAmount: fromCents(discountCents),
        interestAmount: fromCents(interestCents),
        fineAmount: fromCents(fineCents),
        method,
        settledAt: now,
        notes: cleanNotes,
        idempotencyKey,
        createdById,
      },
    });

    let entryId: string | null = null;
    if (netCashCents > 0) {
      const entryType = titleRecord.kind === "RECEIVABLE" ? "MANUAL_IN" : "MANUAL_OUT";
      const entryAmountCents = titleRecord.kind === "RECEIVABLE" ? netCashCents : -netCashCents;
      const description =
        titleRecord.kind === "RECEIVABLE"
          ? `Liquidação de conta a receber: ${titleRecord.title}`
          : `Liquidação de conta a pagar: ${titleRecord.title}`;

      const entry = await tx.financialEntry.create({
        data: {
          barbershopId,
          type: entryType,
          category: "FINANCIAL_TITLE",
          amount: fromCents(entryAmountCents),
          description,
          entryDate: now,
          userId: createdById,
          financialSettlementId: settlementRecord.id,
        },
      });

      entryId = entry.id;
    }

    await tx.financialTitleEvent.create({
      data: {
        barbershopId,
        titleId,
        type: "SETTLEMENT_CREATED",
        payload: {
          settlementId: settlementRecord.id,
          principalAmount: fromCents(principalCents).toFixed(2),
          discountAmount: fromCents(discountCents).toFixed(2),
          interestAmount: fromCents(interestCents).toFixed(2),
          fineAmount: fromCents(fineCents).toFixed(2),
          netCash: fromCents(netCashCents).toFixed(2),
          method,
          settledAt: now.toISOString(),
          financialEntryId: entryId,
        },
        actorUserId: createdById,
      },
    });

    return { result: settlementRecord, isReplay: false };
  };

  try {
    if ("$transaction" in client && typeof client.$transaction === "function") {
      return await client.$transaction(runTx);
    }
    return await runTx(client as Prisma.TransactionClient);
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await client.financialSettlement.findUnique({
        where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
        include: { financialEntry: true },
      });
      if (winner && matchesCanonicalSettlementPayload(winner, canonicalPayload)) {
        return { result: winner, isReplay: true };
      }
      throw new FinancialSettlementError(
        "IDEMPOTENCY_KEY_REUSED",
        "A chave de idempotência já foi utilizada com um payload diferente.",
        409
      );
    }
    throw err;
  }
}

export interface ReverseSettlementInput {
  reason: unknown;
}

export interface CanonicalReversalPayload {
  settlementId: string;
  reason: string;
}

export function matchesCanonicalReversalPayload(
  existing: { settlementId: string; reason: string },
  expected: CanonicalReversalPayload
): boolean {
  return existing.settlementId === expected.settlementId && existing.reason === expected.reason;
}

export async function reverseSettlement(
  barbershopId: string,
  settlementId: string,
  createdById: string,
  idempotencyKeyHeader: unknown,
  input: ReverseSettlementInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const idempotencyKey = validateIdempotencyKeyHeader(idempotencyKeyHeader);

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new FinancialSettlementError("INVALID_REVERSAL_REASON", "Motivo de estorno é obrigatório.", 400);
  }
  const cleanReason = input.reason.trim();

  const canonicalPayload: CanonicalReversalPayload = {
    settlementId,
    reason: cleanReason,
  };

  const preCheck = await client.financialSettlementReversal.findUnique({
    where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
  });

  if (preCheck) {
    if (matchesCanonicalReversalPayload(preCheck, canonicalPayload)) {
      return { result: preCheck, isReplay: true };
    }
    throw new FinancialSettlementError(
      "IDEMPOTENCY_KEY_REUSED",
      "A chave de idempotência já foi utilizada com um payload diferente.",
      409
    );
  }

  const initialSettlement = await client.financialSettlement.findFirst({
    where: { id: settlementId, barbershopId },
    select: { titleId: true },
  });

  if (!initialSettlement) {
    throw new FinancialSettlementError("SETTLEMENT_NOT_FOUND", "Liquidação não encontrada.", 404);
  }

  const titleId = initialSettlement.titleId;

  const runTx = async (tx: Prisma.TransactionClient) => {
    await lockTitleRow(tx, barbershopId, titleId);

    const recheck = await tx.financialSettlementReversal.findUnique({
      where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
    });

    if (recheck) {
      if (matchesCanonicalReversalPayload(recheck, canonicalPayload)) {
        return { result: recheck, isReplay: true };
      }
      throw new FinancialSettlementError(
        "IDEMPOTENCY_KEY_REUSED",
        "A chave de idempotência já foi utilizada com um payload diferente.",
        409
      );
    }

    const settlementRecord = await tx.financialSettlement.findFirst({
      where: { id: settlementId, barbershopId },
      include: {
        title: true,
        reversals: true,
        financialEntry: true,
      },
    });

    if (!settlementRecord) {
      throw new FinancialSettlementError("SETTLEMENT_NOT_FOUND", "Liquidação não encontrada.", 404);
    }

    if (settlementRecord.reversals.length > 0) {
      const existingRev = settlementRecord.reversals[0];
      if (existingRev.idempotencyKey === idempotencyKey && matchesCanonicalReversalPayload(existingRev, canonicalPayload)) {
        return { result: existingRev, isReplay: true };
      }
      throw new FinancialSettlementError(
        "SETTLEMENT_ALREADY_REVERSED",
        "Esta liquidação já foi estornada anteriormente.",
        409
      );
    }

    const principalCents = toCents(settlementRecord.principalAmount);
    const discountCents = toCents(settlementRecord.discountAmount);
    const interestCents = toCents(settlementRecord.interestAmount);
    const fineCents = toCents(settlementRecord.fineAmount);
    const netCashCents = principalCents - discountCents + interestCents + fineCents;

    const now = new Date();

    const reversalRecord = await tx.financialSettlementReversal.create({
      data: {
        barbershopId,
        settlementId,
        reason: cleanReason,
        reversedAt: now,
        idempotencyKey,
        createdById,
      },
    });

    let reversalEntryId: string | null = null;
    if (netCashCents > 0) {
      if (!settlementRecord.financialEntry) {
        throw new FinancialSettlementError(
          "INTERNAL_SETTLEMENT_ENTRY_MISSING",
          "Lançamento de caixa original da liquidação não encontrado para estorno.",
          500
        );
      }

      const origEntry = settlementRecord.financialEntry;
      const reverseType = origEntry.type === "MANUAL_IN" ? "MANUAL_OUT" : "MANUAL_IN";
      const reverseAmountCents = -toCents(origEntry.amount);

      const reverseEntry = await tx.financialEntry.create({
        data: {
          barbershopId,
          type: reverseType,
          category: "FINANCIAL_TITLE",
          amount: fromCents(reverseAmountCents),
          description: `Estorno de liquidação: ${settlementRecord.title.title}`,
          entryDate: now,
          userId: createdById,
          financialSettlementReversalId: reversalRecord.id,
        },
      });

      reversalEntryId = reverseEntry.id;
    }

    await tx.financialTitleEvent.create({
      data: {
        barbershopId,
        titleId,
        type: "SETTLEMENT_REVERSED",
        payload: {
          settlementId,
          reversalId: reversalRecord.id,
          reason: cleanReason,
          reversedAt: now.toISOString(),
          reversedCashAmount: fromCents(netCashCents).toFixed(2),
          financialEntryId: reversalEntryId,
        },
        actorUserId: createdById,
      },
    });

    return { result: reversalRecord, isReplay: false };
  };

  try {
    if ("$transaction" in client && typeof client.$transaction === "function") {
      return await client.$transaction(runTx);
    }
    return await runTx(client as Prisma.TransactionClient);
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await client.financialSettlementReversal.findUnique({
        where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
      });
      if (winner && matchesCanonicalReversalPayload(winner, canonicalPayload)) {
        return { result: winner, isReplay: true };
      }
      throw new FinancialSettlementError(
        "IDEMPOTENCY_KEY_REUSED",
        "A chave de idempotência já foi utilizada com um payload diferente.",
        409
      );
    }
    throw err;
  }
}
