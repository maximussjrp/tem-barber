import { PaymentMethod } from "@prisma/client";
import { formatTimestampToCivilDateBR, todayIsoBR } from "@/lib/time-utils";
import { OperationalError } from "./comandas";

export interface ValidatedPaymentDate {
  effectivePaidAt: Date;
  civilDate: string;
  isBackdated: boolean;
}

/**
 * Valida e converte uma data de pagamento informada para a semântica financeira civil do Brasil (America/Sao_Paulo).
 * Impede datas no futuro e garante que datas retroativas fiquem centralizadas no dia civil de forma determinística.
 */
export function parseAndValidatePaymentDate(dateInput?: Date | string | null): ValidatedPaymentDate {
  if (!dateInput) {
    const now = new Date();
    const civilDate = formatTimestampToCivilDateBR(now);
    return {
      effectivePaidAt: now,
      civilDate,
      isBackdated: false,
    };
  }

  const today = todayIsoBR();

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    if (!trimmed) {
      const now = new Date();
      return {
        effectivePaidAt: now,
        civilDate: formatTimestampToCivilDateBR(now),
        isBackdated: false,
      };
    }

    // Formato estrito YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new OperationalError("INVALID_PAYMENT_DATE", "Data de pagamento inválida.", 400);
      }
      const testDate = new Date(Date.UTC(year, month - 1, day));
      if (
        testDate.getUTCFullYear() !== year ||
        testDate.getUTCMonth() !== month - 1 ||
        testDate.getUTCDate() !== day
      ) {
        throw new OperationalError("INVALID_PAYMENT_DATE", "Data de pagamento inválida.", 400);
      }

      if (trimmed > today) {
        throw new OperationalError("INVALID_PAYMENT_DATE", "A data do pagamento não pode ser no futuro.", 422);
      }

      const isBackdated = trimmed < today;
      // Para dias retroativos, fixamos em 12:00 BRT (15:00 UTC) para evitar qualquer oscilação de fuso
      const effectivePaidAt = isBackdated
        ? new Date(Date.UTC(year, month - 1, day, 15, 0, 0, 0))
        : new Date();

      return {
        effectivePaidAt,
        civilDate: trimmed,
        isBackdated,
      };
    }

    // Caso seja timestamp ISO completo
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new OperationalError("INVALID_PAYMENT_DATE", "Data de pagamento inválida.", 400);
    }
    const civilDate = formatTimestampToCivilDateBR(parsed);
    if (civilDate > today) {
      throw new OperationalError("INVALID_PAYMENT_DATE", "A data do pagamento não pode ser no futuro.", 422);
    }
    const isBackdated = civilDate < today;
    return {
      effectivePaidAt: parsed,
      civilDate,
      isBackdated,
    };
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      throw new OperationalError("INVALID_PAYMENT_DATE", "Data de pagamento inválida.", 400);
    }
    const civilDate = formatTimestampToCivilDateBR(dateInput);
    if (civilDate > today) {
      throw new OperationalError("INVALID_PAYMENT_DATE", "A data do pagamento não pode ser no futuro.", 422);
    }
    const isBackdated = civilDate < today;
    return {
      effectivePaidAt: dateInput,
      civilDate,
      isBackdated,
    };
  }

  throw new OperationalError("INVALID_PAYMENT_DATE", "Data de pagamento inválida.", 400);
}

/**
 * Validação da integridade de caixa diário:
 * Pagamentos em dinheiro retroativos não podem ser associados silenciosamente ao caixa aberto hoje
 * nem inseridos em sessões de caixa já fechadas.
 */
export function validateCashPaymentBackdating(method: PaymentMethod | string, isBackdated: boolean) {
  if (method === "CASH" && isBackdated) {
    throw new OperationalError(
      "CASH_BACKDATING_NOT_SUPPORTED",
      "Pagamentos em dinheiro retroativos não são permitidos para preservar a integridade do fechamento de caixa físico.",
      422
    );
  }
}
