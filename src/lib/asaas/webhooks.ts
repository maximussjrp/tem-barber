/**
 * Processador de Webhooks do Asaas para cobrança recorrente (SaaS Tem Barber).
 * Server-side apenas — nunca expor segredos.
 */

import { AsaasPaymentStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getPlanByCode } from "@/lib/billing/plans-db";
import {
  CandidatePaymentFacts,
  CandidateSubscriptionFacts,
  classifyPaymentFreshness,
  classifySubscriptionFreshness,
  extractAsaasEventId,
  mapAsaasPaymentStatus,
  mapAsaasSubscriptionStatus,
  parseAsaasSourceEventAt,
  parseBarbershopIdFromExternalReference,
  sanitizeAsaasPayloadForLog,
  StoredSubscriptionSnapshot,
} from "@/lib/asaas/mappers";
import { recomputeTenantSubscriptionFromPayments, StoredPaymentForRecompute } from "@/lib/asaas/entitlement";

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
    subscription?: string;
    asaasSubscriptionId?: string;
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
  let resolvedSubId: string | undefined;

  const claimed = await prisma.$transaction(async (tx) => {
    // 1. Reivindicação atômica de idempotência para compatibilidade de chamadas legadas
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
      return false;
    }

    // 2. Resolver o registro do pagamento local se existir
    const paymentRecord = await tx.asaasBillingPayment.findUnique({
      where: { asaasPaymentId },
      select: {
        asaasSubscriptionId: true,
        barbershopId: true,
      },
    });

    if (paymentRecord && paymentRecord.barbershopId !== barbershopId) {
      throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
    }

    // 3. Consistência estrita da identidade da assinatura (Payment -> Subscription)
    const rawCandidates = [
      paymentObj.subscription?.trim(),
      paymentObj.asaasSubscriptionId?.trim(),
      paymentRecord?.asaasSubscriptionId?.trim(),
    ].filter((s): s is string => Boolean(s && s.length > 0));

    const distinctSubIds = Array.from(new Set(rawCandidates));

    if (distinctSubIds.length > 1) {
      throw new Error("PAYMENT_SUBSCRIPTION_MISMATCH");
    }

    if (distinctSubIds.length === 0) {
      throw new Error("PAYMENT_MISSING_SUBSCRIPTION_ID");
    }

    resolvedSubId = distinctSubIds[0];

    // 4. Buscar a assinatura Asaas local
    const billingSub = await tx.asaasBillingSubscription.findUnique({
      where: { asaasSubscriptionId: resolvedSubId },
    });

    if (!billingSub) {
      throw new Error("ASAAS_BILLING_SUBSCRIPTION_NOT_FOUND");
    }

    if (billingSub.barbershopId !== barbershopId) {
      throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
    }

    if (!billingSub.planCode || !billingSub.planCode.trim()) {
      throw new Error("ASAAS_PLAN_CODE_MISSING");
    }

    const plan = await getPlanByCode(tx as any, billingSub.planCode.trim());
    if (!plan) {
      throw new Error("PLAN_CODE_NOT_FOUND");
    }

    const existingSub = await tx.tenantSubscription.findUnique({
      where: { barbershopId },
    });

    if (existingSub && existingSub.planId !== plan.id) {
      throw new Error("TENANT_PLAN_CODE_MISMATCH");
    }

    return true;
  });

  if (!claimed) return;

  const dueDate = paymentObj.dueDate ? new Date(paymentObj.dueDate) : null;
  const paymentDate = (paymentObj.paymentDate || paymentObj.clientPaymentDate) ? new Date((paymentObj.paymentDate || paymentObj.clientPaymentDate)!) : null;

  const fallbackCandidate: StoredPaymentForRecompute = {
    id: asaasPaymentId,
    asaasPaymentId,
    barbershopId,
    asaasSubscriptionId: resolvedSubId || null,
    status: "RECEIVED" as any,
    billingType: paymentObj.billingType || null,
    value: paymentObj.value ?? 0,
    dueDate,
    paymentDate,
    firstPositiveAt: paymentDate || dueDate || new Date(),
    createdAt: new Date(),
  };

  await recomputeTenantSubscriptionFromPayments(barbershopId, fallbackCandidate, resolvedSubId);
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
  const asaasEventId = extractAsaasEventId(payload);

  const paymentObj = payload.payment;
  const subscriptionObj = payload.subscription;

  const paymentId = paymentObj?.id || null;
  const subscriptionId = paymentObj?.subscription || subscriptionObj?.id || null;
  const customerId = paymentObj?.customer || subscriptionObj?.customer || null;
  const externalReference =
    paymentObj?.externalReference || subscriptionObj?.externalReference || null;

  let webhookRecord: { id: string; receivedAt: Date };
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
        select: { id: true, receivedAt: true },
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
        select: { id: true, receivedAt: true },
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
      select: { id: true, receivedAt: true },
    });
  }

  try {
    // 4. Tratar eventos PAYMENT_*
    if (eventName.startsWith("PAYMENT_") && paymentObj) {
      if (barbershopId) {
        const mappedStatus =
          eventName === "PAYMENT_DELETED"
            ? AsaasPaymentStatus.CANCELED
            : mapAsaasPaymentStatus(paymentObj.status);
        const paymentDateStr = paymentObj.paymentDate || paymentObj.clientPaymentDate || null;
        const sourceEventAt = parseAsaasSourceEventAt(payload.dateCreated);
        const sourceEventId = extractAsaasEventId(payload);

        // Envolver leitura de identidade, validação de imutabilidade e upsert do pagamento em transação atômica serializada por chave consultiva do pagamento
        const { classification, subIdToPersist, isCandidatePositive } = await prisma.$transaction(async (tx) => {
          if (typeof tx.$executeRaw === "function") {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentObj.id}, 1))`;
          }

          const existingPayment = await tx.asaasBillingPayment.findUnique({
            where: { asaasPaymentId: paymentObj.id },
            select: {
              id: true,
              barbershopId: true,
              asaasPaymentId: true,
              asaasSubscriptionId: true,
              asaasCustomerId: true,
              status: true,
              billingType: true,
              value: true,
              netValue: true,
              dueDate: true,
              paymentDate: true,
              invoiceUrl: true,
              bankSlipUrl: true,
              externalReference: true,
              sourceEventAt: true,
              sourceEventId: true,
              firstPositiveAt: true,
              createdAt: true,
            },
          });

          if (existingPayment?.barbershopId && existingPayment.barbershopId !== barbershopId) {
            throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
          }

          const incomingSubId = paymentObj.subscription?.trim();
          if (existingPayment?.asaasSubscriptionId) {
            if (incomingSubId && incomingSubId !== existingPayment.asaasSubscriptionId) {
              throw new Error("PAYMENT_SUBSCRIPTION_MISMATCH");
            }
          }

          const subIdToPersist = incomingSubId || existingPayment?.asaasSubscriptionId || null;

          const candidate: CandidatePaymentFacts = {
            barbershopId,
            asaasPaymentId: paymentObj.id,
            asaasSubscriptionId: subIdToPersist,
            asaasCustomerId: existingPayment ? existingPayment.asaasCustomerId : (paymentObj.customer || null),
            status: mappedStatus,
            billingType: paymentObj.billingType !== undefined ? (paymentObj.billingType || null) : (existingPayment?.billingType || null),
            value: paymentObj.value !== undefined ? (paymentObj.value ?? 0) : Number(existingPayment?.value ?? 0),
            netValue: paymentObj.netValue !== undefined ? (paymentObj.netValue ?? null) : (existingPayment?.netValue ? Number(existingPayment.netValue) : null),
            dueDate: paymentObj.dueDate !== undefined ? (paymentObj.dueDate ? new Date(paymentObj.dueDate) : null) : (existingPayment?.dueDate || null),
            paymentDate: paymentDateStr !== undefined ? (paymentDateStr ? new Date(paymentDateStr) : null) : (existingPayment?.paymentDate || null),
            invoiceUrl: paymentObj.invoiceUrl !== undefined ? (paymentObj.invoiceUrl || null) : (existingPayment?.invoiceUrl || null),
            bankSlipUrl: paymentObj.bankSlipUrl !== undefined ? (paymentObj.bankSlipUrl || null) : (existingPayment?.bankSlipUrl || null),
            externalReference: paymentObj.externalReference !== undefined ? (paymentObj.externalReference || null) : (existingPayment?.externalReference || null),
            sourceEventAt,
            sourceEventId,
          };

          const classification = classifyPaymentFreshness(existingPayment, candidate);

          if (classification === "CONFLICT") {
            throw new Error("PAYMENT_SOURCE_EVENT_CONFLICT");
          }

          const isCandidatePositive = ["RECEIVED", "CONFIRMED"].includes(mappedStatus);
          const isExistingPositive = existingPayment && ["RECEIVED", "CONFIRMED"].includes(existingPayment.status);
          const lazyFirstPositiveAt = isExistingPositive && existingPayment.firstPositiveAt === null
            ? (existingPayment.sourceEventAt ?? existingPayment.paymentDate ?? existingPayment.dueDate ?? existingPayment.createdAt)
            : null;

          const firstPositiveAtToSet = existingPayment?.firstPositiveAt ?? (
            (isCandidatePositive || lazyFirstPositiveAt !== null)
              ? (lazyFirstPositiveAt ?? sourceEventAt ?? candidate.paymentDate ?? candidate.dueDate ?? webhookRecord.receivedAt)
              : null
          );

          if (classification === "ACCEPT") {
            await tx.asaasBillingPayment.upsert({
              where: { asaasPaymentId: paymentObj.id },
              create: {
                barbershopId: candidate.barbershopId,
                asaasPaymentId: candidate.asaasPaymentId,
                asaasSubscriptionId: candidate.asaasSubscriptionId,
                asaasCustomerId: candidate.asaasCustomerId,
                status: candidate.status,
                billingType: candidate.billingType,
                value: candidate.value,
                netValue: candidate.netValue,
                dueDate: candidate.dueDate,
                paymentDate: candidate.paymentDate,
                invoiceUrl: candidate.invoiceUrl,
                bankSlipUrl: candidate.bankSlipUrl,
                externalReference: candidate.externalReference,
                sourceEventAt: candidate.sourceEventAt,
                sourceEventId: candidate.sourceEventId,
                firstPositiveAt: firstPositiveAtToSet || undefined,
                rawPayload: sanitizeAsaasPayloadForLog(paymentObj) as object,
              },
              update: {
                status: candidate.status,
                asaasSubscriptionId: candidate.asaasSubscriptionId || undefined,
                billingType: paymentObj.billingType || undefined,
                value: paymentObj.value ?? undefined,
                netValue: paymentObj.netValue ?? undefined,
                dueDate: paymentObj.dueDate ? new Date(paymentObj.dueDate) : undefined,
                paymentDate: paymentDateStr ? new Date(paymentDateStr) : undefined,
                invoiceUrl: paymentObj.invoiceUrl || undefined,
                bankSlipUrl: paymentObj.bankSlipUrl || undefined,
                externalReference: paymentObj.externalReference || undefined,
                sourceEventAt: candidate.sourceEventAt,
                sourceEventId: candidate.sourceEventId,
                firstPositiveAt: firstPositiveAtToSet || undefined,
                rawPayload: sanitizeAsaasPayloadForLog(paymentObj) as object,
              },
            });
          } else if (classification === "REPLAY_CURRENT" && isCandidatePositive && existingPayment?.firstPositiveAt === null && firstPositiveAtToSet) {
            await tx.asaasBillingPayment.update({
              where: { asaasPaymentId: paymentObj.id },
              data: { firstPositiveAt: firstPositiveAtToSet },
            });
          } else if (classification === "STALE" && isCandidatePositive && existingPayment?.firstPositiveAt === null && firstPositiveAtToSet) {
            await tx.asaasBillingPayment.update({
              where: { asaasPaymentId: paymentObj.id },
              data: {
                firstPositiveAt: firstPositiveAtToSet,
              },
            });
          }

          return { classification, subIdToPersist, isCandidatePositive };
        });

        const shouldRecomputeTenant = classification === "ACCEPT" || classification === "REPLAY_CURRENT" || (classification === "STALE" && isCandidatePositive);

        if (classification === "STALE" && !shouldRecomputeTenant) {
          await prisma.asaasWebhookEvent.update({
            where: { id: webhookRecord.id },
            data: {
              processingStatus: "PROCESSED",
              processedAt: new Date(),
            },
          });
          return { ok: true, ignored: true };
        }

        if (shouldRecomputeTenant) {
          const effectiveSubId = subIdToPersist || paymentObj.subscription;
          if (effectiveSubId) {
            const subRecord = await prisma.asaasBillingSubscription.findUnique({
              where: { asaasSubscriptionId: effectiveSubId },
            });

            if (subRecord && subRecord.barbershopId !== barbershopId) {
              throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
            }
          }

          await recomputeTenantSubscriptionFromPayments(barbershopId);
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
      const sourceEventAt = parseAsaasSourceEventAt((rawPayload as { dateCreated?: string })?.dateCreated);
      const sourceEventId = asaasEventId || null;
      const mappedSubStatus = mapAsaasSubscriptionStatus(subscriptionObj.status);
      const isDeleteEvent = eventName === "SUBSCRIPTION_DELETED";

      if (subscriptionObj.id) {
        const result = await prisma.$transaction(async (tx) => {
          // 1. Acquire subscription advisory lock in namespace 2
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subscriptionObj.id}, 2))`;

          // 2. Find stored subscription record
          const subRecord = await tx.asaasBillingSubscription.findUnique({
            where: { asaasSubscriptionId: subscriptionObj.id },
          });

          if (!subRecord) {
            return { classification: "STALE" as const };
          }

          if (subRecord.barbershopId !== barbershopId) {
            throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
          }

          // 3. Build candidate facts
          const candidate: CandidateSubscriptionFacts = {
            barbershopId,
            asaasSubscriptionId: subscriptionObj.id,
            asaasCustomerId: subscriptionObj.customer || subRecord.asaasCustomerId,
            planCode: subRecord.planCode,
            planName: subRecord.planName,
            value: subscriptionObj.value !== undefined ? Number(subscriptionObj.value) : Number(subRecord.value),
            cycle: subscriptionObj.cycle || subRecord.cycle,
            status: isDeleteEvent
              ? (mappedSubStatus === "UNKNOWN" ? subRecord.status : mappedSubStatus)
              : mappedSubStatus,
            nextDueDate: subscriptionObj.nextDueDate ? new Date(subscriptionObj.nextDueDate) : subRecord.nextDueDate,
            billingType: subscriptionObj.billingType || subRecord.billingType,
            externalReference: subscriptionObj.externalReference || subRecord.externalReference,
            canceledAt: isDeleteEvent
              ? (subRecord.canceledAt || sourceEventAt || webhookRecord.receivedAt)
              : subRecord.canceledAt,
            sourceEventAt,
            sourceEventId,
            isDeleteEvent,
          };

          const storedSnapshot: StoredSubscriptionSnapshot = {
            ...subRecord,
            value: Number(subRecord.value),
          };

          // 4. Classify freshness
          const classification = classifySubscriptionFreshness(storedSnapshot, candidate);

          if (classification === "CONFLICT") {
            throw new Error("SUBSCRIPTION_SOURCE_EVENT_CONFLICT");
          }

          if (classification === "ACCEPT") {
            await tx.asaasBillingSubscription.update({
              where: { id: subRecord.id },
              data: {
                status: candidate.status,
                nextDueDate: candidate.nextDueDate,
                billingType: candidate.billingType,
                value: candidate.value,
                canceledAt: candidate.canceledAt,
                sourceEventAt: candidate.sourceEventAt,
                sourceEventId: candidate.sourceEventId,
              },
            });
          }

          return { classification };
        });

        if (result.classification === "STALE") {
          await prisma.asaasWebhookEvent.update({
            where: { id: webhookRecord.id },
            data: {
              processingStatus: "PROCESSED",
              processedAt: new Date(),
            },
          });
          return { ok: true, ignored: true };
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
