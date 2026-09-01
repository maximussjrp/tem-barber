import { AsaasPaymentStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import prisma from "../prisma";
import { getPlanByCode } from "../billing/plans-db";

export function addCalendarMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();
  const targetMonth = result.getUTCMonth() + months;
  result.setUTCMonth(targetMonth);
  if (result.getUTCDate() !== originalDay) {
    result.setUTCDate(0);
  }
  return result;
}

export interface StoredPaymentForRecompute {
  id: string;
  asaasPaymentId: string;
  barbershopId: string;
  asaasSubscriptionId: string | null;
  status: AsaasPaymentStatus;
  billingType: string | null;
  value: unknown;
  dueDate: Date | null;
  paymentDate: Date | null;
  firstPositiveAt: Date | null;
  createdAt: Date;
}

/**
 * Resolve o contrato AsaasBillingSubscription atual da barbearia de forma 100% determinística:
 * Maior createdAt DESC, asaasSubscriptionId DESC.
 * NUNCA filtra por status ou canceledAt (2.3D cuidará de normalização de ciclo de vida).
 */
export async function resolveCurrentAsaasBillingSubscription(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  preferredSubId?: string | null
) {
  const subModel = tx.asaasBillingSubscription as any;
  if (typeof subModel?.findFirst === "function") {
    const found = await subModel.findFirst({
      where: { barbershopId },
      orderBy: [
        { createdAt: "desc" },
        { asaasSubscriptionId: "desc" },
      ],
    });
    if (found) return found;
  }

  if (preferredSubId && typeof subModel?.findUnique === "function") {
    try {
      const foundBySubId = await subModel.findUnique({
        where: { asaasSubscriptionId: preferredSubId },
      });
      if (foundBySubId) return foundBySubId;
    } catch {
      // ignore
    }
  }

  if (typeof subModel?.findUnique === "function") {
    try {
      const foundByShop = await subModel.findUnique({
        where: { barbershopId },
      });
      if (foundByShop) return foundByShop;
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Seleciona o pagamento vencedor elegível para concessão de acesso comercial:
 * Elegível se: status IN ['RECEIVED', 'CONFIRMED'] OR firstPositiveAt IS NOT NULL.
 * Ordenação estrita:
 * 1. dueDate DESC NULLS LAST
 * 2. paymentDate DESC NULLS LAST
 * 3. asaasPaymentId DESC
 */
export function selectEligiblePaymentWinner<T extends StoredPaymentForRecompute>(
  payments: T[]
): T | null {
  const positiveStatuses = new Set<string>([
    AsaasPaymentStatus.RECEIVED,
    AsaasPaymentStatus.CONFIRMED,
  ]);

  const eligible = payments.filter(
    (p) => positiveStatuses.has(p.status) || p.firstPositiveAt !== null
  );

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    // 1. dueDate DESC NULLS LAST
    const dueA = a.dueDate ? a.dueDate.getTime() : null;
    const dueB = b.dueDate ? b.dueDate.getTime() : null;
    if (dueA !== null && dueB !== null && dueA !== dueB) return dueB - dueA;
    if (dueA !== null && dueB === null) return -1;
    if (dueA === null && dueB !== null) return 1;

    // 2. paymentDate DESC NULLS LAST
    const payA = a.paymentDate ? a.paymentDate.getTime() : null;
    const payB = b.paymentDate ? b.paymentDate.getTime() : null;
    if (payA !== null && payB !== null && payA !== payB) return payB - payA;
    if (payA !== null && payB === null) return -1;
    if (payA === null && payB !== null) return 1;

    // 3. asaasPaymentId DESC
    return b.asaasPaymentId.localeCompare(a.asaasPaymentId);
  });

  return eligible[0];
}

/**
 * Preserva monotonicamente a data de término de acesso (currentPeriodEnd).
 * Um recálculo derivado de pagamento pode EXPANDIR o período de acesso,
 * mas NUNCA ENCURTAR uma expiração de acesso já concedida previamente (ex.: concessão manual/admin).
 */
export function resolveNonReducingPeriodEnd(
  existingPeriodEnd: Date | null | undefined,
  derivedPeriodEnd: Date | null | undefined
): Date | null {
  if (!existingPeriodEnd) {
    return derivedPeriodEnd ?? null;
  }
  if (!derivedPeriodEnd) {
    return existingPeriodEnd;
  }
  return existingPeriodEnd.getTime() > derivedPeriodEnd.getTime()
    ? existingPeriodEnd
    : derivedPeriodEnd;
}

import { deriveTenantDelinquencyState } from "../billing/delinquency";

function normalizeTime(date: Date | null | undefined): number | null {
  if (!date || isNaN(date.getTime())) return null;
  return date.getTime();
}

function normalizeDecimal(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && val !== null && "toString" in val) {
    return (val as any).toString();
  }
  return String(val);
}

