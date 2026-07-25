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
 * Tenta localizar a barbearia associada ao evento do webhook.
 */
export async function locateBarbershopForWebhook(
  payload: AsaasWebhookPayload
): Promise<string | null> {
  const { payment, subscription } = payload;

  // 1. Tentar externalReference no payment, subscription ou raiz
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

  // 2. Tentar por asaasSubscriptionId
  const subId = payment?.subscription || subscription?.id;
  if (subId) {
    const subRecord = await prisma.asaasBillingSubscription.findUnique({
      where: { asaasSubscriptionId: subId },
      select: { barbershopId: true },
    });
    if (subRecord) return subRecord.barbershopId;
  }

  // 3. Tentar por asaasCustomerId
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

  // 1. Checar idempotência por evento Asaas.
  // Eventos em estado final ou em processamento não devem gerar novo registro.
  // FAILED pode ser reprocessado, mas reutilizando o mesmo registro para evitar duplicação ilimitada.
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

  // 2. Localizar barbearia se possível
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

        // Se houver subscription associada, atualizar status informativo
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

    // 6. Evento Desconhecido ou não mapeado
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

    // Retorna ok: true tolerante para não travar a fila do webhook do Asaas
    return { ok: true, error: errorMsg };
  }
}
