import { CommissionPayableSourceKind, PaymentMethod, Prisma } from "@prisma/client";
import { syncCashSessionExpectedAmount } from "./cash";
import { syncCommissionReleaseForComanda } from "./commissions";
import { comandaInclude, lockComandaRow, OperationalError, recalculateComandaTotals } from "./comandas";
import { fromCents, positiveCents, toCents } from "./money";

export async function registerPayment(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId: string;
    method: PaymentMethod;
    amount: string | number;
    userId: string;
    idempotencyKey?: string | null;
    allowClosedDebtPayment?: boolean;
  }
) {
  await lockComandaRow(tx, input.barbershopId, input.comandaId);
  const amount = positiveCents(input.amount, "Pagamento");

  const comanda = await tx.comanda.findFirst({
    where: { id: input.comandaId, barbershopId: input.barbershopId },
  });
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);

  if (input.idempotencyKey) {
    const existing = await tx.payment.findUnique({
      where: {
        barbershopId_idempotencyKey: {
          barbershopId: input.barbershopId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.comandaId !== input.comandaId ||
        existing.method !== input.method ||
        toCents(existing.amount) !== amount
      ) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada para outro pagamento.",
          409
        );
      }

      const updated = await recalculateComandaTotals(tx, existing.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, existing.comandaId, "Liberacao proporcional por pagamento", {
        sourceKind: CommissionPayableSourceKind.PAYMENT,
        sourcePaymentId: existing.id,
      });
      return updated;
    }
  }

  if (comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_NOT_PAYABLE", "Comanda cancelada nao aceita pagamento.", 422);
  }

  if (comanda.status === "CLOSED") {
    const remainingCents = toCents(comanda.remainingTotal);
    if (remainingCents === 0) {
      throw new OperationalError("COMANDA_ALREADY_SETTLED", "A comanda já está totalmente paga.", 422);
    }
    if (!input.allowClosedDebtPayment) {
      throw new OperationalError("COMANDA_NOT_PAYABLE", "Comanda fechada com dívida exige autorização para receber saldo.", 422);
    }
  }

  const remainingCents = toCents(comanda.remainingTotal);
  if (amount > remainingCents) {
    throw new OperationalError("PAYMENT_EXCEEDS_REMAINING", "O valor do pagamento excede o saldo restante da comanda.", 422);
  }

  if (input.method === "CUSTOMER_CREDIT") {
    throw new OperationalError(
      "CUSTOMER_CREDIT_REQUIRES_DEDICATED_FLOW",
      "O crédito do cliente deve ser processado via fluxo dedicado de consumo.",
      422
    );
  }

  let cashSessionId: string | null = null;
  if (input.method === "CASH") {
    const cashSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (!cashSession) {
      throw new OperationalError("CASH_SESSION_REQUIRED", "Pagamento em dinheiro exige caixa aberto.", 422);
    }
    cashSessionId = cashSession.id;
  }

  const payment = await tx.payment.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      method: input.method,
      amount: fromCents(amount),
      idempotencyKey: input.idempotencyKey || null,
      receivedById: input.userId,
    },
  });

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "COMMAND_REVENUE",
      category: input.method,
      amount: fromCents(amount),
      description: `Recebimento da comanda ${input.comandaId}`,
      userId: input.userId,
      comandaId: input.comandaId,
      paymentId: payment.id,
    },
  });

  if (cashSessionId) {
    await tx.cashMovement.create({
      data: {
        barbershopId: input.barbershopId,
        cashSessionId,
        paymentId: payment.id,
        amount: fromCents(amount),
        description: `Pagamento em dinheiro da comanda ${input.comandaId}`,
      },
    });
    await syncCashSessionExpectedAmount(tx, cashSessionId);
  }

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId, "Liberacao proporcional por pagamento", {
    sourceKind: CommissionPayableSourceKind.PAYMENT,
    sourcePaymentId: payment.id,
  });
  return updated;
}

