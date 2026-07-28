export const BILLING_TIME_ZONE = "America/Sao_Paulo";

export type EffectiveAccessStatus =
  | "TRIAL"
  | "ACTIVE"
  | "GRACE_PERIOD"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELED"
  | "EXPIRED"
  | "NO_SUBSCRIPTION";

export type AccessType = "TRIAL" | "PAID" | "GRACE" | "NONE";

export type BillingStatus =
  | "NONE"
  | "PENDING"
  | "PAID"
  | "OVERDUE"
  | "CANCELED"
  | "REFUNDED";

export interface SubscriptionInput {
  status?: string | null;
  trialEndsAt?: Date | string | null;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  gracePeriodEndsAt?: Date | string | null;
  monthlyPrice?: number | string | { toString(): string } | null;
  lastPaymentAt?: Date | string | null;
  lastAccessPaymentId?: string | null;
}

export interface PaymentInput {
  id?: string | null;
  asaasPaymentId?: string | null;
  barbershopId?: string | null;
  status?: string | null;
  dueDate?: Date | string | null;
  paymentDate?: Date | string | null;
  value?: number | string | { toString(): string } | null;
  billingType?: string | null;
  accessAppliedAt?: Date | string | null;
}

export interface TenantSubscriptionAccessResult {
  rawStatus: string | null;
  effectiveStatus: EffectiveAccessStatus;
  accessAllowed: boolean;
  accessType: AccessType;
  validUntil: Date | null;
  remainingDays: number;
  remainingLabel: string;
  isTrial: boolean;
  isPaid: boolean;
  isGracePeriod: boolean;
  isExpired: boolean;
  synchronizationWarnings: string[];
}

export interface BillingStatusResult {
  billingStatus: BillingStatus;
  billingDueDate: Date | null;
  billingPaymentDate: Date | null;
  billingValue: number | string | null;
  canPay: boolean;
  billingLabel: string;
  warnings: string[];
}

export function isValidDate(val: unknown): val is Date {
  return val instanceof Date && !isNaN(val.getTime());
}

/**
 * Converte com segurança strings de data para objetos Date sem desvio de fuso horário.
 * Strings no formato 'YYYY-MM-DD' são tratadas como fim do dia (23:59:59.999) em America/Sao_Paulo.
 */
export function parseAsaasDateOnly(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (isValidDate(value)) return value;
  if (typeof value === "string") {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnlyMatch) {
      const [, y, m, d] = dateOnlyMatch;
      // Tratar como fim do dia em America/Sao_Paulo (UTC-3)
      const isoStr = `${y}-${m}-${d}T23:59:59.999-03:00`;
      const parsed = new Date(isoStr);
      if (isValidDate(parsed)) return parsed;
    }
    const parsed = new Date(value);
    if (isValidDate(parsed)) return parsed;
  }
  return null;
}

export function formatBillingDatePtBr(value: Date | string | null | undefined): string | null {
  const date = parseAsaasDateOnly(value);
  if (!date) return null;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: BILLING_TIME_ZONE,
  });
}

export function getCivilDatePartsInTimeZone(
  date: Date,
  timeZone = BILLING_TIME_ZONE
): { year: number; month: number; day: number; dateString: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = parseInt(p.value, 10);
    if (p.type === "month") month = parseInt(p.value, 10);
    if (p.type === "day") day = parseInt(p.value, 10);
  }
  const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, dateString };
}

