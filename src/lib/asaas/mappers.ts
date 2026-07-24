import { AsaasPaymentStatus, AsaasSubscriptionStatus } from "@prisma/client";

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
