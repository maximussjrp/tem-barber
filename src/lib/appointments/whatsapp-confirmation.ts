import { createHash, randomInt, timingSafeEqual } from "crypto";
import {
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
} from "@/lib/phone/br-phone";

export const WHATSAPP_CONFIRMATION_STATUS_PENDING = "PENDING";
export const WHATSAPP_CONFIRMATION_STATUS_CONFIRMED = "CONFIRMED";
export const WHATSAPP_CONFIRMATION_EXPIRES_MS = 24 * 60 * 60 * 1000;

export interface WhatsappConfirmationMessageInput {
  barbershopName: string;
  customerName: string;
  services: string[];
  dateTime: Date;
  token: string;
}

export interface WhatsappConfirmationLinkInput extends WhatsappConfirmationMessageInput {
  barbershopPhone: string | null | undefined;
}

export function normalizeWhatsappConfirmationToken(token: string | null | undefined) {
  const raw = token?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
  if (/^\d{6}$/.test(raw)) return `TB-${raw}`;
  return raw;
}

export function generateWhatsappConfirmationToken() {
  return `TB-${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
}

export function hashWhatsappConfirmationToken(token: string) {
  return createHash("sha256")
    .update(normalizeWhatsappConfirmationToken(token), "utf8")
    .digest("hex");
}

export function verifyWhatsappConfirmationToken(token: string, tokenHash: string) {
  const expected = Buffer.from(tokenHash, "hex");
  const received = Buffer.from(hashWhatsappConfirmationToken(token), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function getWhatsappConfirmationTokenHint(token: string) {
  const normalized = normalizeWhatsappConfirmationToken(token);
  return normalized.replace(/^TB-(\d{4})(\d{2})$/, "TB-****$2");
}

export function getWhatsappConfirmationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + WHATSAPP_CONFIRMATION_EXPIRES_MS);
}

export function getValidWhatsappPhone(phone: string | null | undefined) {
  const normalized = normalizeBrazilianMobilePhone(phone);
  if (!normalized || !validateBrazilianMobilePhone(normalized)) return null;
  return normalized;
}

export function buildWhatsappConfirmationMessage(input: WhatsappConfirmationMessageInput) {
  const date = input.dateTime.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = input.dateTime.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const services = input.services.join(", ");

  return [
    `Olá, ${input.customerName}!`,
    `Para confirmar seu agendamento na ${input.barbershopName}, envie este código: ${input.token}.`,
    `Data: ${date} às ${time}.`,
    `Serviço(s): ${services}.`,
  ].join("\n");
}

export function buildWhatsappConfirmationLink(input: WhatsappConfirmationLinkInput) {
  const phone = getValidWhatsappPhone(input.barbershopPhone);
  if (!phone) return null;

  const message = buildWhatsappConfirmationMessage(input);
  return {
    phone,
    message,
    link: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
  };
}
