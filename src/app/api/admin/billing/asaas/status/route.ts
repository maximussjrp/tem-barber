import { NextResponse } from "next/server";
import { getBillingAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getAsaasConfig } from "@/lib/asaas/client";
import { getActiveBillingPlan, ALLOWED_BILLING_TYPES } from "@/lib/billing/plans";
import { serializeBillingProfile } from "@/lib/billing/profile";
import { sanitizeBillingUrl } from "@/app/api/admin/billing/asaas/current-payment/route";
import {
  deriveBillingStatus,
  formatBillingDatePtBr,
} from "@/lib/billing/subscription-access";
import { deriveTenantEffectiveAccess } from "@/lib/billing/access-grants";
import {
  selectCurrentBillableAsaasSubscription,
  selectCurrentPaymentForContract,
} from "@/lib/billing/current-contract";

export async function GET() {
  const session = await getBillingAdminSession();
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
  const now = new Date();

  const [profile, customer, allSubscriptions, recentPayments, tenantSub, accessGrants] =
    await Promise.all([
      prisma.barbershopBillingProfile.findUnique({ where: { barbershopId } }),
      prisma.asaasBillingCustomer.findFirst({
        where: { barbershopId },
        select: { id: true },
      }),
      prisma.asaasBillingSubscription.findMany({
        where: { barbershopId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.asaasBillingPayment.findMany({
        where: { barbershopId },
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      prisma.tenantSubscription.findUnique({
        where: { barbershopId },
      }),
      prisma.tenantAccessGrant.findMany({
        where: {
          barbershopId,
          revokedAt: null,
          endsAt: { gt: now },
        },
        orderBy: { startsAt: "asc" },
      }),
    ]);

  const safeProfile = serializeBillingProfile(profile);

  // Resolução canônica de contrato Asaas
  const contractResolution = selectCurrentBillableAsaasSubscription(allSubscriptions);
  const currentContract =
    contractResolution.status === "FOUND" ? contractResolution.subscription : null;
  const hasSubscriptionRecord = allSubscriptions.length > 0;
  const hasCurrentSubscription = contractResolution.status === "FOUND";

  // Cobrança atual escopada ao contrato atual
  let currentPayment = selectCurrentPaymentForContract(recentPayments, currentContract);

  if (!currentPayment && currentContract) {
    currentPayment = await prisma.asaasBillingPayment.findFirst({
      where: {
        barbershopId,
        asaasSubscriptionId: currentContract.asaasSubscriptionId,
      },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    });
  }

  // Validação de acesso do tenant (com suporte a cortesia) e status de cobrança do contrato atual
  const access = deriveTenantEffectiveAccess(tenantSub, accessGrants, { now });
  const billing = deriveBillingStatus(currentPayment);

  const warnings: string[] = [...access.synchronizationWarnings, ...billing.warnings];

  if (contractResolution.status === "RECONCILIATION_REQUIRED") {
    warnings.push("BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED");
    warnings.push(
      `Existe mais de uma assinatura ativa/vencida (${contractResolution.count}) para esta barbearia. Reconciliação necessária.`
    );
  }

  const canSubscribe =
    role === "OWNER" && !hasCurrentSubscription && !contractResolution.isReconciliationRequired;

  const currentPaymentPayload = currentPayment
    ? {
        exists: true,
        status: currentPayment.status,
        billingType: currentPayment.billingType,
        value: currentPayment.value.toString(),
        dueDate: currentPayment.dueDate ? currentPayment.dueDate.toISOString() : null,
        paymentDate: currentPayment.paymentDate ? currentPayment.paymentDate.toISOString() : null,
        invoiceUrl: sanitizeBillingUrl(currentPayment.invoiceUrl),
        bankSlipUrl: sanitizeBillingUrl(currentPayment.bankSlipUrl),
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
    hasSubscriptionRecord,
    hasCurrentSubscription,
    hasSubscription: hasCurrentSubscription,
    subscriptionStatus: currentContract?.status ?? null,
    paymentStatus: currentPayment?.status ?? null,
    nextDueDate: currentContract?.nextDueDate ? currentContract.nextDueDate.toISOString() : null,
    // Propriedades padronizadas de acesso
    accessStatus: access.effectiveStatus,
    accessAllowed: access.accessAllowed,
    accessType: access.accessType,
    remainingDays: access.remainingDays,
    remainingLabel: access.remainingLabel,
    validUntil: access.validUntil ? access.validUntil.toISOString() : null,
    formattedValidUntil: access.validUntil ? formatBillingDatePtBr(access.validUntil) : null,
    complimentary: {
      active: access.complimentary.active,
      queued: access.complimentary.queued,
      activeUntil: access.complimentary.coverageEndsAt ? access.complimentary.coverageEndsAt.toISOString() : null,
      nextStartsAt: access.complimentary.nextStartsAt ? access.complimentary.nextStartsAt.toISOString() : null,
      latestEndsAt: access.complimentary.latestEndsAt ? access.complimentary.latestEndsAt.toISOString() : null,
    },
    // Propriedades padronizadas de cobrança
    billingStatus: billing.billingStatus,
    billingLabel: billing.billingLabel,
    billingDueDate: billing.billingDueDate ? billing.billingDueDate.toISOString() : null,
    formattedBillingDueDate: billing.billingDueDate ? formatBillingDatePtBr(billing.billingDueDate) : null,
    synchronizationWarnings: warnings,
    trialEndsAt: tenantSub?.trialEndsAt ? tenantSub.trialEndsAt.toISOString() : null,
    currentPeriodEnd: tenantSub?.currentPeriodEnd ? tenantSub.currentPeriodEnd.toISOString() : null,
    gracePeriodEndsAt: tenantSub?.gracePeriodEndsAt ? tenantSub.gracePeriodEndsAt.toISOString() : null,
    currentPayment: currentPaymentPayload,
    subscription: currentContract
      ? {
          planCode: currentContract.planCode,
          planName: currentContract.planName,
          value: currentContract.value.toString(),
          cycle: currentContract.cycle,
          status: currentContract.status,
          billingType: currentContract.billingType,
          nextDueDate: currentContract.nextDueDate ? currentContract.nextDueDate.toISOString() : null,
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
      asaasSubscriptionId: payment.asaasSubscriptionId,
      isCurrentContract: currentContract
        ? payment.asaasSubscriptionId === currentContract.asaasSubscriptionId
        : false,
      isCurrentPayment: currentPayment
        ? payment.id === currentPayment.id ||
          (Boolean(payment.asaasPaymentId) && payment.asaasPaymentId === currentPayment.asaasPaymentId)
        : false,
    })),
    permissions: {
      canEditProfile: role === "OWNER",
      canSubscribe,
    },
  });
}
