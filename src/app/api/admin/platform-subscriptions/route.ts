import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/subscription-utils";
import { parseAsaasDateOnly } from "@/lib/billing/subscription-access";

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const role = (session.user as any).role as string;
  const email = session.user?.email as string | null;
  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

  if (!isPlatform) {
    return NextResponse.json(
      { error: "Acesso negado. Apenas administradores da plataforma." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const barbershopId = typeof body.barbershopId === "string" ? body.barbershopId.trim() : null;
  const status = typeof body.status === "string" ? body.status.trim() : null;
  const planId = typeof body.planId === "string" && body.planId ? body.planId.trim() : null;

  if (!barbershopId || !status) {
    return NextResponse.json(
      { error: "barbershopId e status são obrigatórios." },
      { status: 400 }
    );
  }

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
  });

  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  const validStatuses = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED", "SUSPENDED"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Status inválido: ${status}` }, { status: 400 });
  }

  const now = new Date();
  const trialEndsAt = parseAsaasDateOnly(body.trialEndsAt as string);
  const currentPeriodStart = parseAsaasDateOnly(body.currentPeriodStart as string);
  const currentPeriodEnd = parseAsaasDateOnly(body.currentPeriodEnd as string);
  const gracePeriodEndsAt = parseAsaasDateOnly(body.gracePeriodEndsAt as string);
  const lastPaymentAt = parseAsaasDateOnly(body.lastPaymentAt as string);

  // Validação estrita por status
  if (status === "TRIAL") {
    if (!trialEndsAt) {
      return NextResponse.json(
        { error: "trialEndsAt é obrigatório para status TRIAL." },
        { status: 400 }
      );
    }
  }

  if (status === "ACTIVE") {
    if (!currentPeriodStart || !currentPeriodEnd) {
      return NextResponse.json(
        { error: "currentPeriodStart e currentPeriodEnd são obrigatórios para status ACTIVE." },
        { status: 400 }
      );
    }
    if (currentPeriodEnd.getTime() <= currentPeriodStart.getTime()) {
      return NextResponse.json(
        { error: "currentPeriodEnd deve ser estritamente posterior a currentPeriodStart." },
        { status: 400 }
      );
    }
  }

  let plan = null;
  if (planId) {
    plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return NextResponse.json({ error: "Plano informado não existe." }, { status: 400 });
    }
  }

  const currentSub = await prisma.tenantSubscription.findFirst({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
  });

  const updateData: {
    status: any;
    trialEndsAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    gracePeriodEndsAt: Date | null;
    paymentMethod: string | null;
    lastPaymentAt: Date | null;
    internalNotes: string | null;
    updatedBy: string | null;
    planId?: string;
    planName?: string;
    monthlyPrice?: any;
  } = {
    status,
    trialEndsAt: status === "TRIAL" ? trialEndsAt : trialEndsAt || currentSub?.trialEndsAt || null,
    currentPeriodStart: status === "ACTIVE" ? currentPeriodStart : status === "TRIAL" ? null : currentPeriodStart,
    currentPeriodEnd: status === "ACTIVE" ? currentPeriodEnd : status === "TRIAL" ? null : currentPeriodEnd,
    gracePeriodEndsAt,
    paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod.trim() || null : null,
    lastPaymentAt,
    internalNotes: typeof body.internalNotes === "string" ? body.internalNotes.trim() || null : null,
    updatedBy: email || "SUPER_ADMIN",
  };

  if (plan) {
    updateData.planId = plan.id;
    updateData.planName = plan.name;
    updateData.monthlyPrice = plan.price;
  }

  let updatedSubscription;

  if (currentSub) {
    updatedSubscription = await prisma.tenantSubscription.update({
      where: { id: currentSub.id },
      data: updateData,
      include: { plan: true },
    });
  } else {
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
        planId: updateData.planId!,
        ...updateData,
      },
      include: { plan: true },
    });
  }

  return NextResponse.json({ subscription: updatedSubscription });
}
