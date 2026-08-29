import { AsaasPaymentStatus, AsaasSubscriptionStatus, Prisma } from "@prisma/client";

/**
 * Mapeia o status da assinatura retornado pela API do Asaas para o enum interno.
 */
export function mapAsaasSubscriptionStatus(status?: string | null): AsaasSubscriptionStatus {
  if (!status) return AsaasSubscriptionStatus.UNKNOWN;

  const normalized = status.toUpperCase().trim();

  switch (normalized) {
    case "ACTIVE":
      return AsaasSubscriptionStatus.ACTIVE;
    case "INACTIVE":
      return AsaasSubscriptionStatus.INACTIVE;
    case "EXPIRED":
      return AsaasSubscriptionStatus.EXPIRED;
    case "OVERDUE":
      return AsaasSubscriptionStatus.OVERDUE;
    case "CANCELED":
    case "CANCELLED":
      return AsaasSubscriptionStatus.CANCELED;
    default:
      return AsaasSubscriptionStatus.UNKNOWN;
  }
}

/**
 * Mapeia o status da cobrança/pagamento retornado pelo Asaas para o enum interno.
 */
export function mapAsaasPaymentStatus(status?: string | null): AsaasPaymentStatus {
  if (!status) return AsaasPaymentStatus.UNKNOWN;

  const normalized = status.toUpperCase().trim();

  switch (normalized) {
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return AsaasPaymentStatus.PENDING;
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
      return AsaasPaymentStatus.RECEIVED;
    case "CONFIRMED":
      return AsaasPaymentStatus.CONFIRMED;
    case "OVERDUE":
      return AsaasPaymentStatus.OVERDUE;
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      return AsaasPaymentStatus.REFUNDED;
    case "CANCELED":
    case "CANCELLED":
      return AsaasPaymentStatus.CANCELED;
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "DUNNING_REQUESTED":
      return AsaasPaymentStatus.CHARGEBACK;
    default:
      return AsaasPaymentStatus.UNKNOWN;
  }
}

/**
 * Constrói a referência externa padrão para o Cliente (Barbearia/Tenant) no Asaas.
 */
export function buildAsaasCustomerExternalReference(barbershopId: string): string {
  return `tb_barbershop_${barbershopId}`;
}

/**
 * Constrói a referência externa padrão para a Assinatura da Barbearia no Asaas.
 */
export function buildAsaasSubscriptionExternalReference(barbershopId: string, planCode: string): string {
  return `tb_sub_${barbershopId}_${planCode}`;
}

/**
 * Tenta extrair o ID da barbearia a partir da externalReference.
 */
export function parseBarbershopIdFromExternalReference(extRef?: string | null): string | null {
  if (!extRef || typeof extRef !== "string") return null;

  if (extRef.startsWith("tb_barbershop_")) {
    return extRef.replace("tb_barbershop_", "").trim();
  }

  if (extRef.startsWith("tb_sub_")) {
    const parts = extRef.replace("tb_sub_", "").split("_");
    return parts[0] || null;
  }

  // Se o próprio extRef for diretamente um UUID v4
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(extRef)) {
    return extRef;
  }

  return null;
}

/**
 * Remove qualquer campo sensível de um objeto payload antes de salvar em logs.
 */
export function sanitizeAsaasPayloadForLog(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const sensitiveKeys = [
    "creditcardnumber",
    "creditcardccv",
    "creditcardholdername",
    "creditcardexpiry",
    "access_token",
    "apikey",
    "password",
    "secret",
    "token",
  ];

  const clone: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      clone[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      clone[key] = sanitizeAsaasPayloadForLog(value);
    } else {
      clone[key] = value;
    }
  }

  return clone;
}

export type PaymentFreshnessClassification = "ACCEPT" | "REPLAY_CURRENT" | "STALE" | "CONFLICT";

export interface StoredPaymentSnapshot {
  id?: string;
  barbershopId: string;
  asaasPaymentId: string;
  asaasSubscriptionId: string | null;
  asaasCustomerId: string | null;
  status: AsaasPaymentStatus;
  billingType: string | null;
  value: unknown;
  netValue: unknown;
  dueDate: Date | null;
  paymentDate: Date | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  externalReference: string | null;
  sourceEventAt: Date | null;
  sourceEventId: string | null;
}

export interface CandidatePaymentFacts {
  barbershopId: string;
  asaasPaymentId: string;
  asaasSubscriptionId: string | null;
  asaasCustomerId: string | null;
  status: AsaasPaymentStatus;
  billingType: string | null;
  value: number;
  netValue: number | null;
  dueDate: Date | null;
  paymentDate: Date | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  externalReference: string | null;
  sourceEventAt: Date | null;
  sourceEventId: string | null;
}

