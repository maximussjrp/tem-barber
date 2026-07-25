/**
 * Gerenciamento de clientes Asaas vinculados a barbearias (tenant billing).
 * Server-side apenas; nunca importar no client.
 */

import prisma from "@/lib/prisma";
import { asaasFetch } from "@/lib/asaas/client";
import { buildAsaasCustomerExternalReference } from "@/lib/asaas/mappers";
import { isBillingProfileCompleted } from "@/lib/billing/profile";

interface AsaasCustomerResponse {
  id: string;
  name: string;
  email?: string | null;
  cpfCnpj?: string | null;
  mobilePhone?: string | null;
  phone?: string | null;
  externalReference?: string | null;
}

interface EnsureCustomerResult {
  customerId: string;
  asaasCustomerId: string;
  name: string;
  email: string | null;
  cpfCnpj: string | null;
  phone: string | null;
  externalReference: string;
  created: boolean;
}

export class BillingProfileIncompleteError extends Error {
  public code = "BILLING_PROFILE_INCOMPLETE";

  constructor() {
    super("Complete seus dados de faturamento antes de ativar o plano.");
    this.name = "BillingProfileIncompleteError";
  }
}

/**
 * Garante que existe um cliente Asaas vinculado a barbearia.
 * O BarbershopBillingProfile e a fonte oficial de dados fiscais.
 */
export async function ensureAsaasCustomerForBarbershop(
  barbershopId: string
): Promise<EnsureCustomerResult> {
  const profile = await prisma.barbershopBillingProfile.findUnique({
    where: { barbershopId },
  });

  if (!isBillingProfileCompleted(profile)) {
    throw new BillingProfileIncompleteError();
  }

  const externalReference = buildAsaasCustomerExternalReference(barbershopId);
  const customerPayload = {
    name: profile.legalName,
    cpfCnpj: profile.cpfCnpj,
    email: profile.billingEmail,
    ...(profile.billingPhone ? { mobilePhone: profile.billingPhone } : {}),
    externalReference,
    notificationDisabled: true,
  };

  const existing = await prisma.asaasBillingCustomer.findFirst({
    where: { barbershopId },
  });

  if (existing) {
    await asaasFetch<AsaasCustomerResponse>(`/customers/${existing.asaasCustomerId}`, {
      method: "PUT",
      body: JSON.stringify(customerPayload),
    });

    const updated = await prisma.asaasBillingCustomer.update({
      where: { id: existing.id },
      data: {
        name: profile.legalName,
        email: profile.billingEmail,
        cpfCnpj: profile.cpfCnpj,
        phone: profile.billingPhone,
        externalReference,
      },
    });

    return {
      customerId: updated.id,
      asaasCustomerId: updated.asaasCustomerId,
      name: updated.name,
      email: updated.email,
      cpfCnpj: updated.cpfCnpj,
      phone: updated.phone,
      externalReference: updated.externalReference,
      created: false,
    };
  }

  const asaasResponse = await asaasFetch<AsaasCustomerResponse>("/customers", {
    method: "POST",
    body: JSON.stringify(customerPayload),
  });

  const saved = await prisma.asaasBillingCustomer.create({
    data: {
      barbershopId,
      asaasCustomerId: asaasResponse.id,
      name: profile.legalName,
      email: profile.billingEmail,
      cpfCnpj: profile.cpfCnpj,
      phone: profile.billingPhone,
      externalReference,
    },
  });

  return {
    customerId: saved.id,
    asaasCustomerId: saved.asaasCustomerId,
    name: saved.name,
    email: saved.email,
    cpfCnpj: saved.cpfCnpj,
    phone: saved.phone,
    externalReference: saved.externalReference,
    created: true,
  };
}
