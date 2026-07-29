import {
  ComandaStatus,
  ComandaItemStatus,
  ComandaItemType,
  Prisma,
} from "@prisma/client";
import { fromCents, nonNegativeCents, positiveCents, toCents } from "./money";
import { syncCommissionReleaseForComanda } from "./commissions";
import { resolveClubBenefitForComandaItem } from "./club";

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
      clubBenefitUsage: true,
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

export async function ensureComandaForAppointment(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    appointmentId: string;
  }
) {
  const existing = await tx.comanda.findUnique({
    where: { appointmentId: input.appointmentId },
    include: comandaInclude,
  });
  if (existing) {
    if (existing.barbershopId !== input.barbershopId) {
      throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
    }
    return existing;
  }

  const appointment = await tx.appointment.findFirst({
    where: { id: input.appointmentId, barbershopId: input.barbershopId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      services: { include: { service: true } },
    },
  });
  if (!appointment) {
    throw new OperationalError("APPOINTMENT_NOT_FOUND", "Agendamento nao encontrado.", 404);
  }

  const itemsToCreate = [];
  for (const item of appointment.services) {
    let clubBenefitRequested = false;
    let requestedClubPlanBenefitId = null;

    try {
      const resolved = await resolveClubBenefitForComandaItem({
        barbershopId: input.barbershopId,
        customerId: appointment.customerId,
        serviceId: item.serviceId,
        itemType: "SERVICE",
        atDate: appointment.dateTime,
        tx,
      });

      if (resolved.isApplicable) {
        clubBenefitRequested = true;
        requestedClubPlanBenefitId = resolved.clubPlanBenefitId;
      }
    } catch {
      // Keep comanda creation available even when club preview is unavailable.
    }

    itemsToCreate.push({
      barbershopId: input.barbershopId,
      type: "SERVICE" as const,
      description: item.service.name,
      quantity: 1,
      unitPrice: item.priceApplied,
      total: item.priceApplied,
      serviceId: item.serviceId,
      executorId: appointment.memberId,
      clubBenefitRequested,
      requestedClubPlanBenefitId,
    });
  }

  const comanda = await tx.comanda.create({
    data: {
      barbershopId: input.barbershopId,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      customerName: appointment.customer.name,
      customerPhone: appointment.customer.phone,
      status: "OPEN",
      openedAt: appointment.dateTime,
      createdAt: appointment.dateTime,
      items: {
        create: itemsToCreate,
      },
    },
  });

  return recalculateComandaTotals(tx, comanda.id);
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
    tx.comandaItem.findMany({
      where: { comandaId, status: { not: ComandaItemStatus.CANCELLED } },
      include: { clubBenefitUsage: true },
    }),
    tx.payment.findMany({ where: { comandaId, status: "CONFIRMED" } }),
  ]);

  const comanda = tx.comanda.findUnique
    ? await tx.comanda.findUnique({
        where: { id: comandaId },
        select: { customerId: true, barbershopId: true, createdAt: true },
      })
    : { customerId: null, barbershopId: "mock", createdAt: new Date() };
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);

  const regularItems = items.filter(
    (item) => item.type === "SERVICE" || item.type === "PRODUCT"
  );
  const discounts = items.filter((item) => item.type === "DISCOUNT");
  const surcharges = items.filter((item) => item.type === "SURCHARGE");

  // Sum raw subtotal
  const rawSubtotal = regularItems.reduce((sum, item) => sum + toCents(item.total), 0);

  // Load active subscription and benefits balance for preview
  const { getActiveCustomerClubSubscription, getClubBenefitsBalance } = await import("./club");
  const activeSub = comanda.customerId ? await getActiveCustomerClubSubscription({
    barbershopId: comanda.barbershopId,
    customerId: comanda.customerId,
    atDate: comanda.createdAt || new Date(),
    tx,
  }) : null;

  const balance = activeSub ? await getClubBenefitsBalance({
    barbershopId: comanda.barbershopId,
    subscriptionId: activeSub.id,
    atDate: comanda.createdAt || new Date(),
    tx,
  }) : null;

  // Sum active applied club benefit reductions (real + simulated preview)
  let clubReductions = 0;
  for (const item of regularItems) {
    const usage = item.clubBenefitUsage;
    if (usage && usage.status === "APPLIED") {
      const covered = usage.coveredAmount ? toCents(usage.coveredAmount) : 0;
      const discount = usage.discountAmount ? toCents(usage.discountAmount) : 0;
      clubReductions += covered + discount;
    } else if (item.clubBenefitRequested && item.requestedClubPlanBenefitId && balance) {
      const benefit = balance.benefits.find(b => b.id === item.requestedClubPlanBenefitId);
      if (benefit) {
        const isServiceMatch = item.type === "SERVICE" && benefit.serviceId === item.serviceId;
        const isProductMatch = item.type === "PRODUCT" && benefit.productId === item.productId;

        if (isServiceMatch || isProductMatch) {
          if (benefit.benefitType === "INCLUDED_SERVICE") {
            const canUseBenefit = benefit.isUnlimited || (benefit.availableQty && benefit.availableQty > 0);
            if (canUseBenefit) {
              clubReductions += toCents(item.total);
              if (!benefit.isUnlimited && benefit.availableQty) {
                benefit.availableQty--;
              }
            }
          } else {
            const pct = Number(benefit.discountPercent || 0);
            const original = toCents(item.total);
            const discount = Math.round((original * pct) / 100);
            clubReductions += discount;
          }
        }
      }
    }
  }

  const subtotal = Math.max(0, rawSubtotal - clubReductions);
  const discountTotal = discounts.reduce((sum, item) => sum + toCents(item.total), 0);
  const surchargeTotal = surcharges.reduce((sum, item) => sum + toCents(item.total), 0);
  const total = Math.max(0, subtotal - discountTotal + surchargeTotal);
  const paidTotal = payments.reduce((sum, payment) => sum + (toCents(payment.amount) - toCents(payment.refundedAmount || 0)), 0);
  
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

