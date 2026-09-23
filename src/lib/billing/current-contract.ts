/**
 * Resolução canônica de contrato atual do Asaas e respectiva cobrança.
 * Centraliza a semântica de qual assinatura é billable/atual e previne ambiguidades ou duplicidades.
 */

import type { Prisma, AsaasBillingSubscription, AsaasBillingPayment } from "@prisma/client";

export const BILLABLE_SUBSCRIPTION_STATUSES = ["ACTIVE", "OVERDUE"] as const;

export type BillableSubscriptionStatus = (typeof BILLABLE_SUBSCRIPTION_STATUSES)[number];

export interface BillableSubscriptionCandidate {
  id?: string;
  barbershopId: string;
  asaasSubscriptionId: string;
  status: string;
  canceledAt?: Date | string | null;
  createdAt?: Date | string | null;
  [key: string]: unknown;
}

export interface PaymentCandidate {
  id?: string;
  asaasPaymentId?: string;
  barbershopId: string;
  asaasSubscriptionId?: string | null;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
  [key: string]: unknown;
}

export type CurrentSubscriptionResolution<T = AsaasBillingSubscription> =
  | {
      status: "FOUND";
      subscription: T;
      isReconciliationRequired: false;
    }
  | {
      status: "NONE";
      subscription: null;
      isReconciliationRequired: false;
    }
  | {
      status: "RECONCILIATION_REQUIRED";
      subscription: null;
      subscriptions: T[];
      count: number;
      isReconciliationRequired: true;
      errorCode: "BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED";
    };

export function isBillableSubscription(sub: {
  status?: string | null;
  canceledAt?: Date | string | null;
} | null | undefined): boolean {
  if (!sub) return false;
  if (sub.canceledAt) return false;
  return sub.status === "ACTIVE" || sub.status === "OVERDUE";
}

/**
 * Regra pura para selecionar o contrato billable atual a partir de uma lista de registros em memória.
 */
export function selectCurrentBillableAsaasSubscription<T extends BillableSubscriptionCandidate>(
  records: T[]
): CurrentSubscriptionResolution<T> {
  const billable = records.filter((r) => isBillableSubscription(r));

  if (billable.length === 0) {
    return {
      status: "NONE",
      subscription: null,
      isReconciliationRequired: false,
    };
  }

  if (billable.length === 1) {
    return {
      status: "FOUND",
      subscription: billable[0],
      isReconciliationRequired: false,
    };
  }

  return {
    status: "RECONCILIATION_REQUIRED",
    subscription: null,
    subscriptions: billable,
    count: billable.length,
    isReconciliationRequired: true,
    errorCode: "BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED",
  };
}


export interface AsaasSubscriptionDbClient {
  asaasBillingSubscription: {
    findMany: (args?: Prisma.AsaasBillingSubscriptionFindManyArgs) => Promise<AsaasBillingSubscription[]>;
  };
}

export interface AsaasPaymentDbClient {
  asaasBillingPayment: {
    findMany: (args?: Prisma.AsaasBillingPaymentFindManyArgs) => Promise<AsaasBillingPayment[]>;
  };
}

/**
 * Consulta o banco de dados e resolve o contrato billable atual da barbearia.
 */
export async function resolveCurrentBillableAsaasSubscription(
  db: AsaasSubscriptionDbClient,
  barbershopId: string
): Promise<CurrentSubscriptionResolution<AsaasBillingSubscription>> {
  const records = await db.asaasBillingSubscription.findMany({
    where: {
      barbershopId,
      canceledAt: null,
      status: { in: ["ACTIVE", "OVERDUE"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return selectCurrentBillableAsaasSubscription(records);
}

/**
 * Seleciona deterministicamente a cobrança atual para o contrato billable especificado.
 * Critério:
 * - Filtrar por barbershopId e asaasSubscriptionId do contrato
 * - Ordenação: dueDate DESC (nulls last), createdAt DESC
 */
export function selectCurrentPaymentForContract<T extends PaymentCandidate>(
  payments: T[],
  currentContract: { barbershopId: string; asaasSubscriptionId: string } | null | undefined
): T | null {
  if (!currentContract) return null;

  const relevant = payments.filter(
    (p) =>
      p.barbershopId === currentContract.barbershopId &&
      p.asaasSubscriptionId === currentContract.asaasSubscriptionId
  );

  if (relevant.length === 0) return null;

  const sorted = [...relevant].sort((a, b) => {
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : -1;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : -1;
    if (bDue !== aDue) {
      return bDue - aDue;
    }
    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bCreated - aCreated;
  });

  return sorted[0] ?? null;
}

/**
 * Consulta o banco de dados e seleciona a cobrança mais atual para o contrato billable especificado.
 */
export async function resolveCurrentPaymentForContract(
  db: AsaasPaymentDbClient,
  barbershopId: string,
  currentContract: { barbershopId: string; asaasSubscriptionId: string } | null | undefined
): Promise<AsaasBillingPayment | null> {
  if (!currentContract) return null;

  const payments = await db.asaasBillingPayment.findMany({
    where: {
      barbershopId,
      asaasSubscriptionId: currentContract.asaasSubscriptionId,
    },
    orderBy: [
      { dueDate: "desc" },
      { createdAt: "desc" },
    ],
  });

  return selectCurrentPaymentForContract(payments, currentContract);
}