/**
 * Extrai o ID do evento externo de forma unificada (payload.id || payload.eventId).
 * Garante type safety mesmo com payloads dinâmicos não tipados.
 */
export function extractAsaasEventId(payload?: { id?: unknown; eventId?: unknown; [key: string]: unknown } | null): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rawId = typeof payload.id === "string" ? payload.id : (typeof payload.eventId === "string" ? payload.eventId : null);
  if (rawId && rawId.trim().length > 0) {
    return rawId.trim();
  }
  return null;
}

/**
 * Converte dateCreated (ISO string) para Date válido de forma pura. Retorna null se ausente ou inválido.
 * NUNCA utiliza fallbacks como paymentDate ou dueDate.
 */
export function parseAsaasSourceEventAt(value?: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (isNaN(d.getTime())) return null;
  return d;
}

export function normalizeDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  try {
    const dec = new Prisma.Decimal(v as any);
    if (dec.isNaN()) return null;
    return dec.toFixed(2);
  } catch {
    return null;
  }
}

export function normalizeTime(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

export function areCanonicalFactsEqual(candidate: CandidatePaymentFacts, stored: StoredPaymentSnapshot): boolean {
  if (candidate.barbershopId !== stored.barbershopId) return false;
  if (candidate.asaasPaymentId !== stored.asaasPaymentId) return false;
  if ((candidate.asaasSubscriptionId || null) !== (stored.asaasSubscriptionId || null)) return false;
  if ((candidate.asaasCustomerId || null) !== (stored.asaasCustomerId || null)) return false;
  if (candidate.status !== stored.status) return false;
  if ((candidate.billingType || null) !== (stored.billingType || null)) return false;

  if (normalizeDecimal(candidate.value) !== normalizeDecimal(stored.value)) return false;
  if (normalizeDecimal(candidate.netValue) !== normalizeDecimal(stored.netValue)) return false;

  if (normalizeTime(candidate.dueDate) !== normalizeTime(stored.dueDate)) return false;
  if (normalizeTime(candidate.paymentDate) !== normalizeTime(stored.paymentDate)) return false;

  if ((candidate.invoiceUrl || null) !== (stored.invoiceUrl || null)) return false;
  if ((candidate.bankSlipUrl || null) !== (stored.bankSlipUrl || null)) return false;
  if ((candidate.externalReference || null) !== (stored.externalReference || null)) return false;

  return true;
}

/**
 * Classifica a "freshness" de um evento de pagamento em relação ao registro persistido.
 */
export function classifyPaymentFreshness(
  stored: StoredPaymentSnapshot | null,
  candidate: CandidatePaymentFacts
): PaymentFreshnessClassification {
  if (!stored) {
    return "ACCEPT";
  }

  const storedTime = stored.sourceEventAt ? stored.sourceEventAt.getTime() : null;
  const incomingTime = candidate.sourceEventAt ? candidate.sourceEventAt.getTime() : null;
  const storedId = stored.sourceEventId || null;
  const incomingId = candidate.sourceEventId || null;

  // Registro armazenado sem nenhum watermark (histórico un-watermarked)
  if (storedTime === null && storedId === null) {
    if (incomingTime !== null || incomingId !== null) {
      return "ACCEPT";
    }
    return "STALE";
  }

  if (storedTime === null && incomingTime !== null) {
    return "ACCEPT";
  }

  if (storedTime !== null && incomingTime === null) {
    return "STALE";
  }

  if (storedTime !== null && incomingTime !== null) {
    if (incomingTime > storedTime) {
      return "ACCEPT";
    }
    if (incomingTime < storedTime) {
      return "STALE";
    }

    // Datas iguais
    if (storedId === null && incomingId !== null) {
      return "ACCEPT";
    }
    if (storedId !== null && incomingId === null) {
      return "STALE";
    }
    if (storedId === null && incomingId === null) {
      return "STALE";
    }

    if (incomingId! > storedId!) {
      return "ACCEPT";
    }
    if (incomingId! < storedId!) {
      return "STALE";
    }

    // Mesmo watermark
    return areCanonicalFactsEqual(candidate, stored) ? "REPLAY_CURRENT" : "CONFLICT";
  }

  // Ambos timestamps NULL
  if (storedId !== null && incomingId !== null && incomingId === storedId) {
    return areCanonicalFactsEqual(candidate, stored) ? "REPLAY_CURRENT" : "CONFLICT";
  }

  return "STALE";
}
