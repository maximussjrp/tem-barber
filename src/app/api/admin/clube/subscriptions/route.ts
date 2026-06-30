import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ClubSubscriptionStatus } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const createSubscriptionSchema = z.object({
  customerId: z.string().min(1),
  clubPlanId: z.string().min(1),
  status: z.nativeEnum(ClubSubscriptionStatus).optional(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
});

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId") || undefined;
    const statusStr = url.searchParams.get("status");
    let status: ClubSubscriptionStatus | undefined;
    if (statusStr && Object.values(ClubSubscriptionStatus).includes(statusStr as any)) {
      status = statusStr as ClubSubscriptionStatus;
    }

    const subscriptions = await prisma.customerClubSubscription.findMany({
      where: {
        barbershopId: data.barbershopId,
        ...(customerId ? { customerId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        clubPlan: { select: { id: true, name: true, monthlyPrice: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(subscriptions);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar assinaturas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const json = await request.json();
    const result = createSubscriptionSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const subData = result.data;

    // 1. Validar se o plano existe e pertence à barbearia da sessão (cross-tenant check)
    const plan = await prisma.clubPlan.findFirst({
      where: { id: subData.clubPlanId, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json(
        { error: "PLAN_NOT_FOUND", message: "Plano não encontrado ou pertence a outra barbearia." },
        { status: 400 }
      );
    }

    // 2. Validar se o cliente existe
    const customer = await prisma.user.findUnique({
      where: { id: subData.customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: "CUSTOMER_NOT_FOUND", message: "Cliente não encontrado." }, { status: 400 });
    }

    // 3. Impedir criar nova assinatura ACTIVE/GRACE_PERIOD sobreposta para o mesmo customerId + barbershopId
    const newStart = new Date(subData.currentPeriodStart);
    const newEnd = new Date(subData.currentPeriodEnd);
    const newStatus = subData.status ?? ClubSubscriptionStatus.ACTIVE;

    if (newStatus === ClubSubscriptionStatus.ACTIVE || newStatus === ClubSubscriptionStatus.GRACE_PERIOD) {
      const overlapping = await prisma.customerClubSubscription.findFirst({
        where: {
          barbershopId: data.barbershopId,
          customerId: subData.customerId,
          status: { in: [ClubSubscriptionStatus.ACTIVE, ClubSubscriptionStatus.GRACE_PERIOD] },
          currentPeriodStart: { lt: newEnd },
          currentPeriodEnd: { gt: newStart },
        },
      });

      if (overlapping) {
        return NextResponse.json(
          {
            error: "OVERLAPPING_ACTIVE_SUBSCRIPTION",
            message: "O cliente já possui uma assinatura ativa ou em período de graça para esta barbearia neste período.",
          },
          { status: 400 }
        );
      }
    }

    // 4. Criar assinatura com barbershopId do tenant operacional
    const subscription = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: data.barbershopId,
        customerId: subData.customerId,
        clubPlanId: subData.clubPlanId,
        status: newStatus,
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
      },
      include: {
        customer: { select: { id: true, name: true } },
        clubPlan: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(subscription, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao criar assinatura." }, { status: 500 });
  }
}
