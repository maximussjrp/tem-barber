import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getAsaasConfig } from "@/lib/asaas/client";
import { getActiveBillingPlan, ALLOWED_BILLING_TYPES } from "@/lib/billing/plans";
import { serializeBillingProfile } from "@/lib/billing/profile";
import { sanitizeBillingUrl } from "@/app/api/admin/billing/asaas/current-payment/route";
import {
  deriveTenantSubscriptionAccess,
  deriveBillingStatus,
  formatBillingDatePtBr,
} from "@/lib/billing/subscription-access";

export async function GET() {
  const session = await getAdminSession();
  if (session.error) {
    return session.error;
  }

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada a sessão." },
      { status: 400 }
    );
  }

  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas proprietários e gerentes têm acesso ao faturamento." },
      { status: 403 }
    );
  }

  const config = getAsaasConfig();
  const plan = getActiveBillingPlan();

  const [profile, customer, subscription, recentPayments, tenantSub] = await Promise.all([
    prisma.barbershopBillingProfile.findUnique({ where: { barbershopId } }),
    prisma.asaasBillingCustomer.findFirst({
      where: { barbershopId },
      select: { id: true },
    }),
    prisma.asaasBillingSubscription.findFirst({
      where: { barbershopId },
      orderBy: { createdAt: "desc" },
      select: {
        planCode: true,
        planName: true,
        value: true,
        cycle: true,
        status: true,
        nextDueDate: true,
        billingType: true,
      },
    }),
    prisma.asaasBillingPayment.findMany({
      where: { barbershopId },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        status: true,
        billingType: true,
        value: true,
        dueDate: true,
        paymentDate: true,
        invoiceUrl: true,
        bankSlipUrl: true,
      },
    }),
    prisma.tenantSubscription.findUnique({
      where: { barbershopId },
    }),
  ]);

  const safeProfile = serializeBillingProfile(profile);
  const now = new Date();

  // Usar regras puras de validação de acesso e cobrança
  const access = deriveTenantSubscriptionAccess(tenantSub, { now });
  const latestPayment = recentPayments[0] ?? null;
  const billing = deriveBillingStatus(latestPayment);

  const currentPayment = latestPayment
    ? {
        exists: true,
        status: latestPayment.status,
        billingType: latestPayment.billingType,
        value: latestPayment.value.toString(),
        dueDate: latestPayment.dueDate ? latestPayment.dueDate.toISOString() : null,
        paymentDate: latestPayment.paymentDate ? latestPayment.paymentDate.toISOString() : null,
        invoiceUrl: sanitizeBillingUrl(latestPayment.invoiceUrl),
        bankSlipUrl: sanitizeBillingUrl(latestPayment.bankSlipUrl),
        canPay: billing.canPay,
      }
    : null;

  return NextResponse.json({
    integrationConfigured: config.isConfigured,
    environment: config.environment,
    webhookTokenConfigured: config.webhookTokenConfigured,
    profileCompleted: safeProfile.completed,
    documentConfigured: safeProfile.documentConfigured,
    cpfCnpjMasked: safeProfile.cpfCnpjMasked,
    customerConfigured: Boolean(customer),
    plan: {
      code: plan.code,
      name: plan.name,
      value: plan.value.toFixed(2),
      cycle: plan.cycle,
      description: plan.description,
      features: plan.features,
    },
    billingTypes: [...ALLOWED_BILLING_TYPES],
    hasSubscription: Boolean(subscription),
    subscriptionStatus: subscription?.status ?? null,
    paymentStatus: latestPayment?.status ?? null,
    nextDueDate: subscription?.nextDueDate ? subscription.nextDueDate.toISOString() : null,
    // Propriedades padronizadas de acesso
    accessStatus: access.effectiveStatus,
    accessAllowed: access.accessAllowed,
    accessType: access.accessType,
    remainingDays: access.remainingDays,
    remainingLabel: access.remainingLabel,
    validUntil: access.validUntil ? access.validUntil.toISOString() : null,
    formattedValidUntil: access.validUntil ? formatBillingDatePtBr(access.validUntil) : null,
    // Propriedades padronizadas de cobrança
    billingStatus: billing.billingStatus,
    billingLabel: billing.billingLabel,
    billingDueDate: billing.billingDueDate ? billing.billingDueDate.toISOString() : null,
    formattedBillingDueDate: billing.billingDueDate ? formatBillingDatePtBr(billing.billingDueDate) : null,
    synchronizationWarnings: [...access.synchronizationWarnings, ...billing.warnings],
    trialEndsAt: tenantSub?.trialEndsAt ? tenantSub.trialEndsAt.toISOString() : null,
    currentPeriodEnd: tenantSub?.currentPeriodEnd ? tenantSub.currentPeriodEnd.toISOString() : null,
    gracePeriodEndsAt: tenantSub?.gracePeriodEndsAt ? tenantSub.gracePeriodEndsAt.toISOString() : null,
    currentPayment,
    subscription: subscription
      ? {
          planCode: subscription.planCode,
          planName: subscription.planName,
          value: subscription.value.toString(),
          cycle: subscription.cycle,
          status: subscription.status,
          billingType: subscription.billingType,
          nextDueDate: subscription.nextDueDate ? subscription.nextDueDate.toISOString() : null,
        }
      : null,
    recentPayments: recentPayments.map((payment) => ({
      status: payment.status,
      billingType: payment.billingType,
      value: payment.value.toString(),
      dueDate: payment.dueDate ? payment.dueDate.toISOString() : null,
      paymentDate: payment.paymentDate ? payment.paymentDate.toISOString() : null,
      invoiceUrl: sanitizeBillingUrl(payment.invoiceUrl),
      bankSlipUrl: sanitizeBillingUrl(payment.bankSlipUrl),
    })),
    permissions: {
      canEditProfile: role === "OWNER",
      canSubscribe: role === "OWNER",
    },
  });
}