export function calculateRemainingDays(
  validUntil: Date | null,
  now: Date,
  timeZone = BILLING_TIME_ZONE
): number {
  if (!validUntil || !isValidDate(validUntil) || validUntil.getTime() <= now.getTime()) {
    return 0;
  }

  const nowCivil = getCivilDatePartsInTimeZone(now, timeZone);
  const validCivil = getCivilDatePartsInTimeZone(validUntil, timeZone);

  if (validCivil.dateString === nowCivil.dateString) {
    return 0;
  }

  const nowUtcDate = Date.UTC(nowCivil.year, nowCivil.month - 1, nowCivil.day);
  const validUtcDate = Date.UTC(validCivil.year, validCivil.month - 1, validCivil.day);

  const diffMs = validUtcDate - nowUtcDate;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

export function deriveTenantSubscriptionAccess(
  subscription?: SubscriptionInput | null,
  options?: { now?: Date; timeZone?: string }
): TenantSubscriptionAccessResult {
  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? BILLING_TIME_ZONE;
  const warnings: string[] = [];

  if (!subscription || !subscription.status) {
    return {
      rawStatus: subscription?.status ?? null,
      effectiveStatus: "NO_SUBSCRIPTION",
      accessAllowed: false,
      accessType: "NONE",
      validUntil: null,
      remainingDays: 0,
      remainingLabel: "Sem assinatura",
      isTrial: false,
      isPaid: false,
      isGracePeriod: false,
      isExpired: false,
      synchronizationWarnings: [],
    };
  }

  const rawStatus = subscription.status;
  const trialEndsAt = parseAsaasDateOnly(subscription.trialEndsAt);
  const periodStart = parseAsaasDateOnly(subscription.currentPeriodStart);
  const periodEnd = parseAsaasDateOnly(subscription.currentPeriodEnd);
  const graceEndsAt = parseAsaasDateOnly(subscription.gracePeriodEndsAt);

  let effectiveStatus: EffectiveAccessStatus = "EXPIRED";
  let accessAllowed = false;
  let accessType: AccessType = "NONE";
  let validUntil: Date | null = null;

  switch (rawStatus) {
    case "TRIAL": {
      if (!trialEndsAt) {
        warnings.push("TRIAL sem data trialEndsAt configurada.");
        effectiveStatus = "EXPIRED";
        accessAllowed = false;
      } else if (trialEndsAt.getTime() > now.getTime()) {
        effectiveStatus = "TRIAL";
        accessAllowed = true;
        accessType = "TRIAL";
        validUntil = trialEndsAt;
      } else {
        effectiveStatus = "EXPIRED";
        accessAllowed = false;
        validUntil = trialEndsAt;
      }
      break;
    }
    case "ACTIVE": {
      if (!periodStart) {
        warnings.push("ACTIVE sem currentPeriodStart.");
      }
      if (!periodEnd) {
        warnings.push("ACTIVE sem currentPeriodEnd.");
        effectiveStatus = "EXPIRED";
        accessAllowed = false;
      } else if (periodStart && periodEnd.getTime() <= periodStart.getTime()) {
        warnings.push("currentPeriodEnd anterior ou igual a currentPeriodStart.");
        effectiveStatus = "EXPIRED";
        accessAllowed = false;
      } else if (periodEnd.getTime() > now.getTime()) {
        effectiveStatus = "ACTIVE";
        accessAllowed = true;
        accessType = "PAID";
        validUntil = periodEnd;
      } else {
        warnings.push("ACTIVE com período vencido.");
        effectiveStatus = "EXPIRED";
        accessAllowed = false;
        validUntil = periodEnd;
      }
      break;
    }
    case "PAST_DUE": {
      if (graceEndsAt && graceEndsAt.getTime() > now.getTime()) {
        effectiveStatus = "GRACE_PERIOD";
        accessAllowed = true;
        accessType = "GRACE";
        validUntil = graceEndsAt;
      } else {
        if (!graceEndsAt) {
          warnings.push("PAST_DUE sem gracePeriodEndsAt.");
        } else {
          warnings.push("PAST_DUE com período de tolerância vencido.");
        }
        effectiveStatus = "PAST_DUE";
        accessAllowed = false;
        validUntil = graceEndsAt;
      }
      break;
    }
    case "SUSPENDED": {
      effectiveStatus = "SUSPENDED";
      accessAllowed = false;
      accessType = "NONE";
      validUntil = null;
      break;
    }
    case "CANCELED": {
      effectiveStatus = "CANCELED";
      accessAllowed = false;
      accessType = "NONE";
      validUntil = null;
      break;
    }
    case "EXPIRED": {
      effectiveStatus = "EXPIRED";
      accessAllowed = false;
      accessType = "NONE";
      validUntil = null;
      break;
    }
    default: {
      warnings.push(`Status de assinatura desconhecido: ${rawStatus}`);
      effectiveStatus = "EXPIRED";
      accessAllowed = false;
      accessType = "NONE";
      validUntil = null;
      break;
    }
  }

  const remainingDays = accessAllowed ? calculateRemainingDays(validUntil, now, timeZone) : 0;
  let remainingLabel = "";

  if (effectiveStatus === "TRIAL") {
    if (remainingDays === 0) {
      remainingLabel = "Termina hoje";
    } else if (remainingDays === 1) {
      remainingLabel = "Restam 1 dia do período de teste";
    } else {
      remainingLabel = `Restam ${remainingDays} dias do período de teste`;
    }
  } else if (effectiveStatus === "ACTIVE") {
    if (remainingDays === 0) {
      remainingLabel = "Renova hoje";
    } else if (remainingDays === 1) {
      remainingLabel = "Renova em 1 dia";
    } else {
      remainingLabel = `${remainingDays} dias até a próxima renovação`;
    }
  } else if (effectiveStatus === "GRACE_PERIOD") {
    if (remainingDays === 0) {
      remainingLabel = "Tolerância termina hoje";
    } else if (remainingDays === 1) {
      remainingLabel = "1 dia restante da tolerância";
    } else {
      remainingLabel = `${remainingDays} dias restantes da tolerância`;
    }
  } else if (effectiveStatus === "EXPIRED") {
    remainingLabel = "Período encerrado";
  } else if (effectiveStatus === "PAST_DUE") {
    remainingLabel = "Acesso suspenso por atraso";
  } else if (effectiveStatus === "SUSPENDED") {
    remainingLabel = "Acesso suspenso";
  } else if (effectiveStatus === "CANCELED") {
    remainingLabel = "Plano cancelado";
  } else {
    remainingLabel = "Sem assinatura";
  }

  return {
    rawStatus,
    effectiveStatus,
    accessAllowed,
    accessType,
    validUntil,
    remainingDays,
    remainingLabel,
    isTrial: effectiveStatus === "TRIAL",
    isPaid: effectiveStatus === "ACTIVE",
    isGracePeriod: effectiveStatus === "GRACE_PERIOD",
    isExpired: effectiveStatus === "EXPIRED" || effectiveStatus === "PAST_DUE",
    synchronizationWarnings: warnings,
  };
}

export function deriveBillingStatus(
  latestPayment?: PaymentInput | null
): BillingStatusResult {
  const warnings: string[] = [];

  if (!latestPayment || !latestPayment.status) {
    return {
      billingStatus: "NONE",
      billingDueDate: null,
      billingPaymentDate: null,
      billingValue: null,
      canPay: false,
      billingLabel: "Sem cobrança",
      warnings: [],
    };
  }

  const status = latestPayment.status;
  const dueDate = parseAsaasDateOnly(latestPayment.dueDate);
  const paymentDate = parseAsaasDateOnly(latestPayment.paymentDate);

  let billingStatus: BillingStatus = "NONE";
  let label = "Sem cobrança";

  switch (status) {
    case "PENDING":
      billingStatus = "PENDING";
      label = "Aguardando pagamento";
      break;
    case "RECEIVED":
    case "CONFIRMED":
      billingStatus = "PAID";
      label = "Pago";
      break;
    case "OVERDUE":
      billingStatus = "OVERDUE";
      label = "Vencida";
      break;
    case "REFUNDED":
    case "REFUND_REQUESTED":
      billingStatus = "REFUNDED";
      label = "Estornada";
      break;
    case "CANCELED":
      billingStatus = "CANCELED";
      label = "Cancelada";
      break;
    default:
      warnings.push(`Status de cobrança desconhecido: ${status}`);
      billingStatus = "NONE";
      label = "Sem cobrança";
      break;
  }

  const canPay = billingStatus === "PENDING" || billingStatus === "OVERDUE";

  return {
    billingStatus,
    billingDueDate: dueDate,
    billingPaymentDate: paymentDate,
    billingValue: latestPayment.value
      ? typeof latestPayment.value === "object"
        ? latestPayment.value.toString()
        : latestPayment.value
      : null,
    canPay,
    billingLabel: label,
    warnings,
  };
}
