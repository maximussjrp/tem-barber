import { Prisma } from "@prisma/client";

export type MoneyValue = Prisma.Decimal | number | string | null | undefined;

type DecimalLike = {
  isNaN?: () => boolean;
  toNumber?: () => number;
};

function asDecimalLike(value: unknown): DecimalLike | null {
  return typeof value === "object" && value !== null ? (value as DecimalLike) : null;
}

export function isValidMoneyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return !Number.isNaN(value) && Number.isFinite(value);
  const decimalLike = asDecimalLike(value);
  if (decimalLike?.isNaN) {
    return !decimalLike.isNaN();
  }
  if (typeof value === "string") {
    const clean = value.replace(/[^\d.,-]/g, "");
    if (clean === "" || clean === "-" || clean === "NaN") return false;
    return !Number.isNaN(Number(clean.replace(",", ".")));
  }
  return false;
}

export function parseBRLInput(input: string): number {
  if (!input || input.trim() === "") throw new Error("Valor ausente.");
  let clean = input.replace(/[^\d.,-]/g, "");
  if (clean === "" || clean === "-" || clean === "NaN") throw new Error("Valor inválido.");

  if (clean.includes(",") && clean.includes(".")) {
    const lastComma = clean.lastIndexOf(",");
    const lastDot = clean.lastIndexOf(".");
    if (lastComma > lastDot) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }

  const parsed = Number(clean);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) throw new Error("Valor inválido.");
  return parsed;
}

export function normalizeMoneyValue(value: unknown): number {
  if (!isValidMoneyValue(value)) {
    throw new Error("Valor monetário corrompido ou ausente.");
  }
  if (typeof value === "number") return value;
  const decimalLike = asDecimalLike(value);
  if (decimalLike?.toNumber) {
    return decimalLike.toNumber();
  }
  if (typeof value === "string") {
    return parseBRLInput(value);
  }
  throw new Error("Valor monetário de tipo desconhecido.");
}

export function formatBRL(value: MoneyValue): string {
  try {
    const normalized = normalizeMoneyValue(value);
    return normalized.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    throw new Error("Não foi possível calcular os valores.");
  }
}

// Retro-compatibility functions mapped to new robust logic

export function parseMoney(input: MoneyValue): number {
  if (!isValidMoneyValue(input)) return 0; // Legacy fallback
  return normalizeMoneyValue(input);
}

export function toCents(value: MoneyValue) {
  if (!isValidMoneyValue(value)) return 0;
  return Math.round(normalizeMoneyValue(value) * 100);
}

export function fromCents(cents: number) {
  if (!isValidMoneyValue(cents)) return new Prisma.Decimal(0);
  return new Prisma.Decimal((cents / 100).toFixed(2));
}

export function positiveCents(value: MoneyValue, field: string) {
  if (!isValidMoneyValue(value)) throw new Error(`${field} deve ser maior que zero.`);
  const cents = toCents(value);
  if (cents <= 0) {
    throw new Error(`${field} deve ser maior que zero.`);
  }
  return cents;
}

export function nonNegativeCents(value: MoneyValue, field: string) {
  if (!isValidMoneyValue(value)) throw new Error(`${field} nao pode ser negativo.`);
  const cents = toCents(value);
  if (cents < 0) {
    throw new Error(`${field} nao pode ser negativo.`);
  }
  return cents;
}

