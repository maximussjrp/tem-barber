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

  // 2. Buscar localmente cobrança escopada estritamente ao contrato atual
  let latestPayment = await resolveCurrentPaymentForContract(prisma, barbershopId, currentContract);

  // 3. Fallback de conciliação: se não existir cobrança local, consultar remota sem criar nova cobrança
  if (!latestPayment) {
    const custRecord = await prisma.asaasBillingCustomer.findFirst({
      where: { barbershopId },
    });

    if (currentContract.asaasSubscriptionId) {
      try {
        const remoteRes = await asaasFetch<{ data?: RemoteAsaasPayment[] }>(
          `/subscriptions/${currentContract.asaasSubscriptionId}/payments`
        );
        const paymentsList = remoteRes?.data ?? [];

        // Filtrar estritamente pelo customer/subscription do tenant
        const validPayments = paymentsList.filter((p) => {
          if (!p.id) return false;
          if (custRecord?.asaasCustomerId && p.customer && p.customer !== custRecord.asaasCustomerId) {
            return false;
          }
          if (p.subscription && p.subscription !== currentContract.asaasSubscriptionId) {
            return false;
          }
          return true;
        });

        // Ordenar deterministicamente por dueDate DESC, createdAt DESC
        validPayments.sort((a, b) => {
          const aDue = a.dueDate ? new Date(a.dueDate).getTime() : -1;
          const bDue = b.dueDate ? new Date(b.dueDate).getTime() : -1;
          if (bDue !== aDue) return bDue - aDue;
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        });

        if (validPayments.length > 0) {
          const remotePayment = validPayments[0];
          const mappedStatus = mapAsaasPaymentStatus(remotePayment.status);
          const paymentDateStr = remotePayment.paymentDate || remotePayment.clientPaymentDate || null;

          latestPayment = await prisma.asaasBillingPayment.upsert({
            where: { asaasPaymentId: remotePayment.id },
            create: {
              barbershopId,
              asaasPaymentId: remotePayment.id,
              asaasSubscriptionId: remotePayment.subscription || currentContract.asaasSubscriptionId,
              asaasCustomerId: remotePayment.customer || custRecord?.asaasCustomerId || null,
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
            update: {
              barbershopId,
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
            },
          });
        }
      } catch (err) {
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
