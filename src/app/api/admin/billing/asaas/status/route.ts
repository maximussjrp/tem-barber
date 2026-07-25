import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getAsaasConfig } from "@/lib/asaas/client";
import { getActiveBillingPlan, ALLOWED_BILLING_TYPES } from "@/lib/billing/plans";
import { serializeBillingProfile } from "@/lib/billing/profile";
import { sanitizeBillingUrl } from "@/app/api/admin/billing/asaas/current-payment/route";

export async function GET() {
  const session = await getAdminSession();
  if (session.error) {
    return session.error;
  }

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada a sessao." },
      { status: 400 }
    );
  }

  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas proprietarios e gerentes tem acesso ao faturamento." },
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
      orderBy: { createdAt: "desc" },
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
    prisma.tenantSubscription.findFirst({
      where: { barbershopId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const safeProfile = serializeBillingProfile(profile);
  const now = new Date();

  // Calcular status financeiro e de acesso
  let accessStatus: "TRIAL" | "PENDING_PAYMENT" | "ACTIVE" | "OVERDUE" | "GRACE_PERIOD" | "CANCELED" | "EXPIRED" = "TRIAL";
  let remainingDays = 0;
  let remainingLabel = "";

  const latestPayment = recentPayments[0] ?? null;

  const currentPeriodEnd = tenantSub?.currentPeriodEnd ?? (subscription?.nextDueDate ? new Date(subscription.nextDueDate) : null);
  const trialEndsAt = tenantSub?.trialEndsAt ?? null;
  const gracePeriodEndsAt = tenantSub?.gracePeriodEndsAt ?? null;

  if (currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime()) {
    accessStatus = "ACTIVE";
    const diffMs = currentPeriodEnd.getTime() - now.getTime();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    remainingLabel = remainingDays <= 0 ? "Vence hoje" : `${remainingDays} dias até a próxima renovação`;
  } else if (gracePeriodEndsAt && gracePeriodEndsAt.getTime() > now.getTime()) {
    accessStatus = "GRACE_PERIOD";
    const diffMs = gracePeriodEndsAt.getTime() - now.getTime();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    remainingLabel = remainingDays <= 0 ? "Tolerância vence hoje" : `Período de tolerância: ${remainingDays} dia(s) restante(s)`;
  } else if (latestPayment?.status === "OVERDUE" || tenantSub?.status === "PAST_DUE") {
    accessStatus = "OVERDUE";
    const dueDate = latestPayment?.dueDate ?? now;
    const overdueMs = now.getTime() - dueDate.getTime();
    const daysOverdue = Math.max(1, Math.ceil(overdueMs / (1000 * 60 * 60 * 24)));
    remainingDays = 0;
    remainingLabel = `Pagamento em atraso há ${daysOverdue} dia(s)`;
  } else if (latestPayment?.status === "PENDING") {
    accessStatus = "PENDING_PAYMENT";
    const dueDate = latestPayment.dueDate ?? now;
    const diffMs = dueDate.getTime() - now.getTime();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    remainingLabel = remainingDays <= 0 ? "Vence hoje" : `Vence em ${remainingDays} dia(s)`;
  } else if (trialEndsAt && trialEndsAt.getTime() > now.getTime()) {
    accessStatus = "TRIAL";
    const diffMs = trialEndsAt.getTime() - now.getTime();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    remainingLabel = remainingDays <= 0 ? "Período de teste termina hoje" : `Restam ${remainingDays} dias do período de teste`;
  } else if (trialEndsAt && trialEndsAt.getTime() <= now.getTime()) {
    accessStatus = "EXPIRED";
    remainingDays = 0;
    remainingLabel = "Acesso de teste expirado";
  } else if (currentPeriodEnd && currentPeriodEnd.getTime() <= now.getTime()) {
    accessStatus = "EXPIRED";
    remainingDays = 0;
    remainingLabel = "Plano vencido";
  } else if (tenantSub?.status === "CANCELED") {
    accessStatus = "CANCELED";
    remainingDays = 0;
    remainingLabel = "Plano cancelado";
  } else {
    accessStatus = "TRIAL";
    remainingDays = 0;
    remainingLabel = "Período de teste";
  }

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
        canPay: latestPayment.status === "PENDING" || latestPayment.status === "OVERDUE",
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
    accessStatus,
    remainingDays,
    remainingLabel,
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
