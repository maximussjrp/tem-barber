import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getAsaasConfig } from "@/lib/asaas/client";
import { getActiveBillingPlan, ALLOWED_BILLING_TYPES } from "@/lib/billing/plans";
import { serializeBillingProfile } from "@/lib/billing/profile";

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

  const [profile, customer, subscription, recentPayments] = await Promise.all([
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
        status: true,
        billingType: true,
        value: true,
        dueDate: true,
        paymentDate: true,
      },
    }),
  ]);

  const safeProfile = serializeBillingProfile(profile);

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
    })),
    permissions: {
      canEditProfile: role === "OWNER",
      canSubscribe: role === "OWNER",
    },
  });
}
