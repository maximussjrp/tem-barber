import { PaymentMethod, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, MoneyValue, positiveCents, toCents } from "./money";
import { OperationalError } from "./comandas";

export async function recordTip(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId: string;
    memberId: string;
    amount: MoneyValue;
    method: PaymentMethod;
    checkoutAllocationId?: string | null;
    createdById?: string | null;
    idempotencyKey?: string | null;
  }
) {
  if (input.method === "CUSTOMER_CREDIT") {
    throw new OperationalError(
      "INVALID_TIP_METHOD",
      "Crédito do cliente não pode ser utilizado para pagar gorjetas.",
      422
    );
  }

  const amountCents = positiveCents(input.amount, "Valor da gorjeta");

  const checkExisting = async () => {
    if (!input.idempotencyKey) return null;
    const existing = await tx.tipEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        toCents(existing.amount) !== amountCents ||
        existing.comandaId !== input.comandaId ||
        existing.memberId !== input.memberId ||
        existing.method !== input.method
      ) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada com parâmetros diferentes.",
          409
        );
      }
      return existing;
    }
    return null;
  };

  const replayed = await checkExisting();
  if (replayed) return replayed;

  const member = await tx.barbershopMember.findUnique({
    where: { id: input.memberId },
    include: { user: true },
  });
  if (!member || member.barbershopId !== input.barbershopId) {
    throw new OperationalError("MEMBER_NOT_FOUND", "Profissional não pertence a esta barbearia.", 404);
  }

  let cashMovementId: string | undefined;
  if (input.method === "CASH") {
    const activeSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (!activeSession) {
      throw new OperationalError("CASH_SESSION_NOT_OPEN", "Não há caixa aberto para receber gorjeta em dinheiro.", 422);
    }
    const movement = await tx.cashMovement.create({
      data: {
        barbershopId: input.barbershopId,
        cashSessionId: activeSession.id,
        amount: fromCents(amountCents),
        description: `Gorjeta recebida em dinheiro (${member.user?.name || member.id.split("-")[0]})`,
      },
    });
    cashMovementId = movement.id;
  }

  const tipEntry = await tx.tipEntry.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      memberId: input.memberId,
      amount: fromCents(amountCents),
      method: input.method,
      status: "ACTIVE",
      checkoutAllocationId: input.checkoutAllocationId || null,
      createdById: input.createdById || null,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  if (cashMovementId) {
    await tx.cashMovement.update({
      where: { id: cashMovementId },
      data: { tipEntryId: tipEntry.id },
    });
  }

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "TIP_RECEIVED",
      category: "GORJETA",
      amount: fromCents(amountCents),
      description: `Gorjeta recebida para ${member.user?.name || member.id.split("-")[0]} via ${input.method}`,
      comandaId: input.comandaId,
      tipEntryId: tipEntry.id,
    },
  });

  return tipEntry;
}

export async function refundTip(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    tipEntryId: string;
    reason?: string | null;
    refundedById: string;
    idempotencyKey?: string | null;
  }
) {
  const tipEntry = await tx.tipEntry.findUnique({
    where: { id: input.tipEntryId },
    include: { member: { include: { user: true } }, tipRefund: true },
  });

  if (!tipEntry || tipEntry.barbershopId !== input.barbershopId) {
    throw new OperationalError("TIP_NOT_FOUND", "Gorjeta não encontrada.", 404);
  }

  if (tipEntry.status === "REFUNDED") {
    if (tipEntry.tipRefund) return tipEntry.tipRefund;
  }

  if (tipEntry.status === "PAID_OUT") {
    throw new OperationalError(
      "TIP_ALREADY_PAID_OUT",
      "Não é possível estornar uma gorjeta que já foi repassada ao profissional. Reverta o repasse primeiro.",
      422
    );
  }

  const amountCents = toCents(tipEntry.amount);

  let cashMovementId: string | undefined;
  if (tipEntry.method === "CASH") {
    const activeSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (!activeSession) {
      throw new OperationalError("CASH_SESSION_NOT_OPEN", "Não há caixa aberto para estornar gorjeta em dinheiro.", 422);
    }
    const movement = await tx.cashMovement.create({
      data: {
        barbershopId: input.barbershopId,
        cashSessionId: activeSession.id,
        amount: fromCents(-amountCents),
        description: `Estorno de gorjeta em dinheiro (${tipEntry.member.user?.name || tipEntry.memberId.split("-")[0]})`,
      },
    });
    cashMovementId = movement.id;
  }

  await tx.tipEntry.update({
    where: { id: tipEntry.id },
    data: { status: "REFUNDED" },
  });

  const tipRefund = await tx.tipRefund.create({
    data: {
      barbershopId: input.barbershopId,
      tipEntryId: tipEntry.id,
      amount: fromCents(amountCents),
      reason: input.reason || "Estorno de gorjeta",
      refundedById: input.refundedById,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  if (cashMovementId) {
    await tx.cashMovement.update({
      where: { id: cashMovementId },
      data: { tipRefundId: tipRefund.id },
    });
  }

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "TIP_REFUND",
      category: "GORJETA",
      amount: fromCents(amountCents),
      description: `Estorno de gorjeta de ${tipEntry.member.user?.name || tipEntry.memberId.split("-")[0]}`,
      comandaId: tipEntry.comandaId,
      tipRefundId: tipRefund.id,
    },
  });

  return tipRefund;
}