/**
 * Reconciliador Unificado do Estado Financeiro do Tenant (Phase 2.3D2A).
 * Executa sob trava consultiva exclusiva por tenant no nível do TenantSubscription (TX2, Namespace 0).
 */
export async function reconcileTenantSubscriptionBillingState(
  barbershopId: string,
  fallbackPaymentCandidate?: StoredPaymentForRecompute | null,
  preferredSubId?: string | null,
  nowOptions?: Date
): Promise<{ recomputed: boolean; reason?: string; tenantSubscriptionStatus?: SubscriptionStatus }> {
  const now = nowOptions ?? new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Advisory Lock exclusivo no nível do Tenant (Namespace 0)
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${barbershopId}, 0))`;
    }

    // 2. Snapshot do TenantSubscription existente
    const existingSub = await tx.tenantSubscription.findUnique({
      where: { barbershopId },
    });

    // 3. Resolver contrato Asaas ativo atual
    const currentContract = await resolveCurrentAsaasBillingSubscription(tx, barbershopId, preferredSubId);
    if (!currentContract) {
      return { recomputed: false, reason: "NO_CONTRACT" };
    }

    if (!currentContract.planCode || !currentContract.planCode.trim()) {
      throw new Error("ASAAS_PLAN_CODE_MISSING");
    }

    const plan = await getPlanByCode(tx, currentContract.planCode.trim());
    if (!plan) {
      throw new Error("PLAN_CODE_NOT_FOUND");
    }

    // 4. Invariante PlanId em TenantSubscription existente (C2 Protection)
    if (existingSub) {
      if (existingSub.planId !== plan.id) {
        throw new Error("TENANT_PLAN_CODE_MISMATCH");
      }
    }

    // 5. Buscar pagamentos elegíveis do contrato atual
    let payments = await tx.asaasBillingPayment.findMany({
      where: {
        barbershopId,
        asaasSubscriptionId: currentContract.asaasSubscriptionId,
      },
      select: {
        id: true,
        asaasPaymentId: true,
        barbershopId: true,
        asaasSubscriptionId: true,
        status: true,
        billingType: true,
        value: true,
        dueDate: true,
        paymentDate: true,
        firstPositiveAt: true,
        createdAt: true,
      },
    });

    // Validar escopo do fallback payment candidate (se fornecido)
    if (payments.length === 0 && fallbackPaymentCandidate) {
      if (
        fallbackPaymentCandidate.barbershopId === barbershopId &&
        fallbackPaymentCandidate.asaasSubscriptionId === currentContract.asaasSubscriptionId
      ) {
        payments = [fallbackPaymentCandidate as any];
      }
    }

    // 6. C2 Eligible Winner & Engine de Delinquência Pura
    const winner = selectEligiblePaymentWinner(payments);
    const delinquencyResult = deriveTenantDelinquencyState({
      barbershopId,
      tenantSubscription: existingSub,
      currentContractAsaasSubscriptionId: currentContract.asaasSubscriptionId,
      payments,
      now,
    });

    // 7. Se não existir existingSub E não existir winner: NUNCA criar TenantSubscription
    if (!existingSub && !winner) {
      return { recomputed: false, reason: "NO_WINNER" };
    }

    // 8. Derivar datas comerciais
    let periodStart = existingSub?.currentPeriodStart ?? null;
    let periodEnd = existingSub?.currentPeriodEnd ?? null;
    let lastPaymentAt = existingSub?.lastPaymentAt ?? null;
    let lastAccessPaymentId = existingSub?.lastAccessPaymentId ?? null;
    let paymentMethod =
      existingSub?.paymentMethod ??
      winner?.billingType ??
      currentContract.billingType ??
      null;

    if (winner) {
      const derivedStart = winner.dueDate ?? winner.paymentDate ?? null;
      const derivedEnd = derivedStart ? addCalendarMonthsUTC(derivedStart, 1) : null;
      periodStart = derivedStart ?? periodStart;
      periodEnd = resolveNonReducingPeriodEnd(periodEnd, derivedEnd);
      lastPaymentAt = winner.paymentDate ?? winner.dueDate ?? lastPaymentAt;
      lastAccessPaymentId = winner.asaasPaymentId;
      paymentMethod = winner.billingType ?? currentContract.billingType ?? paymentMethod;
    }

    // 9. Status Priority Engine
    const hasValidPaidEntitlement = periodEnd !== null && periodEnd.getTime() > now.getTime();

    if (!existingSub && !hasValidPaidEntitlement) {
      return { recomputed: false, reason: "NO_VALID_ENTITLEMENT" };
    }

    let desiredStatus: SubscriptionStatus;
    let desiredGracePeriodEndsAt: Date | null = null;

    if (existingSub?.status === "TRIAL" && existingSub.trialEndsAt && existingSub.trialEndsAt.getTime() > now.getTime()) {
      desiredStatus = "TRIAL";
      desiredGracePeriodEndsAt = null;
    } else if (delinquencyResult.hasActiveDebt && delinquencyResult.desiredDelinquencyStatus === "SUSPENDED") {
      desiredStatus = "SUSPENDED";
      desiredGracePeriodEndsAt = delinquencyResult.gracePeriodEndsAt;
    } else if (delinquencyResult.hasActiveDebt && delinquencyResult.desiredDelinquencyStatus === "PAST_DUE") {
      desiredStatus = "PAST_DUE";
      desiredGracePeriodEndsAt = delinquencyResult.gracePeriodEndsAt;
    } else if (hasValidPaidEntitlement) {
      desiredStatus = "ACTIVE";
      desiredGracePeriodEndsAt = null;
    } else if (existingSub?.status === "PAST_DUE" || existingSub?.status === "SUSPENDED") {
      desiredStatus = "EXPIRED";
      desiredGracePeriodEndsAt = null;
    } else if (existingSub) {
      desiredStatus = existingSub.status ?? "ACTIVE";
      desiredGracePeriodEndsAt = null;
    } else {
      return { recomputed: false, reason: "NO_VALID_ENTITLEMENT" };
    }

    // 10. Conditional Update (Exact 9 Fields Equality)
    const desiredState = {
      status: desiredStatus,
      planName: currentContract.planName,
      monthlyPrice: currentContract.value,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      gracePeriodEndsAt: desiredGracePeriodEndsAt,
      paymentMethod,
      lastPaymentAt,
      lastAccessPaymentId,
    };

    if (existingSub) {
      const isSemanticallyEqual =
        existingSub.status === desiredState.status &&
        existingSub.planName === desiredState.planName &&
        normalizeDecimal(existingSub.monthlyPrice) === normalizeDecimal(desiredState.monthlyPrice) &&
        normalizeTime(existingSub.currentPeriodStart) === normalizeTime(desiredState.currentPeriodStart) &&
        normalizeTime(existingSub.currentPeriodEnd) === normalizeTime(desiredState.currentPeriodEnd) &&
        normalizeTime(existingSub.gracePeriodEndsAt) === normalizeTime(desiredState.gracePeriodEndsAt) &&
        existingSub.paymentMethod === desiredState.paymentMethod &&
        normalizeTime(existingSub.lastPaymentAt) === normalizeTime(desiredState.lastPaymentAt) &&
        existingSub.lastAccessPaymentId === desiredState.lastAccessPaymentId;

      if (isSemanticallyEqual) {
        return { recomputed: true, reason: "IDEMPOTENT_NO_CHANGE", tenantSubscriptionStatus: existingSub.status };
      }

      await tx.tenantSubscription.update({
        where: { id: existingSub.id },
        data: desiredState,
      });

      return { recomputed: true, tenantSubscriptionStatus: desiredStatus };
    } else {
      await tx.tenantSubscription.create({
        data: {
          barbershopId,
          planId: plan.id,
          ...desiredState,
        },
      });

      return { recomputed: true, tenantSubscriptionStatus: desiredStatus };
    }
  });
}

/**
 * Alias de compatibilidade com C2 (Phase 2.3C2).
 */
export async function recomputeTenantSubscriptionFromPayments(
  barbershopId: string,
  fallbackPaymentCandidate?: StoredPaymentForRecompute | null,
  preferredSubId?: string | null
): Promise<{ recomputed: boolean; reason?: string }> {
  return await reconcileTenantSubscriptionBillingState(barbershopId, fallbackPaymentCandidate, preferredSubId);
}
