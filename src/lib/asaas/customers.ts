/**
 * Gerenciamento de clientes Asaas vinculados a barbearias (tenant billing).
 * Server-side apenas; nunca importar no client.
 */

import prisma from "@/lib/prisma";
import type { PrismaClient, Prisma } from "@prisma/client";
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

export interface AsaasNotificationRule {
  id: string;
  customer?: string;
  enabled?: boolean;
  emailEnabledForCustomer?: boolean;
  smsEnabledForCustomer?: boolean;
  whatsappEnabledForCustomer?: boolean;
  phoneCallEnabledForCustomer?: boolean;
  emailEnabledForProvider?: boolean;
  smsEnabledForProvider?: boolean;
  scheduleOffset?: number;
  [key: string]: unknown;
}

/**
 * Configura as notificações do customer no Asaas para usar apenas e-mail.
 * Desabilita SMS, WhatsApp, ligação e notificações para o provedor.
 * Consulta via GET, edita via PUT individual por notificationId e verifica o resultado final via GET.
 */
export async function configureAsaasCustomerEmailNotifications(
  asaasCustomerId: string
): Promise<AsaasNotificationRule[]> {
  try {
    const listRes = await asaasFetch<{ data?: AsaasNotificationRule[] }>(
      `/customers/${asaasCustomerId}/notifications`
    );
    const notifications = listRes?.data ?? [];

    for (const notif of notifications) {
      if (notif.id) {
        await asaasFetch(`/notifications/${notif.id}`, {
          method: "PUT",
          body: JSON.stringify({
            enabled: notif.enabled ?? true,
            scheduleOffset: notif.scheduleOffset ?? 0,
            emailEnabledForCustomer: true,
            smsEnabledForCustomer: false,
            whatsappEnabledForCustomer: false,
            phoneCallEnabledForCustomer: false,
            emailEnabledForProvider: false,
            smsEnabledForProvider: false,
          }),
        });
      }
    }

    const verifyRes = await asaasFetch<{ data?: AsaasNotificationRule[] }>(
      `/customers/${asaasCustomerId}/notifications`
    );
    return verifyRes?.data ?? [];
  } catch {
    console.error("[asaas/customers] Falha ao configurar regras de notificação por e-mail.");
    return [];
  }
}

export class AsaasCustomerReconciliationError extends Error {
  public code = "ASAAS_CUSTOMER_RECONCILIATION_REQUIRED";

  constructor(message = "Mais de um cliente remoto compatível encontrado no Asaas. Reconciliação necessária.") {
    super(message);
    this.name = "AsaasCustomerReconciliationError";
  }
}

/**
 * Garante que existe um cliente Asaas vinculado a barbearia.
 * O BarbershopBillingProfile e a fonte oficial de dados fiscais.
 */
export async function ensureAsaasCustomerForBarbershop(
  barbershopId: string,
  txOrPrisma?: PrismaClient | Prisma.TransactionClient
): Promise<EnsureCustomerResult> {
  const db = txOrPrisma ?? prisma;
  const profile = await db.barbershopBillingProfile.findUnique({
    where: { barbershopId },
  });

  const billingPhone = profile?.billingPhone ?? null;

  if (!isBillingProfileCompleted(profile)) {
    throw new BillingProfileIncompleteError();
  }

  const externalReference = buildAsaasCustomerExternalReference(barbershopId);
  const customerPayload = {
    name: profile.legalName,
    cpfCnpj: profile.cpfCnpj,
    email: profile.billingEmail,
    ...(billingPhone ? { mobilePhone: billingPhone } : {}),
    externalReference,
    notificationDisabled: false,
  };

  const existing = await db.asaasBillingCustomer.findFirst({
    where: { barbershopId },
  });

  if (existing) {
    await asaasFetch<AsaasCustomerResponse>(`/customers/${existing.asaasCustomerId}`, {
      method: "PUT",
      body: JSON.stringify(customerPayload),
    });

    await configureAsaasCustomerEmailNotifications(existing.asaasCustomerId);

    const updated = await db.asaasBillingCustomer.update({
      where: { id: existing.id },
      data: {
        name: profile.legalName,
        email: profile.billingEmail,
        cpfCnpj: profile.cpfCnpj,
        phone: billingPhone,
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

  // Se não existe localmente: consultar Asaas por externalReference antes de criar novo
  const queryParams = new URLSearchParams({ externalReference });
  const remoteRes = await asaasFetch<{ data?: AsaasCustomerResponse[] }>(
    `/customers?${queryParams.toString()}`
  );
  const remoteList = remoteRes?.data ?? [];

  const cleanDoc = (doc?: string | null) => (doc ? doc.replace(/\D/g, "") : "");
  const cleanEmail = (em?: string | null) => (em ? em.trim().toLowerCase() : "");
  const profileDoc = cleanDoc(profile.cpfCnpj);
  const profileEmail = cleanEmail(profile.billingEmail);

  const compatibleRemotes = remoteList.filter((rc) => {
    if (!rc.id) return false;
    if (rc.externalReference && rc.externalReference !== externalReference) return false;
    const rcDoc = cleanDoc(rc.cpfCnpj);
    const rcEmail = cleanEmail(rc.email);
    if (profileDoc && rcDoc) return profileDoc === rcDoc;
    if (profileEmail && rcEmail) return profileEmail === rcEmail;
    return true;
  });

  if (compatibleRemotes.length > 1) {
    throw new AsaasCustomerReconciliationError(
      `Existe mais de um cadastro de cliente no Asaas para esta referência (${externalReference}). Reconciliação necessária.`
    );
  }

  let asaasCustomerId: string;
  let isCreated = false;

  if (compatibleRemotes.length === 1) {
    const remoteCust = compatibleRemotes[0];
    asaasCustomerId = remoteCust.id;

    await asaasFetch<AsaasCustomerResponse>(`/customers/${asaasCustomerId}`, {
      method: "PUT",
      body: JSON.stringify(customerPayload),
    });

    await configureAsaasCustomerEmailNotifications(asaasCustomerId);
    isCreated = false;
  } else {
    const asaasResponse = await asaasFetch<AsaasCustomerResponse>("/customers", {
      method: "POST",
      body: JSON.stringify(customerPayload),
    });

    if (!asaasResponse.id) {
      throw new Error("Resposta inválida do Asaas ao criar cliente (id ausente).");
    }

    asaasCustomerId = asaasResponse.id;
    await configureAsaasCustomerEmailNotifications(asaasCustomerId);
    isCreated = true;
  }

  const saved = await db.asaasBillingCustomer.create({
    data: {
      barbershopId,
      asaasCustomerId,
      name: profile.legalName,
      email: profile.billingEmail,
      cpfCnpj: profile.cpfCnpj,
      phone: billingPhone,
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
    created: isCreated,
  };
}
