import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const updatePlanSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional().nullable(),
  monthlyPrice: z.number().positive().optional(),
  shopSharePercent: z.number().min(0).max(100).optional(),
  barberPoolPercent: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const plan = await prisma.clubPlan.findFirst({
      where: { id, barbershopId: data.barbershopId },
      include: { benefits: true },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar plano." }, { status: 500 });
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
    const plan = await prisma.clubPlan.findFirst({
      where: { id, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    const json = await request.json();
    const result = updatePlanSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const updates = result.data;

    const newShopPct = updates.shopSharePercent !== undefined ? updates.shopSharePercent : Number(plan.shopSharePercent);
    const newBarberPct = updates.barberPoolPercent !== undefined ? updates.barberPoolPercent : Number(plan.barberPoolPercent);

    if (Math.round(newShopPct * 100) + Math.round(newBarberPct * 100) !== 10000) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "A soma dos percentuais da loja e dos barbeiros deve ser 100%." },
        { status: 400 }
      );
    }

    const updatedPlan = await prisma.clubPlan.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name.trim() }),
        ...(updates.description !== undefined && { description: updates.description?.trim() || null }),
        ...(updates.monthlyPrice !== undefined && { monthlyPrice: new Prisma.Decimal(updates.monthlyPrice) }),
        ...(updates.shopSharePercent !== undefined && { shopSharePercent: new Prisma.Decimal(updates.shopSharePercent) }),
        ...(updates.barberPoolPercent !== undefined && { barberPoolPercent: new Prisma.Decimal(updates.barberPoolPercent) }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      },
      include: { benefits: true },
    });

    return NextResponse.json(updatedPlan);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar plano." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const plan = await prisma.clubPlan.findFirst({
      where: { id, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    // Inativação obrigatória (soft delete)
    const updatedPlan = await prisma.clubPlan.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ message: "Plano inativado com sucesso.", plan: updatedPlan });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao inativar plano." }, { status: 500 });
  }
}
