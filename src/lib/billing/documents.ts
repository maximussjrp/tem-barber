export type BillingDocumentPersonType = "INDIVIDUAL" | "COMPANY";

export interface BillingDocumentValidationResult {
  ok: boolean;
  normalized: string | null;
  masked: string | null;
  error?: "INVALID_PERSON_TYPE" | "INVALID_CPF" | "INVALID_CNPJ";
}

export function normalizeCpfCnpj(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function hasRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = normalizeCpfCnpj(value);
  if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(cpf[i]) * (11 - i);
  }
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;

  return digit === Number(cpf[10]);
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = normalizeCpfCnpj(value);
  if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

  const calcDigit = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, weight, index) => acc + Number(cnpj[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  return calcDigit(12) === Number(cnpj[12]) && calcDigit(13) === Number(cnpj[13]);
}

export function validateBillingDocument(
  personType: string,
  value: string | null | undefined
): BillingDocumentValidationResult {
  const normalized = normalizeCpfCnpj(value);

  if (personType === "INDIVIDUAL") {
    if (!isValidCpf(normalized)) {
      return { ok: false, normalized: null, masked: null, error: "INVALID_CPF" };
    }
    return { ok: true, normalized, masked: maskCpfCnpj(normalized) };
  }

  if (personType === "COMPANY") {
    if (!isValidCnpj(normalized)) {
      return { ok: false, normalized: null, masked: null, error: "INVALID_CNPJ" };
    }
    return { ok: true, normalized, masked: maskCpfCnpj(normalized) };
  }

  return { ok: false, normalized: null, masked: null, error: "INVALID_PERSON_TYPE" };
}

export function maskCpfCnpj(value: string | null | undefined): string | null {
  const normalized = normalizeCpfCnpj(value);

  if (normalized.length === 11) {
    return `***.***.***-${normalized.slice(-2)}`;
  }

  if (normalized.length === 14) {
    return `**.***.***/****-${normalized.slice(-2)}`;
  }

  return null;
}
