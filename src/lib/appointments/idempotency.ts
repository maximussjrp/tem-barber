import { createHash } from "node:crypto";
import {
  IdempotencyKeyInvalidError,
  IdempotencyKeyRequiredError,
} from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicBookingHashInput {
  memberId: string;
  serviceIds: string[];
  services?: { serviceId: string; quantity: number }[];
  dateTime: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

export function validateIdempotencyKey(key: string | null | undefined) {
  if (!key) {
    throw new IdempotencyKeyRequiredError();
  }

  const normalized = key.trim();
  if (normalized.length > 128 || !UUID_RE.test(normalized)) {
    throw new IdempotencyKeyInvalidError();
  }

  return normalized.toLowerCase();
}

export function getIdempotencyKeyFromRequest(
  request: Request,
  body: { idempotencyKey?: string }
) {
  return validateIdempotencyKey(request.headers.get("Idempotency-Key") ?? body.idempotencyKey);
}

export function getIdempotencyExpiresAt(now = new Date()) {
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

export function normalizePublicBookingPayload(input: PublicBookingHashInput) {
  const normalizedServices = input.services
    ? [...input.services].sort((a, b) => a.serviceId.localeCompare(b.serviceId)).map(s => `${s.serviceId}:${s.quantity}`)
    : [...new Set(input.serviceIds)].sort().map(id => `${id}:1`);

  return {
    memberId: input.memberId,
    services: normalizedServices,
    dateTime: new Date(input.dateTime).toISOString(),
    customerName: input.customerName?.trim() || null,
    customerPhone: input.customerPhone?.replace(/\D/g, "") || null,
    notes: input.notes?.trim() || null,
  };
}

export function hashPublicBookingPayload(input: PublicBookingHashInput) {
  const normalized = normalizePublicBookingPayload(input);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
