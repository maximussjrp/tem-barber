import { ComandaStatus, PaymentMethod, Prisma, StockMovementType } from "@prisma/client";
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
      return recalculateComandaTotals(tx, input.comandaId);
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
  }

  return recalculateComandaTotals(tx, input.comandaId);
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
    }
  }

  const updated = await recalculateComandaTotals(tx, original.comandaId);
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
  const comanda = await recalculateComandaTotals(tx, comandaId);
  if (comanda.barbershopId !== barbershopId) {
    throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
  }
  if (comanda.status === "CLOSED") return comanda;
  if (comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada nao pode ser fechada.", 422);
  }
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

  return tx.comanda.update({
    where: { id: comandaId },
    data: { status: "CLOSED", closedAt: new Date(), remainingTotal: 0 },
    include: comandaInclude,
  });
}

