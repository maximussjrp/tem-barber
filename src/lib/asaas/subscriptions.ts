/**
 * Gerenciamento de assinaturas Asaas para cobrança de planos do Tem Barber.
 * Server-side apenas — nunca importar no client.
 */

import prisma from "@/lib/prisma";
import { asaasFetch } from "@/lib/asaas/client";
import {
  buildAsaasSubscriptionExternalReference,
  mapAsaasSubscriptionStatus,
} from "@/lib/asaas/mappers";
import {
  ensureAsaasCustomerForBarbershop,
  AsaasCustomerReconciliationError,
} from "@/lib/asaas/customers";
import {
  ACTIVE_BILLING_PLAN_CODE,
  getBillingPlanByCode,
  isAllowedBillingType,
} from "@/lib/billing/plans";
import type { AllowedBillingType } from "@/lib/billing/plans";
import {
  assertCommercialConsistency,
  getActivePlanByCode,
  PlanResolutionError,
} from "@/lib/billing/plans-db";
import { resolveCurrentBillableAsaasSubscription } from "@/lib/billing/current-contract";

export function formatCivilDateSaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;

  return `${year}-${month}-${day}`;
}

export function getTomorrowCivilDateSaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);

  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);

  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return formatCivilDateSaoPaulo(tomorrow);
}

export function calculateSubscriptionNextDueDate(
  tenantSub?: { status?: string | null; trialEndsAt?: Date | string | null } | null,
  now: Date = new Date()
): string {
  if (tenantSub?.status === "TRIAL" && tenantSub.trialEndsAt) {
    const trialDate = new Date(tenantSub.trialEndsAt);
    if (!isNaN(trialDate.getTime()) && trialDate.getTime() > now.getTime()) {
      return formatCivilDateSaoPaulo(trialDate);
    }
  }
  return getTomorrowCivilDateSaoPaulo(now);
}

interface AsaasSubscriptionResponse {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  description?: string;
  status: string;
  externalReference?: string;
}

export interface CreateSubscriptionInput {
  barbershopId: string;
  planCode: string;
  billingType: string;
}

export interface CreateSubscriptionResult {
  customer: {
    id: string;
    asaasCustomerId: string;
    name: string;
    created: boolean;
  };
  subscription: {
    id: string;
    asaasSubscriptionId: string;
    planCode: string;
    planName: string;
    value: string;
    cycle: string;
    status: string;
    billingType: string;
    nextDueDate: string | null;
    externalReference: string;
  };
  alreadyExisted: boolean;
}

/**
 * Cria (ou reutiliza) uma assinatura Asaas para cobrança do plano de uma barbearia.
 * Utiliza lock PostgreSQL dedicado (advisory lock) por tenant para serializar customer + subscription.
 */
