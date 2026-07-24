import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getAsaasConfig } from "@/lib/asaas/client";

export async function GET() {
  const session = await getAdminSession();
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

  // Permissão: OWNER ou MANAGER apenas
  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas proprietários e gerentes têm acesso às configurações de faturamento." },
      { status: 403 }
    );
  }

  const config = getAsaasConfig();

  // Consulta dados armazenados do tenant no banco local
  const customer = await prisma.asaasBillingCustomer.findFirst({
    where: { barbershopId },
    select: {
      id: true,
      asaasCustomerId: true,
      name: true,
      email: true,
      cpfCnpj: true,
      externalReference: true,
      createdAt: true,
    },
  });

  const subscription = await prisma.asaasBillingSubscription.findFirst({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      asaasSubscriptionId: true,
      planCode: true,
      planName: true,
      value: true,
      cycle: true,
      status: true,
      nextDueDate: true,
      billingType: true,
      externalReference: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    integrationConfigured: config.isConfigured,
    environment: config.environment,
    webhookTokenConfigured: config.webhookTokenConfigured,
    hasCustomer: Boolean(customer),
    customer: customer
      ? {
          id: customer.id,
          asaasCustomerId: customer.asaasCustomerId,
          name: customer.name,
          email: customer.email,
          cpfCnpj: customer.cpfCnpj,
          externalReference: customer.externalReference,
        }
      : null,
    hasSubscription: Boolean(subscription),
    subscription: subscription
      ? {
          id: subscription.id,
          asaasSubscriptionId: subscription.asaasSubscriptionId,
          planCode: subscription.planCode,
          planName: subscription.planName,
          value: subscription.value.toString(),
          cycle: subscription.cycle,
          status: subscription.status,
          billingType: subscription.billingType,
          nextDueDate: subscription.nextDueDate ? subscription.nextDueDate.toISOString() : null,
          externalReference: subscription.externalReference,
        }
      : null,
    subscriptionStatus: subscription ? subscription.status : null,
    nextDueDate: subscription?.nextDueDate ? subscription.nextDueDate.toISOString() : null,
  });
}
