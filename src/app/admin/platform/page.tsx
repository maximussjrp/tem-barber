import React from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isPlatformAdmin } from "@/lib/subscription-utils";
import {
  deriveTenantSubscriptionAccess,
  deriveBillingStatus,
  formatBillingDatePtBr,
} from "@/lib/billing/subscription-access";
import { deriveTenantEffectiveAccess } from "@/lib/billing/access-grants";
import {
  selectCurrentBillableAsaasSubscription,
  selectCurrentPaymentForContract,
} from "@/lib/billing/current-contract";
import { PlatformDashboard } from "@/components/admin/PlatformDashboard";

export const metadata = {
  title: "Plataforma Tem Barber | Admin",
  description: "Gerenciamento de Assinaturas e Clientes",
};

export default async function PlatformAdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user as { id?: string; role?: string; email?: string | null };
  const role = user.role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

  if (!isPlatform) {
    redirect("/acesso-negado");
  }

  const now = new Date();

  // 1. LEITURA PURA: Buscar barbearias com assinaturas, membros OWNER e pagamentos Asaas
  const barbershops = await prisma.barbershop.findMany({
    include: {
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      },
      accessGrants: {
        orderBy: { createdAt: "desc" },
      },
      members: {
        where: { role: "OWNER" },
        include: { user: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const [plans, allPayments, allAsaasSubscriptions] = await Promise.all([
    prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: "asc" },
    }),
    prisma.asaasBillingPayment.findMany({
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.asaasBillingSubscription.findMany({
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // 2. Pré-calcular dados derivados no servidor para cada tenant
  const processedBarbershops = barbershops.map((shop) => {
    const subs = shop.subscriptions ?? [];
    const latestSub = subs[0] ?? null;
    const subscriptionCount = subs.length;

    const shopAsaasSubs = allAsaasSubscriptions.filter((s) => s.barbershopId === shop.id);
    const contractResolution = selectCurrentBillableAsaasSubscription(shopAsaasSubs);
    const currentContract =
      contractResolution.status === "FOUND" ? contractResolution.subscription : null;

    const shopPayments = allPayments.filter((p) => p.barbershopId === shop.id);
    const relevantPayment = currentContract
      ? selectCurrentPaymentForContract(shopPayments, currentContract)
      : null;

    const baseAccess = deriveTenantSubscriptionAccess(latestSub, { now });
    const effectiveAccess = deriveTenantEffectiveAccess(latestSub, shop.accessGrants || [], { now });
    const billing = deriveBillingStatus(relevantPayment);

    const warnings: string[] = [...effectiveAccess.synchronizationWarnings, ...billing.warnings];

    if (contractResolution.status === "RECONCILIATION_REQUIRED") {
      warnings.push("BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED");
      warnings.push(
        `Existe mais de uma assinatura Asaas ativa/vencida (${contractResolution.count}) para esta barbearia. Reconciliação necessária.`
      );
    }

    if (subscriptionCount > 1) {
      warnings.push(`Existe mais de uma TenantSubscription (${subscriptionCount}) para esta barbearia.`);
    }

    if (relevantPayment) {
      if (
        (relevantPayment.status === "RECEIVED" || relevantPayment.status === "CONFIRMED") &&
        !relevantPayment.accessAppliedAt
      ) {
        warnings.push("Pagamento recebido/confirmado sem data de acesso aplicado (accessAppliedAt).");
      }
      if (relevantPayment.accessAppliedAt && latestSub?.status !== "ACTIVE") {
        warnings.push("accessAppliedAt preenchido porém TenantSubscription não está ACTIVE.");
      }
      if (
        latestSub?.lastAccessPaymentId &&
        relevantPayment.asaasPaymentId &&
        latestSub.lastAccessPaymentId !== relevantPayment.asaasPaymentId
      ) {
        warnings.push("lastAccessPaymentId não corresponde ao asaasPaymentId da cobrança atual.");
      }
      if (
        relevantPayment.status === "OVERDUE" &&
        baseAccess.effectiveStatus === "ACTIVE" &&
        (!latestSub?.gracePeriodEndsAt || new Date(latestSub.gracePeriodEndsAt).getTime() <= now.getTime())
      ) {
        warnings.push("Cobrança vencida (OVERDUE) com acesso ativo sem tolerância vigente.");
      }
    }

    if (billing.billingStatus === "PAID" && baseAccess.effectiveStatus === "EXPIRED") {
      warnings.push("Cobrança paga mas o acesso está expirado no sistema.");
    }

    if (
      baseAccess.effectiveStatus === "ACTIVE" &&
      baseAccess.accessType === "PAID" &&
      !latestSub?.lastPaymentAt &&
      !latestSub?.lastAccessPaymentId
    ) {
      warnings.push("Acesso ativo manualmente sem comprovante de pagamento registrado.");
    }

    // Critério estrito para MRR Confirmado: SEMPRE usa baseAccess + pagamento Asaas validado (NUNCA cortesia)
    let isMrrConfirmed = false;
    const monthlyPriceNum = latestSub?.monthlyPrice ? Number(latestSub.monthlyPrice) : 0;

    if (
      !contractResolution.isReconciliationRequired &&
      currentContract &&
      baseAccess.effectiveStatus === "ACTIVE" &&
      baseAccess.accessType === "PAID" &&
      baseAccess.validUntil &&
      baseAccess.validUntil.getTime() > now.getTime() &&
      monthlyPriceNum > 0 &&
      (latestSub?.lastPaymentAt || latestSub?.lastAccessPaymentId) &&
      relevantPayment &&
      (relevantPayment.status === "RECEIVED" || relevantPayment.status === "CONFIRMED") &&
      relevantPayment.accessAppliedAt &&
      relevantPayment.asaasPaymentId === latestSub?.lastAccessPaymentId
    ) {
      isMrrConfirmed = true;
    }

    return {
      ...shop,
      subscription: latestSub,
      subscriptionCount,
      access: effectiveAccess,
      baseAccess,
      accessGrants: shop.accessGrants || [],
      billing,
      isMrrConfirmed,
      confirmedRevenue: isMrrConfirmed ? monthlyPriceNum : 0,
      synchronizationWarnings: warnings,
      formattedValidUntil: effectiveAccess.validUntil ? formatBillingDatePtBr(effectiveAccess.validUntil) : null,
      formattedLastPaymentAt: latestSub?.lastPaymentAt ? formatBillingDatePtBr(latestSub.lastPaymentAt) : null,
    };
  });

  const serializedBarbershops = JSON.parse(JSON.stringify(processedBarbershops));
  const serializedPlans = JSON.parse(JSON.stringify(plans));

  return (
    <PlatformDashboard
      initialBarbershops={serializedBarbershops}
      plans={serializedPlans}
    />
  );
}
