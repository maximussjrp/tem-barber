/**
 * Gerenciamento de clientes Asaas vinculados a barbearias (tenant billing).
 * Server-side apenas — nunca importar no client.
 */

import prisma from "@/lib/prisma";
import { asaasFetch } from "@/lib/asaas/client";
import { buildAsaasCustomerExternalReference } from "@/lib/asaas/mappers";

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

/**
 * Garante que existe um cliente Asaas vinculado à barbearia.
 * Se já existir localmente, reutiliza. Se não, cria no Asaas e salva.
 */
export async function ensureAsaasCustomerForBarbershop(
  barbershopId: string
): Promise<EnsureCustomerResult> {
  // 1. Verificar se já existe localmente
  const existing = await prisma.asaasBillingCustomer.findFirst({
    where: { barbershopId },
  });

  if (existing) {
    return {
      customerId: existing.id,
      asaasCustomerId: existing.asaasCustomerId,
      name: existing.name,
      email: existing.email,
      cpfCnpj: existing.cpfCnpj,
      phone: existing.phone,
      externalReference: existing.externalReference,
      created: false,
    };
  }

  // 2. Buscar dados da barbearia e do owner para preencher o customer
  const barbershop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: barbershopId },
    select: {
      id: true,
      name: true,
      phone: true,
    },
  });

  // Buscar o OWNER para obter email e CPF
  const ownerMember = await prisma.barbershopMember.findFirst({
    where: { barbershopId, role: "OWNER", isActive: true },
    select: {
      user: {
        select: {
          name: true,
          email: true,
          cpf: true,
          phone: true,
        },
      },
    },
  });

  const ownerUser = ownerMember?.user;
  const customerName = barbershop.name;
  const customerEmail = ownerUser?.email ?? null;
  const customerCpfCnpj = ownerUser?.cpf ?? null;
  const customerPhone = ownerUser?.phone ?? barbershop.phone ?? null;
  const externalReference = buildAsaasCustomerExternalReference(barbershopId);

  // 3. Criar customer no Asaas
  const asaasPayload: Record<string, unknown> = {
    name: customerName,
    externalReference,
  };

  if (customerEmail) asaasPayload.email = customerEmail;
  if (customerCpfCnpj) asaasPayload.cpfCnpj = customerCpfCnpj;
  if (customerPhone) asaasPayload.mobilePhone = customerPhone;

  const asaasResponse = await asaasFetch<AsaasCustomerResponse>("/customers", {
    method: "POST",
    body: JSON.stringify(asaasPayload),
  });

  // 4. Salvar localmente
  const saved = await prisma.asaasBillingCustomer.create({
    data: {
      barbershopId,
      asaasCustomerId: asaasResponse.id,
      name: customerName,
      email: customerEmail,
      cpfCnpj: customerCpfCnpj,
      phone: customerPhone,
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
