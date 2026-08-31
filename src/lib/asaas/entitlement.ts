import { AsaasPaymentStatus, Prisma } from "@prisma/client";
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

/**
 * Motor de Recálculo Determinístico de Direito de Acesso do Tenant (Phase 2.3C2).
 * Executa sob trava consultiva exclusiva por tenant no nível do TenantSubscription (TX2).
 */
export async function recomputeTenantSubscriptionFromPayments(
  barbershopId: string,
  fallbackPaymentCandidate?: StoredPaymentForRecompute | null,
  preferredSubId?: string | null
): Promise<{ recomputed: boolean; reason?: string }> {
  return await prisma.$transaction(async (tx) => {
    // 1. Trava consultiva exclusiva no nível do Tenant
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${barbershopId}, 0))`;
    }

    // 2. Resolver o contrato remoto Asaas atual da barbearia
    const currentContract = await resolveCurrentAsaasBillingSubscription(tx, barbershopId, preferredSubId);
    if (!currentContract) {
      return { recomputed: false, reason: "NO_CONTRACT" };
    }

    if (!currentContract.planCode || !currentContract.planCode.trim()) {
      throw new Error("ASAAS_PLAN_CODE_MISSING");
    }

    // 3. Resolver plano correspondente no catálogo
    const plan = await getPlanByCode(tx, currentContract.planCode.trim());
    if (!plan) {
      throw new Error("PLAN_CODE_NOT_FOUND");
    }

    // 4. Buscar pagamentos elegíveis vinculados exclusivamente ao contrato atual
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

    if (payments.length === 0 && fallbackPaymentCandidate) {
      payments = [fallbackPaymentCandidate as any];
    }

    // 5. Selecionar pagamento vencedor determinístico
    const winner = selectEligiblePaymentWinner(payments);

    const existingSub = await tx.tenantSubscription.findUnique({
      where: { barbershopId },
    });

    // 6. Se NÃO existir pagamento vencedor elegível para o contrato:
    if (!winner) {
      return { recomputed: false, reason: "NO_WINNER" };
    }

    // 7. Se existir pagamento vencedor elegível e TenantSubscription já existente:
    if (existingSub) {
      if (existingSub.planId !== plan.id) {
        throw new Error("TENANT_PLAN_CODE_MISMATCH");
      }
    }

    // 8. Calcular datas comerciais do período e pagamento
    const periodStart = winner.dueDate ?? winner.paymentDate ?? null;
    const derivedPeriodEnd = periodStart ? addCalendarMonthsUTC(periodStart, 1) : null;
    const lastPaymentAt = winner.paymentDate ?? winner.dueDate ?? null;
    const paymentMethod =
      winner.billingType ??
      currentContract.billingType ??
      existingSub?.paymentMethod ??
      null;

    if (existingSub) {
      const preservedPeriodEnd = resolveNonReducingPeriodEnd(
        existingSub.currentPeriodEnd,
        derivedPeriodEnd
      );

      await tx.tenantSubscription.update({
        where: { id: existingSub.id },
        data: {
          status: "ACTIVE",
          planName: currentContract.planName,
          monthlyPrice: currentContract.value,
          currentPeriodStart: periodStart,
          currentPeriodEnd: preservedPeriodEnd,
          gracePeriodEndsAt: null,
          paymentMethod,
          lastPaymentAt,
          lastAccessPaymentId: winner.asaasPaymentId,
        },
      });
    } else {
      await tx.tenantSubscription.create({
        data: {
          barbershopId,
          planId: plan.id,
          planName: currentContract.planName,
          monthlyPrice: currentContract.value,
          status: "ACTIVE",
          currentPeriodStart: periodStart,
          currentPeriodEnd: derivedPeriodEnd,
          gracePeriodEndsAt: null,
          paymentMethod,
          lastPaymentAt,
          lastAccessPaymentId: winner.asaasPaymentId,
        },
      });
    }

    return { recomputed: true };
  });
}