export async function createAsaasSubscriptionForBarbershop(
  input: CreateSubscriptionInput
): Promise<CreateSubscriptionResult> {
  const { barbershopId, planCode, billingType } = input;

  // 1. Validar plano no catálogo em código (TS)
  if (planCode !== ACTIVE_BILLING_PLAN_CODE) {
    throw new SubscriptionValidationError(
      "INVALID_PLAN",
      `Plano "${planCode}" nao esta disponivel para contratacao.`
    );
  }

  const catalogPlan = getBillingPlanByCode(planCode);
  if (!catalogPlan) {
    throw new SubscriptionValidationError(
      "INVALID_PLAN",
      `Plano "${planCode}" não encontrado ou inativo.`
    );
  }

  // 2. Validar plano no banco de dados e consistência comercial ANTES de qualquer chamada externa
  try {
    const dbPlan = await getActivePlanByCode(prisma, planCode);
    assertCommercialConsistency(catalogPlan, dbPlan);
  } catch (err) {
    if (err instanceof PlanResolutionError) {
      throw new SubscriptionValidationError(err.code, err.message);
    }
    throw err;
  }

  // 3. Validar billingType
  if (!isAllowedBillingType(billingType)) {
    throw new SubscriptionValidationError(
      "INVALID_BILLING_TYPE",
      `Tipo de cobrança "${billingType}" não permitido. Permitidos: PIX, BOLETO.`
    );
  }

  // 4. Executar fluxo exclusivo protegido por advisory lock por tenant
  return await prisma.$transaction(
    async (tx) => {
      // Advisory lock dedicado por tenant
      if ("$executeRaw" in tx && typeof tx.$executeRaw === "function") {
        const lockKey = `asaas-billing-create:${barbershopId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      }

      // 4.1 Verificar se já existe contrato billable localmente
      const localResolution = await resolveCurrentBillableAsaasSubscription(tx, barbershopId);

      if (localResolution.status === "RECONCILIATION_REQUIRED") {
        throw new SubscriptionValidationError(
          "BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED",
          "Existe mais de uma assinatura ativa/vencida para esta barbearia. Reconciliação necessária."
        );
      }

      if (localResolution.status === "FOUND") {
        const existingSubscription = localResolution.subscription;
        const customerResult = await ensureAsaasCustomerForBarbershop(barbershopId, tx);

        return {
          customer: {
            id: customerResult.customerId,
            asaasCustomerId: customerResult.asaasCustomerId,
            name: customerResult.name,
            created: customerResult.created,
          },
          subscription: {
            id: existingSubscription.id,
            asaasSubscriptionId: existingSubscription.asaasSubscriptionId,
            planCode: existingSubscription.planCode,
            planName: existingSubscription.planName,
            value: existingSubscription.value.toString(),
            cycle: existingSubscription.cycle,
            status: existingSubscription.status,
            billingType: existingSubscription.billingType ?? billingType,
            nextDueDate: existingSubscription.nextDueDate?.toISOString() ?? null,
            externalReference: existingSubscription.externalReference,
          },
          alreadyExisted: true,
        };
      }

      // 4.2 Garantir customer Asaas
      let customerResult;
      try {
        customerResult = await ensureAsaasCustomerForBarbershop(barbershopId, tx);
      } catch (err) {
        if (err instanceof AsaasCustomerReconciliationError) {
          throw new SubscriptionValidationError(err.code, err.message);
        }
        throw err;
      }

      // 4.3 Consultar Asaas remotamente para assinaturas ativas antes de qualquer criação
      const externalReference = buildAsaasSubscriptionExternalReference(barbershopId, planCode);
      const queryParams = new URLSearchParams({
        customer: customerResult.asaasCustomerId,
        status: "ACTIVE",
      });

      const remoteSubsRes = await asaasFetch<{ data?: AsaasSubscriptionResponse[] }>(
        `/subscriptions?${queryParams.toString()}`
      );
      const remoteSubs = remoteSubsRes?.data ?? [];

      const activeSubs = remoteSubs.filter((s) => {
        if (!s.id) return false;
        return mapAsaasSubscriptionStatus(s.status) === "ACTIVE";
      });

      const exactMatches = activeSubs.filter(
        (s) =>
          s.customer === customerResult.asaasCustomerId &&
          s.externalReference === externalReference
      );
      const foreignActive = activeSubs.filter(
        (s) =>
          s.customer !== customerResult.asaasCustomerId ||
          s.externalReference !== externalReference
      );

      if (exactMatches.length > 1 || foreignActive.length > 0) {
        throw new SubscriptionValidationError(
          "ASAAS_SUBSCRIPTION_RECONCILIATION_REQUIRED",
          "Existe assinatura remota ativa divergente ou ambígua no Asaas. Reconciliação necessária."
        );
      }

      if (exactMatches.length === 1) {
        const remoteSub = exactMatches[0];
        const saved = await tx.asaasBillingSubscription.create({
          data: {
            barbershopId,
            asaasSubscriptionId: remoteSub.id,
            asaasCustomerId: customerResult.asaasCustomerId,
            planCode: catalogPlan.code,
            planName: catalogPlan.name,
            value: remoteSub.value ? Number(remoteSub.value) : catalogPlan.value,
            cycle: "MONTHLY",
            status: mapAsaasSubscriptionStatus(remoteSub.status),
            nextDueDate: remoteSub.nextDueDate ? new Date(remoteSub.nextDueDate) : null,
            billingType: remoteSub.billingType || billingType,
            externalReference: remoteSub.externalReference || externalReference,
          },
        });

        return {
          customer: {
            id: customerResult.customerId,
            asaasCustomerId: customerResult.asaasCustomerId,
            name: customerResult.name,
            created: customerResult.created,
          },
          subscription: {
            id: saved.id,
            asaasSubscriptionId: saved.asaasSubscriptionId,
            planCode: saved.planCode,
            planName: saved.planName,
            value: saved.value.toString(),
            cycle: saved.cycle,
            status: saved.status,
            billingType: saved.billingType ?? billingType,
            nextDueDate: saved.nextDueDate?.toISOString() ?? null,
            externalReference: saved.externalReference,
          },
          alreadyExisted: true,
        };
      }

      // 4.4 Calcular primeiro vencimento respeitando o período de teste
      const tenantSub = await tx.tenantSubscription.findUnique({
        where: { barbershopId },
      });
      const nextDueDate = calculateSubscriptionNextDueDate(tenantSub);

      // 4.5 Criar nova assinatura no Asaas
      const asaasPayload = {
        customer: customerResult.asaasCustomerId,
        billingType: billingType as AllowedBillingType,
        value: catalogPlan.value,
        nextDueDate,
        cycle: "MONTHLY",
        description: `${catalogPlan.name} — Tem Barber`,
        externalReference,
      };

      const asaasResponse = await asaasFetch<AsaasSubscriptionResponse>("/subscriptions", {
        method: "POST",
        body: JSON.stringify(asaasPayload),
      });

      if (!asaasResponse.id) {
        throw new Error("Resposta inválida do Asaas ao criar assinatura (id ausente).");
      }

      // 4.6 Salvar localmente
      const saved = await tx.asaasBillingSubscription.create({
        data: {
          barbershopId,
          asaasSubscriptionId: asaasResponse.id,
          asaasCustomerId: customerResult.asaasCustomerId,
          planCode: catalogPlan.code,
          planName: catalogPlan.name,
          value: catalogPlan.value,
          cycle: "MONTHLY",
          status: mapAsaasSubscriptionStatus(asaasResponse.status),
          nextDueDate: asaasResponse.nextDueDate ? new Date(asaasResponse.nextDueDate) : null,
          billingType,
          externalReference,
        },
      });

      return {
        customer: {
          id: customerResult.customerId,
          asaasCustomerId: customerResult.asaasCustomerId,
          name: customerResult.name,
          created: customerResult.created,
        },
        subscription: {
          id: saved.id,
          asaasSubscriptionId: saved.asaasSubscriptionId,
          planCode: saved.planCode,
          planName: saved.planName,
          value: saved.value.toString(),
          cycle: saved.cycle,
          status: saved.status,
          billingType: saved.billingType ?? billingType,
          nextDueDate: saved.nextDueDate?.toISOString() ?? null,
          externalReference: saved.externalReference,
        },
        alreadyExisted: false,
      };
    },
    {
      maxWait: 10000,
      timeout: 30000,
    }
  );
}

/**
 * Erro de validação de assinatura (plano/billingType inválido ou reconciliação).
 */
export class SubscriptionValidationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "SubscriptionValidationError";
  }
}