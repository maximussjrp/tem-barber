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
import { ensureAsaasCustomerForBarbershop } from "@/lib/asaas/customers";
import { getBillingPlanByCode, isAllowedBillingType } from "@/lib/billing/plans";
import type { AllowedBillingType } from "@/lib/billing/plans";

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
 */
export async function createAsaasSubscriptionForBarbershop(
  input: CreateSubscriptionInput
): Promise<CreateSubscriptionResult> {
  const { barbershopId, planCode, billingType } = input;

  // 1. Validar plano
  const plan = getBillingPlanByCode(planCode);
  if (!plan) {
    throw new SubscriptionValidationError("INVALID_PLAN", `Plano "${planCode}" não encontrado ou inativo.`);
  }

  // 2. Validar billingType
  if (!isAllowedBillingType(billingType)) {
    throw new SubscriptionValidationError(
      "INVALID_BILLING_TYPE",
      `Tipo de cobrança "${billingType}" não permitido. Permitidos: PIX, BOLETO.`
    );
  }

  // 3. Garantir customer Asaas
  const customerResult = await ensureAsaasCustomerForBarbershop(barbershopId);

  // 4. Verificar se já existe assinatura ativa local para este barbershop
  const existingSubscription = await prisma.asaasBillingSubscription.findFirst({
    where: {
      barbershopId,
      status: { in: ["ACTIVE", "OVERDUE"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingSubscription) {
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

  // 5. Calcular nextDueDate (próximo dia útil ou amanhã)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDueDate = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD

  const externalReference = buildAsaasSubscriptionExternalReference(barbershopId, planCode);

  // 6. Criar assinatura no Asaas
  const asaasPayload = {
    customer: customerResult.asaasCustomerId,
    billingType: billingType as AllowedBillingType,
    value: plan.value,
    nextDueDate,
    cycle: "MONTHLY",
    description: `${plan.name} — Tem Barber`,
    externalReference,
  };

  const asaasResponse = await asaasFetch<AsaasSubscriptionResponse>("/subscriptions", {
    method: "POST",
    body: JSON.stringify(asaasPayload),
  });

  // 7. Salvar localmente
  const saved = await prisma.asaasBillingSubscription.create({
    data: {
      barbershopId,
      asaasSubscriptionId: asaasResponse.id,
      asaasCustomerId: customerResult.asaasCustomerId,
      planCode: plan.code,
      planName: plan.name,
      value: plan.value,
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
}

/**
 * Erro de validação de assinatura (plano/billingType inválido).
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
