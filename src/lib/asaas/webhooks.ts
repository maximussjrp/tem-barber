/**
 * Processador de Webhooks do Asaas para cobrança recorrente (SaaS Tem Barber).
 * Server-side apenas — nunca expor segredos.
 */

import prisma from "@/lib/prisma";
import {
  mapAsaasPaymentStatus,
  mapAsaasSubscriptionStatus,
  parseBarbershopIdFromExternalReference,
  sanitizeAsaasPayloadForLog,
} from "@/lib/asaas/mappers";

export interface AsaasWebhookPayload {
  id?: string;
  eventId?: string;
  event?: string;
  dateCreated?: string;
  payment?: {
    id: string;
    customer?: string;
    subscription?: string;
    value?: number;
    netValue?: number;
    billingType?: string;
    status?: string;
    dueDate?: string;
    paymentDate?: string;
    clientPaymentDate?: string;
    invoiceUrl?: string;
    bankSlipUrl?: string;
    externalReference?: string;
    [key: string]: unknown;
  };
  subscription?: {
    id: string;
    customer?: string;
    value?: number;
    nextDueDate?: string;
    cycle?: string;
    billingType?: string;
    status?: string;
    externalReference?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ProcessWebhookResult {
  ok: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  eventId?: string;
  error?: string;
}

/**
 * Adiciona meses de forma calendário preservando finais de mês.
 * Ex:
 * 25/07/2026 -> 25/08/2026
 * 31/01/2026 -> 28/02/2026
 * 31/01/2028 -> 29/02/2028
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getDate();
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  if (result.getDate() !== originalDay) {
    result.setDate(0);
  }
  return result;
}

export async function syncTenantSubscriptionAccessOnPayment(
  barbershopId: string,
  paymentObj: {
    id?: string;
    asaasPaymentId?: string;
    billingType?: string;
    value?: number;
    dueDate?: string | Date | null;
    paymentDate?: string | Date | null;
    clientPaymentDate?: string | Date | null;
  }
): Promise<void> {
  const asaasPaymentId = paymentObj.id || paymentObj.asaasPaymentId;
  if (!asaasPaymentId || !barbershopId) return;

  const now = new Date();

  // Resolver data âncora: dueDate -> paymentDate/clientPaymentDate -> now
  let anchorDate: Date;
  if (paymentObj.dueDate) {
    anchorDate = new Date(paymentObj.dueDate);
  } else if (paymentObj.paymentDate || paymentObj.clientPaymentDate) {
    anchorDate = new Date(paymentObj.paymentDate || paymentObj.clientPaymentDate!);
  } else {
    anchorDate = now;
  }

  if (isNaN(anchorDate.getTime())) {
    anchorDate = now;
  }

  const periodStart = anchorDate;
  const periodEnd = addCalendarMonths(anchorDate, 1);

  await prisma.$transaction(async (tx) => {
    const updateResult = await tx.asaasBillingPayment.updateMany({
      where: {
        asaasPaymentId,
        barbershopId,
        accessAppliedAt: null,
      },
      data: {
        accessAppliedAt: now,
      },
    });

    if (updateResult.count === 0) {
      return;
    }

    const plan = await tx.plan.findFirst({
      where: { isActive: true },
    });

    if (!plan) {
      throw new Error("PLANO_ATIVO_NAO_ENCONTRADO");
    }

    const existingSub = await tx.tenantSubscription.findFirst({
      where: { barbershopId },
      orderBy: { createdAt: "desc" },
    });

    if (existingSub) {
      await tx.tenantSubscription.update({
        where: { id: existingSub.id },
        data: {
          status: "ACTIVE",
          planName: "Plano Tem Barber",
          monthlyPrice: paymentObj.value ?? 49.9,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: null,
          paymentMethod: paymentObj.billingType || existingSub.paymentMethod,
          lastPaymentAt: now,
          lastAccessPaymentId: asaasPaymentId,
        },
      });
    } else {
      await tx.tenantSubscription.create({
        data: {
          barbershopId,
          planId: plan.id,
          status: "ACTIVE",
          planName: "Plano Tem Barber",
          monthlyPrice: paymentObj.value ?? 49.9,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: null,
          paymentMethod: paymentObj.billingType || "PIX",
          lastPaymentAt: now,
          lastAccessPaymentId: asaasPaymentId,
        },
      });
    }
  });
}

/**
 * Tenta localizar a barbearia associada ao evento do webhook.
 */
export async function locateBarbershopForWebhook(
  payload: AsaasWebhookPayload
): Promise<string | null> {
  const { payment, subscription } = payload;

  const extRef =
    payment?.externalReference ||
    subscription?.externalReference ||
    (typeof payload.externalReference === "string" ? payload.externalReference : null);

  const barbershopIdFromRef = parseBarbershopIdFromExternalReference(extRef);
  if (barbershopIdFromRef) {
    const exists = await prisma.barbershop.findUnique({
      where: { id: barbershopIdFromRef },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  const subId = payment?.subscription || subscription?.id;
  if (subId) {
    const subRecord = await prisma.asaasBillingSubscription.findUnique({
      where: { asaasSubscriptionId: subId },
      select: { barbershopId: true },
    });
    if (subRecord) return subRecord.barbershopId;
  }

  const custId = payment?.customer || subscription?.customer;
  if (custId) {
    const custRecord = await prisma.asaasBillingCustomer.findUnique({
      where: { asaasCustomerId: custId },
      select: { barbershopId: true },
    });
    if (custRecord) return custRecord.barbershopId;
  }

  return null;
}

/**
 * Processa um payload de webhook do Asaas de forma idempotente.
 */
export async function processAsaasWebhookPayload(
  rawPayload: unknown
): Promise<ProcessWebhookResult> {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, error: "INVALID_PAYLOAD" };
  }

  const payload = rawPayload as AsaasWebhookPayload;
  const eventName = payload.event || "UNKNOWN_EVENT";
  const asaasEventId = payload.id || payload.eventId || null;

  const paymentObj = payload.payment;
  const subscriptionObj = payload.subscription;

  const paymentId = paymentObj?.id || null;
  const subscriptionId = paymentObj?.subscription || subscriptionObj?.id || null;
  const customerId = paymentObj?.customer || subscriptionObj?.customer || null;
  const externalReference =
    paymentObj?.externalReference || subscriptionObj?.externalReference || null;

  let webhookRecord: { id: string };
  if (asaasEventId) {
    const existingEvent = await prisma.asaasWebhookEvent.findFirst({
      where: {
        asaasEventId,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, processingStatus: true },
    });

    if (
      existingEvent &&
      ["PROCESSED", "IGNORED", "PENDING"].includes(existingEvent.processingStatus)
    ) {
      return { ok: true, duplicate: true, eventId: asaasEventId };
    }
  }

  const barbershopId = await locateBarbershopForWebhook(payload);
  const sanitizedPayload = sanitizeAsaasPayloadForLog(payload);

  if (asaasEventId) {
    const failedEvent = await prisma.asaasWebhookEvent.findFirst({
      where: {
        asaasEventId,
        processingStatus: "FAILED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (failedEvent) {
      webhookRecord = await prisma.asaasWebhookEvent.update({
        where: { id: failedEvent.id },
        data: {
          event: eventName,
          paymentId,
          subscriptionId,
          customerId,
          externalReference,
          barbershopId,
          payload: sanitizedPayload as object,
          processingStatus: "PENDING",
          processingError: null,
          processedAt: null,
        },
        select: { id: true },
      });
    } else {
      webhookRecord = await prisma.asaasWebhookEvent.create({
        data: {
          event: eventName,
          asaasEventId,
          paymentId,
          subscriptionId,
          customerId,
          externalReference,
          barbershopId,
          payload: sanitizedPayload as object,
          processingStatus: "PENDING",
        },
        select: { id: true },
      });
    }
  } else {
    webhookRecord = await prisma.asaasWebhookEvent.create({
      data: {
        event: eventName,
        asaasEventId,
        paymentId,
        subscriptionId,
        customerId,
        externalReference,
        barbershopId,
        payload: sanitizedPayload as object,
        processingStatus: "PENDING",
      },
      select: { id: true },
    });
  }

  try {
    // 4. Tratar eventos PAYMENT_*
    if (eventName.startsWith("PAYMENT_") && paymentObj) {
      if (barbershopId) {
        const mappedStatus = mapAsaasPaymentStatus(paymentObj.status);
        const paymentDateStr = paymentObj.paymentDate || paymentObj.clientPaymentDate || null;

        await prisma.asaasBillingPayment.upsert({
          where: { asaasPaymentId: paymentObj.id },
          create: {
            barbershopId,
            asaasPaymentId: paymentObj.id,
            asaasSubscriptionId: paymentObj.subscription || null,
            asaasCustomerId: paymentObj.customer || null,
            status: mappedStatus,
            billingType: paymentObj.billingType || null,
            value: paymentObj.value ?? 0,
            netValue: paymentObj.netValue ?? null,
            dueDate: paymentObj.dueDate ? new Date(paymentObj.dueDate) : null,
            paymentDate: paymentDateStr ? new Date(paymentDateStr) : null,
            invoiceUrl: paymentObj.invoiceUrl || null,
            bankSlipUrl: paymentObj.bankSlipUrl || null,
            externalReference: paymentObj.externalReference || null,
            rawPayload: sanitizeAsaasPayloadForLog(paymentObj) as object,
          },
          update: {
            status: mappedStatus,
            billingType: paymentObj.billingType || undefined,
            value: paymentObj.value ?? undefined,
            netValue: paymentObj.netValue ?? undefined,
            dueDate: paymentObj.dueDate ? new Date(paymentObj.dueDate) : undefined,
            paymentDate: paymentDateStr ? new Date(paymentDateStr) : undefined,
            invoiceUrl: paymentObj.invoiceUrl || undefined,
            bankSlipUrl: paymentObj.bankSlipUrl || undefined,
            externalReference: paymentObj.externalReference || undefined,
            rawPayload: sanitizeAsaasPayloadForLog(paymentObj) as object,
          },
        });

        if (paymentObj.subscription) {
          const subRecord = await prisma.asaasBillingSubscription.findUnique({
            where: { asaasSubscriptionId: paymentObj.subscription },
          });

          if (subRecord) {
            let newSubStatus = subRecord.status;
            if (["RECEIVED", "CONFIRMED"].includes(mappedStatus)) {
              newSubStatus = "ACTIVE";
            } else if (mappedStatus === "OVERDUE") {
              newSubStatus = "OVERDUE";
            }

            await prisma.asaasBillingSubscription.update({
              where: { id: subRecord.id },
              data: {
                status: newSubStatus,
                billingType: paymentObj.billingType || subRecord.billingType,
              },
            });
          }
        }

        if (["RECEIVED", "CONFIRMED"].includes(mappedStatus)) {
          await syncTenantSubscriptionAccessOnPayment(barbershopId, paymentObj);
        }
      }

      await prisma.asaasWebhookEvent.update({
        where: { id: webhookRecord.id },
        data: {
          processingStatus: "PROCESSED",
          processedAt: new Date(),
        },
      });

      return { ok: true };
    }

    // 5. Tratar eventos SUBSCRIPTION_*
    if (eventName.startsWith("SUBSCRIPTION_") && subscriptionObj) {
      const mappedSubStatus = mapAsaasSubscriptionStatus(subscriptionObj.status);

      if (subscriptionObj.id) {
        const subRecord = await prisma.asaasBillingSubscription.findUnique({
          where: { asaasSubscriptionId: subscriptionObj.id },
        });

        if (subRecord) {
          await prisma.asaasBillingSubscription.update({
            where: { id: subRecord.id },
            data: {
              status: mappedSubStatus,
              nextDueDate: subscriptionObj.nextDueDate
                ? new Date(subscriptionObj.nextDueDate)
                : subRecord.nextDueDate,
              billingType: subscriptionObj.billingType || subRecord.billingType,
              value: subscriptionObj.value ?? subRecord.value,
              canceledAt:
                mappedSubStatus === "CANCELED" || eventName === "SUBSCRIPTION_DELETED"
                  ? new Date()
                  : subRecord.canceledAt,
            },
          });
        }
      }

      await prisma.asaasWebhookEvent.update({
        where: { id: webhookRecord.id },
        data: {
          processingStatus: "PROCESSED",
          processedAt: new Date(),
        },
      });

      return { ok: true };
    }

    await prisma.asaasWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: "IGNORED",
        processedAt: new Date(),
      },
    });

    return { ok: true, ignored: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro interno no processamento";

    await prisma.asaasWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: "FAILED",
        processingError: errorMsg,
        processedAt: new Date(),
      },
    });

    return { ok: true, error: errorMsg };
  }
}
