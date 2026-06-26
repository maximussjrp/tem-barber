import { ComandaStatus, PaymentMethod, Prisma, StockMovementType } from "@prisma/client";
import { syncCashSessionExpectedAmount } from "./cash";
import { syncCommissionReleaseForComanda } from "./commissions";
import { comandaInclude, OperationalError, recalculateComandaTotals } from "./comandas";
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
  }
) {
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
      const updated = await recalculateComandaTotals(tx, input.comandaId);
      await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
      return updated;
    }
  }

  const amount = positiveCents(input.amount, "Pagamento");
  const comanda = await tx.comanda.findFirst({
    where: { id: input.comandaId, barbershopId: input.barbershopId },
  });
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
  if (comanda.status === "CLOSED" || comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_NOT_PAYABLE", "Comanda nao aceita pagamento.", 422);
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
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
  return updated;
}

export async function refundPayment(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    paymentId: string;
    amount: string | number;
    reason: string;
    userId: string;
  }
) {
  const amount = positiveCents(input.amount, "Estorno");
  const original = await tx.payment.findFirst({
    where: { id: input.paymentId, barbershopId: input.barbershopId, status: "CONFIRMED" },
  });
  if (!original) throw new OperationalError("PAYMENT_NOT_FOUND", "Pagamento nao encontrado.", 404);

  const refundable = toCents(original.amount) - toCents(original.refundedAmount);
  if (amount > refundable) {
    throw new OperationalError("REFUND_EXCEEDS_PAYMENT", "Estorno excede saldo estornavel.", 422);
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
    },
  });

  await tx.payment.update({
    where: { id: original.id },
    data: { refundedAmount: fromCents(toCents(original.refundedAmount) + amount) },
  });

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

  if (original.method === "CASH") {
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
  await syncCommissionReleaseForComanda(tx, input.barbershopId, original.comandaId, "Recalculo por estorno");
  if (toCents(updated.remainingTotal) > 0 && updated.status === "CLOSED") {
    return tx.comanda.update({
      where: { id: updated.id },
      data: { status: ComandaStatus.PENDING_PAYMENT, closedAt: null },
      include: comandaInclude,
    });
  }
  return updated;
}

export async function closeComanda(tx: Prisma.TransactionClient, barbershopId: string, comandaId: string) {
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
    const activeSub = await tx.customerClubSubscription.findFirst({
      where: {
        barbershopId,
        customerId: comanda.customerId,
        status: { in: ["ACTIVE", "GRACE_PERIOD"] },
        currentPeriodStart: { lte: new Date() },
        currentPeriodEnd: { gt: new Date() },
      },
      include: { clubPlan: true },
    });

    const itemsRequestingClub = comanda.items.filter(
      (item) => item.clubBenefitRequested && item.status !== "CANCELLED"
    );

    if (itemsRequestingClub.length > 0) {
      if (!activeSub) {
        throw new OperationalError("SUBSCRIPTION_NOT_FOUND", "Assinatura ativa do clube necessária para aplicar benefícios.", 422);
      }

      // Resolve e registra cada um dos benefícios
      const competence = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      const { getClubBenefitsBalance, resolveClubBenefitForComandaItem, registerClubBenefitUsage } = await import("./club");

      for (const item of itemsRequestingClub) {
        const itemType = item.type === "PRODUCT" ? "PRODUCT" : "SERVICE";
        const resolved = await resolveClubBenefitForComandaItem({
          barbershopId,
          customerId: comanda.customerId,
          serviceId: item.serviceId || undefined,
          productId: item.productId || undefined,
          itemType,
          atDate: new Date(),
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
          subscriptionId: activeSub.id,
          comandaItemId: item.id,
          serviceId: item.serviceId || undefined,
          productId: item.productId || undefined,
          memberId: executorId,
          pointWeight: Number(resolved.pointWeight || 0),
          competence,
          originalAmount,
          coveredAmount,
          discountAmount,
          tx,
        });
      }
    }
  }

  // 3. Recalcular totais e validar se está totalmente paga
  comanda = await recalculateComandaTotals(tx, comandaId);
  if (toCents(comanda.remainingTotal) > 0) {
    throw new OperationalError("COMANDA_NOT_PAID", "Comanda ainda possui valor em aberto.", 422);
  }

  const productItems = comanda.items.filter(
    (item) => item.type === "PRODUCT" && item.status !== "CANCELLED" && item.productId
  );

  for (const item of productItems) {
    const product = await tx.product.findFirst({
      where: { id: item.productId!, barbershopId },
    });
    if (!product?.trackStock) continue;

    const existingMovement = await tx.stockMovement.findFirst({
      where: { comandaItemId: item.id, type: StockMovementType.SALE },
    });
    if (existingMovement) continue;

    const nextStock = Number(product.currentStock) - Number(item.quantity);
    if (nextStock < 0) {
      throw new OperationalError("INSUFFICIENT_STOCK", `Estoque insuficiente para ${product.name}.`, 422);
    }

    await tx.product.update({
      where: { id: product.id },
      data: { currentStock: new Prisma.Decimal(nextStock.toFixed(3)) },
    });
    await tx.stockMovement.create({
      data: {
        barbershopId,
        productId: product.id,
        comandaItemId: item.id,
        type: "SALE",
        quantity: item.quantity,
        description: `Baixa da comanda ${comandaId}`,
      },
    });
  }

  const closed = await tx.comanda.update({
    where: { id: comandaId },
    data: { status: "CLOSED", closedAt: new Date(), remainingTotal: 0 },
    include: comandaInclude,
  });

  if (closed.appointmentId) {
    await tx.appointment.update({
      where: { id: closed.appointmentId },
      data: { status: "COMPLETED" },
    });
  }

  await syncCommissionReleaseForComanda(tx, barbershopId, comandaId);
  return closed;
}

