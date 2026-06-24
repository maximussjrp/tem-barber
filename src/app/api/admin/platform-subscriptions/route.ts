import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/subscription-utils";

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const email = session.user?.email;
  const isPlatform = isPlatformAdmin(email);

  if (!isPlatform) {
    return NextResponse.json({ error: "Acesso negado. Apenas administradores da plataforma." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const {
    barbershopId,
    status,
    planId,
    trialEndsAt,
    currentPeriodStart,
    currentPeriodEnd,
    gracePeriodEndsAt,
    paymentMethod,
    lastPaymentAt,
    internalNotes,
  } = body;

  if (!barbershopId || !status) {
    return NextResponse.json({ error: "barbershopId e status são obrigatórios." }, { status: 400 });
  }

  // Verificar se o tenant existe
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
  });

  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Validar status enum
  const validStatuses = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED", "SUSPENDED"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Status inválido: ${status}` }, { status: 400 });
  }

  // Buscar plano se planId for informado
  let plan = null;
  if (planId) {
    plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return NextResponse.json({ error: "Plano informado não existe." }, { status: 400 });
    }
  }

  // Buscar assinatura ativa atual do barbershop
  const currentSub = await prisma.tenantSubscription.findFirst({
    where: { barbershopId },
  });

  const updateData: any = {
    status,
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart) : new Date(),
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : new Date(),
    gracePeriodEndsAt: gracePeriodEndsAt ? new Date(gracePeriodEndsAt) : null,
    paymentMethod: paymentMethod || null,
    lastPaymentAt: lastPaymentAt ? new Date(lastPaymentAt) : null,
    internalNotes: internalNotes || null,
    updatedBy: email,
  };

  if (plan) {
    updateData.planId = plan.id;
    updateData.planName = plan.name;
    updateData.monthlyPrice = plan.price;
  }

  let updatedSubscription;

  if (currentSub) {
    // Atualiza a assinatura existente
    updatedSubscription = await prisma.tenantSubscription.update({
      where: { id: currentSub.id },
      data: updateData,
    });
  } else {
    // Cria a assinatura caso não exista (backfill dinâmico)
    if (!planId) {
      const defaultPlan = await prisma.plan.findFirst();
      if (!defaultPlan) {
        return NextResponse.json({ error: "Nenhum plano cadastrado no sistema." }, { status: 500 });
      }
      updateData.planId = defaultPlan.id;
      updateData.planName = defaultPlan.name;
      updateData.monthlyPrice = defaultPlan.price;
    }
    
    updatedSubscription = await prisma.tenantSubscription.create({
      data: {
        barbershopId,
        ...updateData,
      },
    });
  }

  return NextResponse.json({ subscription: updatedSubscription });
}
