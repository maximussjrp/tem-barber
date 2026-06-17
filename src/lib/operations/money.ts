import { Prisma } from "@prisma/client";

export function toCents(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100);
}

export function fromCents(cents: number) {
  return new Prisma.Decimal((cents / 100).toFixed(2));
}

export function positiveCents(value: Prisma.Decimal | number | string, field: string) {
  const cents = toCents(value);
  if (cents <= 0) {
    throw new Error(`${field} deve ser maior que zero.`);
  }
  return cents;
}

export function nonNegativeCents(value: Prisma.Decimal | number | string | undefined, field: string) {
  const cents = toCents(value);
  if (cents < 0) {
    throw new Error(`${field} nao pode ser negativo.`);
  }
  return cents;
}

