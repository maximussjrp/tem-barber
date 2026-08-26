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

  if (!barbershopId) {
    return NextResponse.json({ error: "barbershopId é obrigatório." }, { status: 400 });
  }

  const financialFields = [
    "status", "planId", "trialEndsAt", "currentPeriodStart", "currentPeriodEnd",
    "gracePeriodEndsAt", "paymentMethod", "lastPaymentAt", "monthlyPrice",
    "planName", "lastAccessPaymentId",
  ];
  const forbiddenFields = financialFields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (forbiddenFields.length > 0) {
    return NextResponse.json({ error: "PLATFORM_FINANCIAL_FIELDS_READ_ONLY", message: "Campos financeiros são somente leitura e são sincronizados pelo Asaas.", fields: forbiddenFields }, { status: 422 });
  }

  const barbershop = await prisma.barbershop.findUnique({ where: { id: barbershopId } });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  const subscriptions = await prisma.tenantSubscription.findMany({ where: { barbershopId }, orderBy: { createdAt: "desc" }, take: 2 });
  if (subscriptions.length === 0) {
    return NextResponse.json({ error: "SUBSCRIPTION_NOT_INITIALIZED", message: "Esta barbearia não possui estado de assinatura inicializado." }, { status: 409 });
  }
  if (subscriptions.length > 1) {
    return NextResponse.json({ error: "TENANT_SUBSCRIPTION_RECONCILIATION_REQUIRED", message: "Existem múltiplas assinaturas locais para esta barbearia. Reconciliação necessária antes de alterações." }, { status: 409 });
  }

  const updatedSubscription = await prisma.tenantSubscription.update({
    where: { id: subscriptions[0].id },
    data: {
      internalNotes: typeof body.internalNotes === "string" ? body.internalNotes.trim() || null : null,
      updatedBy: email || "SUPER_ADMIN",
    },
    include: { plan: true },
  });
  return NextResponse.json({ subscription: updatedSubscription });
}