export async function payComandaWithCustomerCredit(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId: string;
    amount: string | number;
    userId: string;
    idempotencyKey?: string | null;
    allowClosedDebtPayment?: boolean;
  }
) {
  await lockComandaRow(tx, input.barbershopId, input.comandaId);
  const amount = positiveCents(input.amount, "Pagamento com crédito");

  const comanda = await tx.comanda.findFirst({
    where: { id: input.comandaId, barbershopId: input.barbershopId },
  });
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);

  if (!comanda.customerId) {
    throw new OperationalError(
      "CUSTOMER_REQUIRED_FOR_CREDIT",
      "Comanda sem cliente vinculado não pode utilizar saldo de crédito.",
      422
    );
  }

  if (input.idempotencyKey) {
    const existing = await tx.payment.findUnique({
      where: {
        barbershopId_idempotencyKey: {
          barbershopId: input.barbershopId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.comandaId !== input.comandaId ||
        existing.method !== "CUSTOMER_CREDIT" ||
        toCents(existing.amount) !== amount
      ) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada para outro pagamento.",
          409
        );
      }

      const updated = await recalculateComandaTotals(tx, existing.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, existing.comandaId, "Liberacao proporcional por pagamento", {
        sourceKind: CommissionPayableSourceKind.PAYMENT,
        sourcePaymentId: existing.id,
      });
      return updated;
    }
  }

  if (comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_NOT_PAYABLE", "Comanda cancelada nao aceita pagamento.", 422);
  }

  if (comanda.status === "CLOSED") {
    const remainingCents = toCents(comanda.remainingTotal);
    if (remainingCents === 0) {
      throw new OperationalError("COMANDA_ALREADY_SETTLED", "A comanda já está totalmente paga.", 422);
    }
    if (!input.allowClosedDebtPayment) {
      throw new OperationalError("COMANDA_NOT_PAYABLE", "Comanda fechada com dívida exige autorização para receber saldo.", 422);
    }
  }

  const remainingCents = toCents(comanda.remainingTotal);
  if (amount > remainingCents) {
    throw new OperationalError("PAYMENT_EXCEEDS_REMAINING", "O valor do pagamento excede o saldo restante da comanda.", 422);
  }

  const payment = await tx.payment.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      method: "CUSTOMER_CREDIT",
      amount: fromCents(amount),
      idempotencyKey: input.idempotencyKey || null,
      receivedById: input.userId,
    },
  });

  const { consumeCustomerCredit } = await import("./customer-credit");
  await consumeCustomerCredit(tx, {
    barbershopId: input.barbershopId,
    customerId: comanda.customerId,
    amount: (amount / 100).toFixed(2),
    comandaId: input.comandaId,
    paymentId: payment.id,
    createdByUserId: input.userId,
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}-credit` : null,
  });

  await tx.financialEntry.create({
    data: {
      barbershopId: input.barbershopId,
      type: "COMMAND_REVENUE",
      category: "CUSTOMER_CREDIT",
      amount: fromCents(amount),
      description: `Recebimento da comanda ${input.comandaId} via Crédito do Cliente`,
      userId: input.userId,
      comandaId: input.comandaId,
      paymentId: payment.id,
    },
  });

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId, "Liberacao proporcional por pagamento", {
    sourceKind: CommissionPayableSourceKind.PAYMENT,
    sourcePaymentId: payment.id,
  });
  return updated;
}

export async function refundPayment(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId?: string;
    paymentId: string;
    amount: string | number;
    reason: string;
    userId: string;
    idempotencyKey?: string | null;
  }
) {
  // Idempotency check
  if (input.idempotencyKey) {
    const existing = await tx.payment.findFirst({
      where: {
        barbershopId: input.barbershopId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing) {
      const updated = await recalculateComandaTotals(tx, existing.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, existing.comandaId, "Recalculo por estorno", {
        sourceKind: CommissionPayableSourceKind.REFUND,
        sourcePaymentId: existing.id,
      });
      return updated;
    }
  }

  // Reason check
  if (!input.reason || input.reason.trim().length < 5) {
    throw new OperationalError("REFUND_REASON_REQUIRED", "O motivo do estorno deve ter pelo menos 5 caracteres.", 400);
  }

  // Amount check
  if (input.amount === undefined || input.amount === null || input.amount === "") {
    throw new OperationalError("REFUND_AMOUNT_REQUIRED", "O valor do estorno é obrigatório.", 400);
  }

  let amount: number;
  try {
    amount = positiveCents(input.amount, "Estorno");
  } catch {
    throw new OperationalError("REFUND_AMOUNT_REQUIRED", "O valor do estorno deve ser maior que zero.", 400);
  }

  // Idempotency pre-check before locking
  if (input.idempotencyKey) {
    const preCheck = await tx.payment.findUnique({
      where: {
        barbershopId_idempotencyKey: {
          barbershopId: input.barbershopId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (preCheck) {
      if (
        preCheck.refundOfId !== input.paymentId ||
        (input.comandaId && preCheck.comandaId !== input.comandaId) ||
        toCents(preCheck.amount) !== -amount
      ) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada para outro estorno.",
          409
        );
      }
      const updated = await recalculateComandaTotals(tx, preCheck.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, preCheck.comandaId, "Recalculo por estorno", {
        sourceKind: CommissionPayableSourceKind.REFUND,
        sourcePaymentId: preCheck.id,
      });
      return updated;
    }
  }

  // Find initial payment to resolve comandaId for locking
  const initial = await tx.payment.findFirst({
    where: { id: input.paymentId, barbershopId: input.barbershopId },
  });

  if (!initial) {
    throw new OperationalError("PAYMENT_NOT_FOUND", "Pagamento não encontrado.", 404);
  }

  await lockComandaRow(tx, input.barbershopId, initial.comandaId);

  // Idempotency re-check under the lock to prevent concurrent duplicate refunds
  if (input.idempotencyKey) {
    const existing = await tx.payment.findUnique({
      where: {
        barbershopId_idempotencyKey: {
          barbershopId: input.barbershopId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.refundOfId !== input.paymentId ||
        (input.comandaId && existing.comandaId !== input.comandaId) ||
        toCents(existing.amount) !== -amount
      ) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada para outro estorno.",
          409
        );
      }
      const updated = await recalculateComandaTotals(tx, existing.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, existing.comandaId, "Recalculo por estorno", {
        sourceKind: CommissionPayableSourceKind.REFUND,
        sourcePaymentId: existing.id,
      });
      return updated;
    }
  }

  // Re-read original payment state under the comanda lock to guarantee fresh DB values (refundedAmount, status)
  const original = await tx.payment.findFirst({
    where: { id: input.paymentId, barbershopId: input.barbershopId },
  });

  if (!original) {
    throw new OperationalError("PAYMENT_NOT_FOUND", "Pagamento não encontrado.", 404);
  }

  if (original.status !== "CONFIRMED") {
    throw new OperationalError("PAYMENT_NOT_REFUNDABLE", "Este pagamento não pode ser estornado pois já foi estornado ou não está confirmado.", 422);
  }

  // Check comandaId match
  if (input.comandaId && original.comandaId !== input.comandaId) {
    throw new OperationalError("PAYMENT_COMANDA_MISMATCH", "O pagamento não pertence à comanda especificada.", 422);
  }

  const refundable = toCents(original.amount) - toCents(original.refundedAmount);
  if (amount > refundable) {
    throw new OperationalError("REFUND_EXCEEDS_PAYMENT", "O valor do estorno excede o saldo estornável.", 422);
  }

  const refund = await tx.payment.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: original.comandaId,
      method: original.method,
      amount: fromCents(-amount),
      status: "REFUNDED",
      refundOfId: original.id,
      refundReason: input.reason,
      receivedById: input.userId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  await tx.payment.update({
    where: { id: original.id },
    data: { refundedAmount: fromCents(toCents(original.refundedAmount) + amount) },
  });

  if (original.method !== "CUSTOMER_CREDIT") {
    await tx.financialEntry.create({
      data: {
        barbershopId: input.barbershopId,
        type: "REFUND",
        category: original.method,
        amount: fromCents(-amount),
        description: input.reason || `Estorno do pagamento ${original.id}`,
        userId: input.userId,
        comandaId: original.comandaId,
        paymentId: refund.id,
      },
    });
  }

  if (original.method === "CUSTOMER_CREDIT") {
    const comanda = await tx.comanda.findFirst({
      where: { id: original.comandaId, barbershopId: input.barbershopId },
    });
    if (!comanda?.customerId) {
      throw new OperationalError(
        "CUSTOMER_REQUIRED_FOR_CREDIT",
        "Estorno para crédito exige cliente vinculado à comanda.",
        422
      );
    }
    const { refundToCustomerCredit } = await import("./customer-credit");
    await refundToCustomerCredit(tx, {
      barbershopId: input.barbershopId,
      customerId: comanda.customerId,
      amount: (amount / 100).toFixed(2),
      comandaId: original.comandaId,
      paymentId: refund.id,
      createdByUserId: input.userId,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}-credit` : null,
    });
  } else if (original.method === "CASH") {
    const cashSession = await tx.cashSession.findFirst({
      where: { barbershopId: input.barbershopId, status: "OPEN" },
    });
    if (cashSession) {
      await tx.cashMovement.create({
        data: {
          barbershopId: input.barbershopId,
          cashSessionId: cashSession.id,
          paymentId: refund.id,
          amount: fromCents(-amount),
          description: input.reason || `Estorno do pagamento ${original.id}`,
        },
      });
      await syncCashSessionExpectedAmount(tx, cashSession.id);
    }
  }

  const updated = await recalculateComandaTotals(tx, original.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, original.comandaId, "Recalculo por estorno", {
    sourceKind: CommissionPayableSourceKind.REFUND,
    sourcePaymentId: refund.id,
  });
  return updated;
}

