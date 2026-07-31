import {
  onlyDigits,
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
  formatBrazilianMobilePhone,
  getBrazilianPhoneVariants,
} from "./phone/br-phone";

/**
 * Normalizes input to canonical digit string (removes non-digits).
 * Prepend 55 if 10 or 11 digits and not present.
 */
export function normalizeBrazilPhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = onlyDigits(input);
  if (!digits) return "";

  if (validateBrazilianMobilePhone(input)) {
    const normalized = normalizeBrazilianMobilePhone(input);
    if (normalized) return normalized;
  }

  return digits;
}

/**
 * Validates if phone is a valid Brazilian mobile phone number.
 */
export function isValidBrazilMobilePhone(input: string | null | undefined): boolean {
  return validateBrazilianMobilePhone(input);
}

/**
 * Sanitizes phone for logging or UI display without exposing full phone number.
 * Example: "551818999943" -> "1818****43" or "5517****90"
 */
export function sanitizePhoneForLog(input: string | null | undefined): string {
  if (!input) return "***";
  const digits = onlyDigits(input);
  if (digits.length <= 4) return "***";

  // If 55 prefix, strip or format
  const core = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (core.length <= 4) return `${core.slice(0, 2)}***`;

  const prefix = core.slice(0, 4);
  const suffix = core.slice(-2);
  return `${prefix}****${suffix}`;
}

export {
  onlyDigits,
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
  formatBrazilianMobilePhone,
  getBrazilianPhoneVariants,
};
