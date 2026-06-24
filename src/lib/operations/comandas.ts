import {
  ComandaItemStatus,
  ComandaItemType,
  Prisma,
} from "@prisma/client";
import { fromCents, nonNegativeCents, positiveCents, toCents } from "./money";
import { syncCommissionReleaseForComanda } from "./commissions";

export const comandaInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  appointment: {
    select: {
      id: true,
      dateTime: true,
      memberId: true,
      barber: { include: { user: { select: { name: true } } } },
    },
  },
  items: {
    include: {
      service: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, trackStock: true } },
      executor: { include: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  },
  payments: { orderBy: { paidAt: "asc" } },
} satisfies Prisma.ComandaInclude;

export type ComandaFull = Prisma.ComandaGetPayload<{ include: typeof comandaInclude }>;

export class OperationalError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function calculateItemTotal(input: {
  quantity: number | string | Prisma.Decimal;
  unitPrice: number | string | Prisma.Decimal;
  discountAmount?: number | string | Prisma.Decimal;
  surchargeAmount?: number | string | Prisma.Decimal;
}) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new OperationalError("INVALID_QUANTITY", "Quantidade deve ser maior que zero.");
  }

  const gross = Math.round(quantity * toCents(input.unitPrice));
  const discount = nonNegativeCents(input.discountAmount ?? 0, "Desconto");
  const surcharge = nonNegativeCents(input.surchargeAmount ?? 0, "Acrescimo");
  const total = gross - discount + surcharge;
  if (total < 0) {
    throw new OperationalError("NEGATIVE_TOTAL", "Total do item nao pode ser negativo.");
  }

  return fromCents(total);
}

export async function recalculateComandaTotals(tx: Prisma.TransactionClient, comandaId: string) {
  const [items, payments] = await Promise.all([
    tx.comandaItem.findMany({ where: { comandaId, status: { not: ComandaItemStatus.CANCELLED } } }),
    tx.payment.findMany({ where: { comandaId, status: "CONFIRMED" } }),
  ]);

  const regularItems = items.filter(
    (item) => item.type === "SERVICE" || item.type === "PRODUCT"
  );
  const discounts = items.filter((item) => item.type === "DISCOUNT");
  const surcharges = items.filter((item) => item.type === "SURCHARGE");

  const subtotal = regularItems.reduce((sum, item) => sum + toCents(item.total), 0);
  const discountTotal = discounts.reduce((sum, item) => sum + toCents(item.total), 0);
  const surchargeTotal = surcharges.reduce((sum, item) => sum + toCents(item.total), 0);
  const total = Math.max(0, subtotal - discountTotal + surchargeTotal);
  const paidTotal = payments.reduce((sum, payment) => sum + toCents(payment.amount), 0);
  
  if (total < paidTotal) {
    throw new OperationalError(
      "TOTAL_BELOW_PAID",
      "As alterações reduziriam o total da comanda abaixo do valor já pago.",
      422
    );
  }
  
  const remainingTotal = Math.max(0, total - paidTotal);

  return tx.comanda.update({
    where: { id: comandaId },
    data: {
      subtotal: fromCents(subtotal),
      discountTotal: fromCents(discountTotal),
      surchargeTotal: fromCents(surchargeTotal),
      total: fromCents(total),
      paidTotal: fromCents(paidTotal),
      remainingTotal: fromCents(remainingTotal),
    },
    include: comandaInclude,
  });
}

export async function assertEditableComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string
) {
  const comanda = await tx.comanda.findFirst({ where: { id: comandaId, barbershopId } });
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
  if (comanda.status === "CLOSED") {
    throw new OperationalError("COMANDA_CLOSED", "Comanda fechada nao pode ser editada.", 422);
  }
  if (comanda.status === "CANCELLED") {
    throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada nao pode ser editada.", 422);
  }
  return comanda;
}

export async function resolveExecutor(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  executorId: string | null | undefined,
  serviceId?: string
) {
  if (!executorId) return null;

  const executor = await tx.barbershopMember.findFirst({
    where: { id: executorId, barbershopId, isActive: true },
    include: { services: true },
  });
  if (!executor) throw new OperationalError("INVALID_EXECUTOR", "Profissional invalido.", 400);

  if (serviceId && executor.services.length > 0) {
    const canExecute = executor.services.some((service) => service.serviceId === serviceId);
    if (!canExecute) {
      throw new OperationalError(
        "EXECUTOR_SERVICE_MISMATCH",
        "Profissional nao habilitado para o servico.",
        422
      );
    }
  }

  return executor;
}

export async function addServiceItem(
  tx: Prisma.TransactionClient,
  input: {
    comandaId: string;
    barbershopId: string;
    serviceId: string;
    executorId: string;
    quantity?: number;
    discountAmount?: string | number;
    surchargeAmount?: string | number;
  }
) {
  await assertEditableComanda(tx, input.barbershopId, input.comandaId);
  const service = await tx.service.findFirst({
    where: { id: input.serviceId, barbershopId: input.barbershopId, isActive: true },
  });
  if (!service) throw new OperationalError("INVALID_SERVICE", "Servico invalido.", 400);
  await resolveExecutor(tx, input.barbershopId, input.executorId, service.id);

  const total = calculateItemTotal({
    quantity: input.quantity ?? 1,
    unitPrice: service.price,
    discountAmount: input.discountAmount,
    surchargeAmount: input.surchargeAmount,
  });

  await tx.comandaItem.create({
    data: {
      comandaId: input.comandaId,
      barbershopId: input.barbershopId,
      type: ComandaItemType.SERVICE,
      description: service.name,
      quantity: input.quantity ?? 1,
      unitPrice: service.price,
      discountAmount: input.discountAmount ?? 0,
      surchargeAmount: input.surchargeAmount ?? 0,
      total,
      serviceId: service.id,
      executorId: input.executorId,
    },
  });

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
  return updated;
}