export async function executeTipPayout(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    tipEntryIds?: string[];
    method: PaymentMethod;
    createdById: string;
    idempotencyKey?: string | null;
  }
) {
  if (input.method === "CUSTOMER_CREDIT") {
    throw new OperationalError(
      "INVALID_PAYOUT_METHOD",
      "Crédito do cliente não pode ser utilizado para repasse de gorjetas.",
      422
    );
  }

  const checkExisting = async () => {
    if (!input.idempotencyKey) return null;
    const existing = await tx.tipPayout.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
      include: { allocations: true },
    });
    if (existing) return existing;
    return null;
  };

  const replayed = await checkExisting();
  if (replayed) return replayed;

  const member = await tx.barbershopMember.findUnique({
    where: { id: input.memberId },
    include: { user: true },
  });
  if (!member || member.barbershopId !== input.barbershopId) {
    throw new OperationalError("MEMBER_NOT_FOUND", "Profissional não pertence a esta barbearia.", 404);
  }

  const whereClause: Prisma.TipEntryWhereInput = {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    status: "ACTIVE",
  };

  if (input.tipEntryIds && input.tipEntryIds.length > 0) {
    whereClause.id = { in: input.tipEntryIds };
  }

  const eligibleEntries = await tx.tipEntry.findMany({
    where: whereClause,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (eligibleEntries.length === 0) {
    throw new OperationalError("NO_ELIGIBLE_TIPS", "Nenhuma gorjeta pendente encontrada para repasse.", 422);
  }

  let totalCents = 0;
  for (const entry of eligibleEntries) {
    totalCents += toCents(entry.amount);
  }

  let cashMovementId: string | undefined;
  if (input.method === "CASH") {
    const activeSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (!activeSession) {
      throw new OperationalError("CASH_SESSION_NOT_OPEN", "Não há caixa aberto para realizar repasse em dinheiro.", 422);
    }
    const movement = await tx.cashMovement.create({
      data: {
        barbershopId: input.barbershopId,
        cashSessionId: activeSession.id,
        amount: fromCents(-totalCents),
        description: `Repasse de gorjeta em dinheiro para ${member.user?.name || member.id.split("-")[0]}`,
      },
    });
    cashMovementId = movement.id;
  }

  const payout = await tx.tipPayout.create({
    data: {
      barbershopId: input.barbershopId,
      memberId: input.memberId,
      totalAmount: fromCents(totalCents),
      method: input.method,
      status: "COMPLETED",
      createdById: input.createdById,
      idempotencyKey: input.idempotencyKey || null,
      allocations: {
        create: eligibleEntries.map((e) => ({
          tipEntryId: e.id,
          amount: e.amount,
        })),
      },
    },
    include: { allocations: true },
  });

  await tx.tipEntry.updateMany({
    where: { id: { in: eligibleEntries.map((e) => e.id) } },
    data: { status: "PAID_OUT" },
  });

  if (cashMovementId) {
    await tx.cashMovement.update({
      where: { id: cashMovementId },
      data: { tipPayoutId: payout.id },
    });
  }

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "TIP_PAYOUT",
      category: "REPASSE_GORJETA",
      amount: fromCents(totalCents),
      description: `Repasse de gorjeta para ${member.user?.name || member.id.split("-")[0]} via ${input.method}`,
      tipPayoutId: payout.id,
    },
  });

  return payout;
}

