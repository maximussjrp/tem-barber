import { AsaasPaymentStatus, SubscriptionStatus } from "@prisma/client";
import { BILLING_TIME_ZONE, getCivilDatePartsInTimeZone } from "./subscription-access";

export interface DelinquencyPaymentInput {
  id?: string;
  asaasPaymentId: string;
  asaasSubscriptionId: string | null;
  barbershopId?: string | null;
  status: AsaasPaymentStatus;
  dueDate: Date | null;
  paymentDate?: Date | null;
  firstPositiveAt?: Date | null;
  createdAt?: Date;
}

export interface TenantSubscriptionSnapshot {
  id?: string;
  barbershopId: string;
  status: SubscriptionStatus;
  trialEndsAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  gracePeriodEndsAt?: Date | null;
}

export interface DelinquencyEngineInput {
  barbershopId: string;
  tenantSubscription: TenantSubscriptionSnapshot | null;
  currentContractAsaasSubscriptionId: string | null;
  payments: DelinquencyPaymentInput[];
  now?: Date;
  timeZone?: string;
  graceDays?: number;
}

export interface DelinquencyEngineResult {
  hasActiveDebt: boolean;
  activeDebtCount: number;
  anchorPaymentId: string | null;
  anchorDueCivilKey: string | null;
  desiredDelinquencyStatus: "NONE" | "PAST_DUE" | "SUSPENDED";
  graceStartsCivilKey: string | null;
  suspensionCivilKey: string | null;
  gracePeriodEndsAt: Date | null;
  reason: string;
  warnings: string[];
}

/**
 * Recompõe a chave civil "YYYY-MM-DD" de uma dueDate armazenada no Asaas (UTC midnight).
 * Ignora deslocamentos de fuso horário local para evitar off-by-one em dates armazenados.
 */