export async function addProductItem(
  tx: Prisma.TransactionClient,
  input: {
    comandaId: string;
    barbershopId: string;
    productId: string;
    quantity?: number;
    discountAmount?: string | number;
    surchargeAmount?: string | number;
  }
) {
  await assertEditableComanda(tx, input.barbershopId, input.comandaId);
  const product = await tx.product.findFirst({
    where: { id: input.productId, barbershopId: input.barbershopId, isActive: true },
  });
  if (!product) throw new OperationalError("INVALID_PRODUCT", "Produto invalido.", 400);

  if (product.trackStock) {
    const existingItems = await tx.comandaItem.findMany({
      where: {
        comandaId: input.comandaId,
        productId: input.productId,
        status: { not: "CANCELLED" }
      }
    });
    const qtyInComanda = existingItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    const requestedQty = input.quantity ?? 1;
    
    if (Number(product.currentStock) - qtyInComanda < requestedQty) {
      throw new OperationalError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente. Disponível para adicionar: ${Math.max(0, Number(product.currentStock) - qtyInComanda)}`,
        422
      );
    }
  }

  const total = calculateItemTotal({
    quantity: input.quantity ?? 1,
    unitPrice: product.salePrice,
    discountAmount: input.discountAmount,
    surchargeAmount: input.surchargeAmount,
  });

  await tx.comandaItem.create({
    data: {
      comandaId: input.comandaId,
      barbershopId: input.barbershopId,
      type: ComandaItemType.PRODUCT,
      description: product.name,
      quantity: input.quantity ?? 1,
      unitPrice: product.salePrice,
      discountAmount: input.discountAmount ?? 0,
      surchargeAmount: input.surchargeAmount ?? 0,
      total,
      productId: product.id,
    },
  });

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
  return updated;
}

export async function addAdjustmentItem(
  tx: Prisma.TransactionClient,
  input: {
    comandaId: string;
    barbershopId: string;
    type: "SURCHARGE";
    description: string;
    amount: string | number;
  }
) {
  await assertEditableComanda(tx, input.barbershopId, input.comandaId);
  const amount = positiveCents(input.amount, "Valor");

  await tx.comandaItem.create({
    data: {
      comandaId: input.comandaId,
      barbershopId: input.barbershopId,
      type: input.type,
      description: input.description.trim() || "Acrescimo",
      quantity: 1,
      unitPrice: fromCents(amount),
      total: fromCents(amount),
    },
  });

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
  return updated;
}

export async function upsertDiscountItem(
  tx: Prisma.TransactionClient,
  input: {
    comandaId: string;
    barbershopId: string;
    description: string;
    amount: string | number;
  }
) {
  await assertEditableComanda(tx, input.barbershopId, input.comandaId);
  const amountCents = Math.round(Number(input.amount) * 100);
  
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new OperationalError("INVALID_DISCOUNT", "O desconto não pode ser negativo.", 400);
  }

  const reason = input.description.trim().substring(0, 255);
  
  if (amountCents > 0 && !reason) {
    throw new OperationalError("INVALID_DISCOUNT_REASON", "Justificativa obrigatória para desconto maior que zero.", 400);
  }

  const items = await tx.comandaItem.findMany({
    where: { comandaId: input.comandaId, status: { not: ComandaItemStatus.CANCELLED } }
  });
  
  const regularItems = items.filter(
    (item) => item.type === "SERVICE" || item.type === "PRODUCT"
  );
  const subtotal = regularItems.reduce((sum, item) => sum + toCents(item.total), 0);
  
  if (amountCents > subtotal) {
    throw new OperationalError("DISCOUNT_EXCEEDS_SUBTOTAL", "O desconto não pode ser maior que o subtotal dos serviços e produtos.", 422);
  }

  const existingDiscount = items.find(item => item.type === "DISCOUNT");

  if (amountCents === 0) {
    if (existingDiscount) {
      await tx.comandaItem.delete({ where: { id: existingDiscount.id } });
    }
  } else {
    if (existingDiscount) {
      await tx.comandaItem.update({
        where: { id: existingDiscount.id },
        data: {
          description: reason,
          unitPrice: fromCents(amountCents),
          total: fromCents(amountCents),
        }
      });
    } else {
      await tx.comandaItem.create({
        data: {
          comandaId: input.comandaId,
          barbershopId: input.barbershopId,
          type: ComandaItemType.DISCOUNT,
          description: reason,
          quantity: 1,
          unitPrice: fromCents(amountCents),
          total: fromCents(amountCents),
        }
      });
    }
  }

  const updated = await recalculateComandaTotals(tx, input.comandaId);
  await syncCommissionReleaseForComanda(tx, input.barbershopId, input.comandaId);
  return updated;
}