export async function closeComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string,
  options?: { allowOutstanding?: boolean }
) {
  await lockComandaRow(tx, barbershopId, comandaId);

  // 1. Obter comanda com itens para inspecionar os benefícios solicitados
  let comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: {
      items: {
        include: { clubBenefitUsage: true }
      }
    }
  });

  if (!comanda) {
    throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
  }
  if (comanda.status === "CLOSED") return comanda;
  if (comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada nao pode ser fechada.", 422);
  }

  // 2. Se houver cliente e assinatura e itens pedindo benefício do clube, processá-los
  if (comanda.customerId) {
    const { getActiveCustomerClubSubscription } = await import("./club");
    const activeSub = await getActiveCustomerClubSubscription({
      barbershopId,
      customerId: comanda.customerId,
      atDate: comanda.openedAt,
      tx,
    });

    const itemsRequestingClub = comanda.items.filter(
      (item) => item.clubBenefitRequested && item.status !== "CANCELLED"
    );

    if (itemsRequestingClub.length > 0) {
      if (!activeSub) {
        throw new OperationalError("SUBSCRIPTION_NOT_FOUND", "Assinatura ativa do clube necessária para aplicar benefícios.", 422);
      }

      // Resolve e registra cada um dos benefícios
      const competence = `${comanda.openedAt.getFullYear()}-${String(comanda.openedAt.getMonth() + 1).padStart(2, "0")}`;

      const { resolveClubBenefitForComandaItem, registerClubBenefitUsage } = await import("./club");

      for (const item of itemsRequestingClub) {
        const itemType = item.type === "PRODUCT" ? "PRODUCT" : "SERVICE";
        const resolved = await resolveClubBenefitForComandaItem({
          barbershopId,
          customerId: comanda.customerId,
          serviceId: item.serviceId || undefined,
          productId: item.productId || undefined,
          itemType,
          atDate: comanda.openedAt,
          requestedClubPlanBenefitId: item.requestedClubPlanBenefitId || undefined,
          tx,
        });

        if (!resolved.isApplicable) {
          throw new OperationalError(
            resolved.blockedReason || "BENEFIT_NOT_APPLICABLE",
            `Benefício indisponível para o item ${item.description}: ${resolved.blockedReason}`,
            422
          );
        }

        // Determina coveredAmount / discountAmount
        let coveredAmount: number | undefined;
        let discountAmount: number | undefined;
        const originalAmount = Number(item.total);

        if (resolved.benefitType === "INCLUDED_SERVICE") {
          coveredAmount = resolved.coveredAmount || originalAmount;
        } else {
          // Desconto
          const pct = Number(resolved.discountPercent || 0);
          discountAmount = Number(((originalAmount * pct) / 100).toFixed(2));
        }

        // Resolver executorId
        let executorId = item.executorId;
        if (!executorId && item.type === "PRODUCT" && comanda.appointmentId) {
          const appt = await tx.appointment.findUnique({
            where: { id: comanda.appointmentId },
            select: { memberId: true },
          });
          if (appt) executorId = appt.memberId;
        }
        if (!executorId) {
          throw new OperationalError("EXECUTOR_REQUIRED", "Profissional executor é obrigatório para registrar benefício do clube.", 422);
        }

        await registerClubBenefitUsage({
          barbershopId,
          subscriptionId: (resolved as { subscriptionId?: string }).subscriptionId || activeSub.id,
          comandaItemId: item.id,
          serviceId: item.serviceId || undefined,
          productId: item.productId || undefined,
          memberId: executorId,
          pointWeight: Number(resolved.pointWeight || 0),
          competence,
          originalAmount,
          coveredAmount,
          discountAmount,
          atDate: comanda.openedAt,
          tx,
        });
      }
    }
  }

  // 3. Recalcular totais e validar se está totalmente paga (ou se dívida foi permitida)
  comanda = await recalculateComandaTotals(tx, comandaId);
  const remainingCents = toCents(comanda.remainingTotal);
  if (remainingCents > 0 && !options?.allowOutstanding) {
    throw new OperationalError("COMANDA_NOT_PAID", "Comanda ainda possui valor em aberto.", 422);
  }

  const { syncStockForComanda } = await import("./stock");
  await syncStockForComanda(tx, barbershopId, comandaId, `Baixa da comanda ${comandaId}`);

  const closed = await tx.comanda.update({
    where: { id: comandaId },
    data: { status: "CLOSED", closedAt: new Date() },
    include: comandaInclude,
  });

  if (closed.appointmentId) {
    await tx.appointment.update({
      where: { id: closed.appointmentId },
      data: { status: "COMPLETED" },
    });
  }

  await syncCommissionReleaseForComanda(tx, barbershopId, comandaId, "Finalizacao da comanda", {
    sourceKind: CommissionPayableSourceKind.ITEM_COMPLETION,
  });
  return closed;
}