export function getAsaasStoredDateOnlyKey(date: Date | null | undefined): string | null {
  if (!date || isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Adiciona N dias civis a uma chave date-only "YYYY-MM-DD".
 */
export function addCivilDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10));
  const utcDate = new Date(Date.UTC(y, m - 1, d + days));
  const ry = utcDate.getUTCFullYear();
  const rm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const rd = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${ry}-${rm}-${rd}`;
}

/**
 * Converte um datetime civil ("YYYY-MM-DD", "00:00:00.000") no fuso especificado para Date UTC absoluto.
 * Utiliza convergência iterativa dinâmica via Intl e validação estrita de round-trip.
 * Sem offsets estáticos hardcoded (ex: "-03:00").
 */
export function civilDateTimeToAbsoluteDate(
  dateKey: string,
  timeStr = "00:00:00.000",
  timeZone = BILLING_TIME_ZONE
): Date {
  const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10));
  const [hStr, minStr, secWithMs] = timeStr.split(":");
  const [secStr, msStr] = (secWithMs || "0.0").split(".");

  const targetYear = y;
  const targetMonth = m;
  const targetDay = d;
  const targetHour = parseInt(hStr || "0", 10);
  const targetMin = parseInt(minStr || "0", 10);
  const targetSec = parseInt(secStr || "0", 10);
  const targetMs = parseInt(msStr || "0", 10);

  // Estimativa inicial UTC
  let candidate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMin, targetSec, targetMs));

  // Convergência iterativa dinâmica (máximo 4 iterações)
  for (let iter = 0; iter < 4; iter++) {
    const civil = getCivilDatePartsInTimeZone(candidate, timeZone);

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const timeParts = formatter.formatToParts(candidate);
    let civilHour = 0, civilMin = 0, civilSec = 0;
    for (const p of timeParts) {
      if (p.type === "hour") civilHour = parseInt(p.value, 10) % 24;
      if (p.type === "minute") civilMin = parseInt(p.value, 10);
      if (p.type === "second") civilSec = parseInt(p.value, 10);
    }

    const guessCivilMs = Date.UTC(civil.year, civil.month - 1, civil.day, civilHour, civilMin, civilSec);
    const targetCivilMs = Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMin, targetSec);
    const diffMs = guessCivilMs - targetCivilMs;

    if (diffMs === 0) break;
    candidate = new Date(candidate.getTime() - diffMs);
  }

  // Validação estrita de round-trip
  const finalCivil = getCivilDatePartsInTimeZone(candidate, timeZone);
  const finalFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const finalParts = finalFormatter.formatToParts(candidate);
  let finalHour = 0, finalMin = 0, finalSec = 0;
  for (const p of finalParts) {
    if (p.type === "hour") finalHour = parseInt(p.value, 10) % 24;
    if (p.type === "minute") finalMin = parseInt(p.value, 10);
    if (p.type === "second") finalSec = parseInt(p.value, 10);
  }

  if (
    finalCivil.year !== targetYear ||
    finalCivil.month !== targetMonth ||
    finalCivil.day !== targetDay ||
    finalHour !== targetHour ||
    finalMin !== targetMin ||
    finalSec !== targetSec
  ) {
    throw new Error(`CIVIL_TIME_CONVERSION_FAILED:${dateKey} ${timeStr} in ${timeZone}`);
  }

  return candidate;
}

export function deriveTenantDelinquencyState(input: DelinquencyEngineInput): DelinquencyEngineResult {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? BILLING_TIME_ZONE;
  const graceDays = input.graceDays ?? 3;
  const warnings: string[] = [];

  // Fail-safe: Se não houver contrato Asaas atual definido, nenhum pagamento participa
  if (!input.currentContractAsaasSubscriptionId) {
    return {
      hasActiveDebt: false,
      activeDebtCount: 0,
      anchorPaymentId: null,
      anchorDueCivilKey: null,
      desiredDelinquencyStatus: "NONE",
      graceStartsCivilKey: null,
      suspensionCivilKey: null,
      gracePeriodEndsAt: null,
      reason: "NO_CURRENT_CONTRACT",
      warnings,
    };
  }

  const todayCivilKey = getCivilDatePartsInTimeZone(now, timeZone).dateString;

  // 1. Filtrar pagamentos exclusivamente do contrato Asaas atual e do mesmo Tenant (barbershopId)
  const contractPayments = input.payments.filter((p) => {
    if (p.asaasSubscriptionId !== input.currentContractAsaasSubscriptionId) return false;
    if (!p.barbershopId) {
      warnings.push(`PAYMENT_TENANT_MISSING:${p.asaasPaymentId}`);
      return false;
    }
    if (p.barbershopId !== input.barbershopId) return false;
    return true;
  });

  // 2. Identificar candidatos a dívida ativa vencida
  const activeDebtCandidates: { payment: DelinquencyPaymentInput; dueCivilKey: string }[] = [];

  for (const payment of contractPayments) {
    if (payment.status === AsaasPaymentStatus.UNKNOWN) {
      warnings.push(`PAYMENT_STATUS_UNKNOWN:${payment.asaasPaymentId}`);
      continue;
    }

    if (
      payment.status === AsaasPaymentStatus.CANCELED ||
      payment.status === AsaasPaymentStatus.RECEIVED ||
      payment.status === AsaasPaymentStatus.CONFIRMED ||
      payment.status === AsaasPaymentStatus.REFUNDED ||
      payment.status === AsaasPaymentStatus.CHARGEBACK
    ) {
      continue;
    }

    if (payment.status === AsaasPaymentStatus.PENDING || payment.status === AsaasPaymentStatus.OVERDUE) {
      const dueCivilKey = getAsaasStoredDateOnlyKey(payment.dueDate);
      if (!dueCivilKey) {
        warnings.push(`PAYMENT_DUE_DATE_MISSING:${payment.asaasPaymentId}`);
        continue;
      }

      if (dueCivilKey < todayCivilKey) {
        activeDebtCandidates.push({ payment, dueCivilKey });
      }
    }
  }

  // 3. Se não houver dívida ativa vencida
  if (activeDebtCandidates.length === 0) {
    return {
      hasActiveDebt: false,
      activeDebtCount: 0,
      anchorPaymentId: null,
      anchorDueCivilKey: null,
      desiredDelinquencyStatus: "NONE",
      graceStartsCivilKey: null,
      suspensionCivilKey: null,
      gracePeriodEndsAt: null,
      reason: "NO_ACTIVE_DEBT",
      warnings,
    };
  }

  // 4. Selecionar o anchor (dívida ativa mais antiga)
  activeDebtCandidates.sort((a, b) => {
    if (a.dueCivilKey !== b.dueCivilKey) {
      return a.dueCivilKey.localeCompare(b.dueCivilKey);
    }
    return a.payment.asaasPaymentId.localeCompare(b.payment.asaasPaymentId);
  });

  const anchor = activeDebtCandidates[0];
  const anchorDueCivilKey = anchor.dueCivilKey;
  const graceStartsCivilKey = addCivilDaysToKey(anchorDueCivilKey, 1);
  const suspensionCivilKey = addCivilDaysToKey(anchorDueCivilKey, graceDays + 1); // D+4
  const gracePeriodEndsAt = civilDateTimeToAbsoluteDate(suspensionCivilKey, "00:00:00.000", timeZone);

  let desiredDelinquencyStatus: "PAST_DUE" | "SUSPENDED" = "PAST_DUE";
  if (todayCivilKey >= suspensionCivilKey) {
    desiredDelinquencyStatus = "SUSPENDED";
  }

  return {
    hasActiveDebt: true,
    activeDebtCount: activeDebtCandidates.length,
    anchorPaymentId: anchor.payment.asaasPaymentId,
    anchorDueCivilKey,
    desiredDelinquencyStatus,
    graceStartsCivilKey,
    suspensionCivilKey,
    gracePeriodEndsAt,
    reason: `ACTIVE_DEBT_ANCHOR:${anchor.payment.asaasPaymentId}`,
    warnings,
  };
}