export async function reopenComanda(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId: string;
    reason: string;
    userId: string;
    memberId?: string | null;
  }
) {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new OperationalError(
      "REOPEN_REASON_REQUIRED",
      "Informe um motivo com pelo menos 5 caracteres para reabrir a comanda.",
      400
    );
  }

  const comanda = await tx.comanda.findFirst({
    where: { id: input.comandaId, barbershopId: input.barbershopId },
  });
  if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
  if (comanda.status === ComandaStatus.CANCELLED) {
    throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada nao pode ser reaberta.", 422);
  }
  if (comanda.status !== ComandaStatus.CLOSED) {
    throw new OperationalError("COMANDA_NOT_CLOSED", "Apenas comandas fechadas podem ser reabertas.", 422);
  }

  const payments = await tx.payment.findMany({
    where: { comandaId: input.comandaId, barbershopId: input.barbershopId, status: "CONFIRMED" },
  });
  const paidCents = payments.reduce(
    (sum, payment) => sum + Math.max(0, toCents(payment.amount) - toCents(payment.refundedAmount || 0)),
    0
  );
  const totalCents = toCents(comanda.total);
  if (totalCents < paidCents) {
    throw new OperationalError(
      "TOTAL_BELOW_PAID",
      "O total atual da comanda esta abaixo do valor ja pago.",
      422
    );
  }

  const remainingCents = Math.max(0, totalCents - paidCents);
  const newStatus = ComandaStatus.PENDING_PAYMENT;
  const reopened = await tx.comanda.update({
    where: { id: input.comandaId },
    data: {
      status: newStatus,
      closedAt: null,
      paidTotal: fromCents(paidCents),
      remainingTotal: fromCents(remainingCents),
    },
    include: comandaInclude,
  });

  await tx.comandaReopenAudit.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      reopenedByUserId: input.userId,
      reopenedByMemberId: input.memberId ?? null,
      reason,
      previousStatus: comanda.status,
      newStatus,
      previousTotal: comanda.total,
      previousPaidTotal: comanda.paidTotal,
      previousRemainingTotal: comanda.remainingTotal,
      newTotal: fromCents(totalCents),
      newPaidTotal: fromCents(paidCents),
      newRemainingTotal: fromCents(remainingCents),
    },
  });

  return reopened;
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
    clubBenefitRequested?: boolean;
    requestedClubPlanBenefitId?: string;
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
      clubBenefitRequested: input.clubBenefitRequested ?? false,
      requestedClubPlanBenefitId: input.requestedClubPlanBenefitId ?? null,
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
    clubBenefitRequested?: boolean;
    requestedClubPlanBenefitId?: string;
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
      clubBenefitRequested: input.clubBenefitRequested ?? false,
      requestedClubPlanBenefitId: input.requestedClubPlanBenefitId ?? null,
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

