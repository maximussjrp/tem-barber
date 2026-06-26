import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ClubSubscriptionStatus } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const updateSubscriptionSchema = z.object({
  status: z.nativeEnum(ClubSubscriptionStatus).optional(),
  currentPeriodStart: z.string().datetime().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const sub = await prisma.customerClubSubscription.findFirst({
      where: { id, barbershopId: data.barbershopId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        clubPlan: {
          select: {
            id: true,
            name: true,
            monthlyPrice: true,
            shopSharePercent: true,
            barberPoolPercent: true,
          },
        },
      },
    });

    if (!sub) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
    }

    return NextResponse.json(sub);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar assinatura." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const sub = await prisma.customerClubSubscription.findFirst({
      where: { id, barbershopId: data.barbershopId },
    });

    if (!sub) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
    }

    const json = await request.json();
    const result = updateSubscriptionSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const updates = result.data;

    const updatedSub = await prisma.customerClubSubscription.update({
      where: { id },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.currentPeriodStart !== undefined && { currentPeriodStart: new Date(updates.currentPeriodStart) }),
        ...(updates.currentPeriodEnd !== undefined && { currentPeriodEnd: new Date(updates.currentPeriodEnd) }),
      },
      include: {
        customer: { select: { id: true, name: true } },
        clubPlan: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(updatedSub);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar assinatura." }, { status: 500 });
  }
}