export async function reverseTipPayout(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    payoutId: string;
    reason?: string | null;
    createdById: string;
    idempotencyKey?: string | null;
  }
) {
  const payout = await tx.tipPayout.findUnique({
    where: { id: input.payoutId },
    include: {
      member: { include: { user: true } },
      allocations: { include: { tipEntry: true } },
      reversal: true,
    },
  });

  if (!payout || payout.barbershopId !== input.barbershopId) {
    throw new OperationalError("PAYOUT_NOT_FOUND", "Repasse de gorjeta não encontrado.", 404);
  }

  if (payout.status === "REVERSED") {
    if (payout.reversal) return payout.reversal;
  }

  const totalCents = toCents(payout.totalAmount);

  let cashMovementId: string | undefined;
  if (payout.method === "CASH") {
    const activeSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (!activeSession) {
      throw new OperationalError("CASH_SESSION_NOT_OPEN", "Não há caixa aberto para estornar repasse em dinheiro.", 422);
    }
    const movement = await tx.cashMovement.create({
      data: {
        barbershopId: input.barbershopId,
        cashSessionId: activeSession.id,
        amount: fromCents(totalCents),
        description: `Estorno de repasse de gorjeta em dinheiro (${payout.member.user?.name || payout.memberId.split("-")[0]})`,
      },
    });
    cashMovementId = movement.id;
  }

  await tx.tipPayout.update({
    where: { id: payout.id },
    data: { status: "REVERSED" },
  });

  const tipEntryIds = payout.allocations.map((a) => a.tipEntryId);
  await tx.tipEntry.updateMany({
    where: { id: { in: tipEntryIds } },
    data: { status: "ACTIVE" },
  });

  const reversal = await tx.tipPayoutReversal.create({
    data: {
      barbershopId: input.barbershopId,
      payoutId: payout.id,
      reason: input.reason || "Reversão de repasse de gorjeta",
      createdById: input.createdById,
      idempotencyKey: input.idempotencyKey || null,
      allocations: {
        create: payout.allocations.map((a) => ({
          tipPayoutAllocationId: a.id,
          tipEntryId: a.tipEntryId,
          amountRestored: a.amount,
        })),
      },
    },
  });

  if (cashMovementId) {
    await tx.cashMovement.update({
      where: { id: cashMovementId },
      data: { tipPayoutReversalId: reversal.id },
    });
  }

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "TIP_PAYOUT_REVERSAL",
      category: "REPASSE_GORJETA",
      amount: fromCents(totalCents),
      description: `Reversão de repasse de gorjeta (${payout.member.user?.name || payout.memberId.split("-")[0]})`,
      tipPayoutReversalId: reversal.id,
    },
  });

  return reversal;
}

export async function reconcileTipLedger(
  barbershopId: string,
  memberId?: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const where: Prisma.TipEntryWhereInput = { barbershopId };
  if (memberId) where.memberId = memberId;

  const tipEntries = await client.tipEntry.findMany({ where });

  let totalReceivedCents = 0;
  let totalRefundedCents = 0;
  let totalPaidOutCents = 0;
  let activePendingCents = 0;

  for (const t of tipEntries) {
    const cents = toCents(t.amount);
    totalReceivedCents += cents;

    if (t.status === "ACTIVE") activePendingCents += cents;
    else if (t.status === "REFUNDED") totalRefundedCents += cents;
    else if (t.status === "PAID_OUT") totalPaidOutCents += cents;
  }

  const expectedActiveCents = totalReceivedCents - totalRefundedCents - totalPaidOutCents;

  return {
    isBalanced: expectedActiveCents === activePendingCents,
    totalReceived: Number((totalReceivedCents / 100).toFixed(2)),
    totalRefunded: Number((totalRefundedCents / 100).toFixed(2)),
    totalPaidOut: Number((totalPaidOutCents / 100).toFixed(2)),
    activePending: Number((activePendingCents / 100).toFixed(2)),
    expectedActive: Number((expectedActiveCents / 100).toFixed(2)),
  };
}
