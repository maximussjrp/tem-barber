import type { BarbershopBillingProfile } from "@prisma/client";
import { maskCpfCnpj, normalizeCpfCnpj } from "@/lib/billing/documents";

export interface SafeBillingProfile {
  completed: boolean;
  personType: "INDIVIDUAL" | "COMPANY" | null;
  legalName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  documentConfigured: boolean;
  cpfCnpjMasked: string | null;
}

export function normalizeBillingPhone(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length > 0 ? normalized : null;
}

type BillingProfileRequiredFields = Pick<
  BarbershopBillingProfile,
  "personType" | "legalName" | "cpfCnpj" | "billingEmail"
>;

export function isBillingProfileCompleted(
  profile: BillingProfileRequiredFields | null
): profile is BillingProfileRequiredFields {
  return Boolean(
    profile?.personType &&
      profile.legalName.trim() &&
      normalizeCpfCnpj(profile.cpfCnpj) &&
      profile.billingEmail.trim()
  );
}

export function serializeBillingProfile(profile: BarbershopBillingProfile | null): SafeBillingProfile {
  if (!profile) {
    return {
      completed: false,
      personType: null,
      legalName: null,
      billingEmail: null,
      billingPhone: null,
      documentConfigured: false,
      cpfCnpjMasked: null,
    };
  }

  const cpfCnpjMasked = maskCpfCnpj(profile.cpfCnpj);

  return {
    completed: isBillingProfileCompleted(profile),
    personType: profile.personType,
    legalName: profile.legalName,
    billingEmail: profile.billingEmail,
    billingPhone: profile.billingPhone,
    documentConfigured: Boolean(cpfCnpjMasked),
    cpfCnpjMasked,
  };
}
