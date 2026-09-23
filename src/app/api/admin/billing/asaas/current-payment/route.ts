import { NextResponse } from "next/server";
import { getBillingAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { asaasFetch } from "@/lib/asaas/client";
import { mapAsaasPaymentStatus, sanitizeAsaasPayloadForLog } from "@/lib/asaas/mappers";
import {
  resolveCurrentBillableAsaasSubscription,
  resolveCurrentPaymentForContract,
} from "@/lib/billing/current-contract";

export function sanitizeBillingUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export class BillingPaymentIdentityConflictError extends Error {
  constructor(message = "Conflito de identidade ao conciliar cobrança remota.") {
    super(message);
    this.name = "BillingPaymentIdentityConflictError";
  }
}

interface RemoteAsaasPayment {
  id: string;
  customer?: string;
  subscription?: string;
  value?: number;
  netValue?: number;
  billingType?: string;
  status?: string;
  dueDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  externalReference?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export async function GET() {
  const session = await getBillingAdminSession();
  if (session.error) {
    return session.error;
  }

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada à sessão." },
      { status: 400 }
    );
  }

  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas proprietários e gerentes têm acesso à cobrança." },
      { status: 403 }
    );
  }

  // 1. Resolver contrato billable atual do tenant
  const contractResolution = await resolveCurrentBillableAsaasSubscription(prisma, barbershopId);

  if (contractResolution.status === "RECONCILIATION_REQUIRED") {
    return NextResponse.json(
      {
        error: "BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED",
        message: "Existe mais de uma assinatura ativa para esta barbearia. Reconciliação necessária.",
      },
      { status: 409 }
    );
  }

  if (contractResolution.status === "NONE") {
    return NextResponse.json({
      exists: false,
      status: null,
      billingType: null,
      value: null,
      dueDate: null,
      paymentDate: null,
      invoiceUrl: null,
      bankSlipUrl: null,
      canPay: false,
    });
  }

  const currentContract = contractResolution.subscription;

  const expectedSubscriptionId = currentContract.asaasSubscriptionId;
  const expectedCustomerId = currentContract.asaasCustomerId;

  const custRecord = await prisma.asaasBillingCustomer.findFirst({
    where: { barbershopId },
  });

  if (
    custRecord?.asaasCustomerId &&
    expectedCustomerId &&
    custRecord.asaasCustomerId !== expectedCustomerId
  ) {
    return NextResponse.json(
      {
        error: "BILLING_PAYMENT_IDENTITY_CONFLICT",
        message: "Conflito entre cliente do contrato e cliente da barbearia.",
      },
      { status: 409 }
    );
  }

  const effectiveCustomerId = expectedCustomerId || custRecord?.asaasCustomerId || null;

  // 2. Buscar localmente cobrança escopada estritamente ao contrato atual
  let latestPayment = await resolveCurrentPaymentForContract(prisma, barbershopId, currentContract);

  // 3. Fallback de conciliação: se não existir cobrança local, consultar remota sem criar nova cobrança
  if (!latestPayment) {
    if (currentContract.asaasSubscriptionId) {
      try {
        const remoteRes = await asaasFetch<{ data?: RemoteAsaasPayment[] }>(
          `/subscriptions/${currentContract.asaasSubscriptionId}/payments`
        );
        const paymentsList = remoteRes?.data ?? [];

        if (paymentsList.length > 0) {
          // Validar identidade estrita de todos os pagamentos remotos devolvidos pelo Asaas
          for (const p of paymentsList) {
            if (!p.id) continue;
            if (!p.customer || p.customer !== effectiveCustomerId) {
              throw new BillingPaymentIdentityConflictError(
                `Pagamento remoto ${p.id} com customer ausente ou divergente.`
              );
            }
            if (!p.subscription || p.subscription !== expectedSubscriptionId) {
              throw new BillingPaymentIdentityConflictError(
                `Pagamento remoto ${p.id} com assinatura ausente ou divergente.`
              );
            }
          }

          // Ordenar deterministicamente por dueDate DESC, createdAt DESC
          const validPayments = [...paymentsList];
          validPayments.sort((a, b) => {
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : -1;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : -1;
            if (bDue !== aDue) return bDue - aDue;
            const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bCreated - aCreated;
          });

          const remotePayment = validPayments[0];
          const mappedStatus = mapAsaasPaymentStatus(remotePayment.status);
          const paymentDateStr = remotePayment.paymentDate || remotePayment.clientPaymentDate || null;

          const existingPayment = await prisma.asaasBillingPayment.findUnique({
            where: { asaasPaymentId: remotePayment.id },
          });

          if (!existingPayment) {
            latestPayment = await prisma.asaasBillingPayment.create({
              data: {
                barbershopId,
                asaasPaymentId: remotePayment.id,
                asaasSubscriptionId: remotePayment.subscription,
                asaasCustomerId: remotePayment.customer,
                status: mappedStatus,
                billingType: remotePayment.billingType || null,
                value: remotePayment.value ?? 0,
                netValue: remotePayment.netValue ?? null,
                dueDate: remotePayment.dueDate ? new Date(remotePayment.dueDate) : null,
                paymentDate: paymentDateStr ? new Date(paymentDateStr) : null,
                invoiceUrl: remotePayment.invoiceUrl || null,
                bankSlipUrl: remotePayment.bankSlipUrl || null,
                externalReference: remotePayment.externalReference || null,
                rawPayload: sanitizeAsaasPayloadForLog(remotePayment) as object,
              },
            });
          } else {
            // Validar identidade ANTES de qualquer update
            if (existingPayment.barbershopId !== barbershopId) {
              throw new BillingPaymentIdentityConflictError(
                `Conflito de tenant para o pagamento ${remotePayment.id}.`
              );
            }

            if (
              existingPayment.asaasSubscriptionId != null &&
              existingPayment.asaasSubscriptionId !== remotePayment.subscription
            ) {
              throw new BillingPaymentIdentityConflictError(
                `Conflito de assinatura para o pagamento ${remotePayment.id}.`
              );
            }

            if (
              existingPayment.asaasCustomerId != null &&
              existingPayment.asaasCustomerId !== remotePayment.customer
            ) {
              throw new BillingPaymentIdentityConflictError(
                `Conflito de customer para o pagamento ${remotePayment.id}.`
              );
            }

            // Atualizar apenas fatos mutáveis e completar identidade se estava null
            const updateData: {
              status: typeof mappedStatus;
              billingType?: string | null;
              value?: number;
              netValue?: number | null;
              dueDate?: Date | null;
              paymentDate?: Date | null;
              invoiceUrl?: string | null;
              bankSlipUrl?: string | null;
              externalReference?: string | null;
              rawPayload?: object;
              asaasSubscriptionId?: string;
              asaasCustomerId?: string;
            } = {
              status: mappedStatus,
              billingType: remotePayment.billingType || undefined,
              value: remotePayment.value ?? undefined,
              netValue: remotePayment.netValue ?? undefined,
              dueDate: remotePayment.dueDate ? new Date(remotePayment.dueDate) : undefined,
              paymentDate: paymentDateStr ? new Date(paymentDateStr) : undefined,
              invoiceUrl: remotePayment.invoiceUrl || undefined,
              bankSlipUrl: remotePayment.bankSlipUrl || undefined,
              externalReference: remotePayment.externalReference || undefined,
              rawPayload: sanitizeAsaasPayloadForLog(remotePayment) as object,
            };

            if (existingPayment.asaasSubscriptionId == null && remotePayment.subscription) {
              updateData.asaasSubscriptionId = remotePayment.subscription;
            }

            if (existingPayment.asaasCustomerId == null && remotePayment.customer) {
              updateData.asaasCustomerId = remotePayment.customer;
            }

            latestPayment = await prisma.asaasBillingPayment.update({
              where: { id: existingPayment.id },
              data: updateData,
            });
          }
        }
      } catch (err) {
        if (err instanceof BillingPaymentIdentityConflictError) {
          return NextResponse.json(
            {
              error: "BILLING_PAYMENT_IDENTITY_CONFLICT",
              message: err.message,
            },
            { status: 409 }
          );
        }
        console.error("[current-payment] Erro ao buscar cobranças remotas no Asaas:", err);
      }
    }
  }

  if (!latestPayment) {
    return NextResponse.json({
      exists: false,
      status: null,
      billingType: null,
      value: null,
      dueDate: null,
      paymentDate: null,
      invoiceUrl: null,
      bankSlipUrl: null,
      canPay: false,
    });
  }

  const canPay = latestPayment.status === "PENDING" || latestPayment.status === "OVERDUE";

  return NextResponse.json({
    exists: true,
    status: latestPayment.status,
    billingType: latestPayment.billingType,
    value: latestPayment.value.toString(),
    dueDate: latestPayment.dueDate ? latestPayment.dueDate.toISOString() : null,
    paymentDate: latestPayment.paymentDate ? latestPayment.paymentDate.toISOString() : null,
    invoiceUrl: sanitizeBillingUrl(latestPayment.invoiceUrl),
    bankSlipUrl: sanitizeBillingUrl(latestPayment.bankSlipUrl),
    canPay,
  });
}
