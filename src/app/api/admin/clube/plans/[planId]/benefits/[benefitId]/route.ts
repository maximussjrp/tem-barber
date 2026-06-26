import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const updateBenefitSchema = z.object({
  includedQty: z.number().int().min(1).optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  pointWeight: z.number().min(0).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string; benefitId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { planId, benefitId } = await params;

  try {
    const plan = await prisma.clubPlan.findFirst({
      where: { id: planId, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    const benefit = await prisma.clubPlanBenefit.findFirst({
      where: { id: benefitId, clubPlanId: planId },
    });

    if (!benefit) {
      return NextResponse.json({ error: "BENEFIT_NOT_FOUND", message: "Benefício não encontrado." }, { status: 404 });
    }

    const json = await request.json();
    const result = updateBenefitSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const updates = result.data;

    const updatedBenefit = await prisma.clubPlanBenefit.update({
      where: { id: benefitId },
      data: {
        ...(updates.includedQty !== undefined && { includedQty: updates.includedQty }),
        ...(updates.discountPercent !== undefined && {
          discountPercent: updates.discountPercent != null ? new Prisma.Decimal(updates.discountPercent) : null
        }),
        ...(updates.pointWeight !== undefined && {
          pointWeight: updates.pointWeight != null ? new Prisma.Decimal(updates.pointWeight) : null
        }),
      },
    });

    return NextResponse.json(updatedBenefit);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar benefício." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string; benefitId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { planId, benefitId } = await params;

  try {
    const plan = await prisma.clubPlan.findFirst({
      where: { id: planId, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    const benefit = await prisma.clubPlanBenefit.findFirst({
      where: { id: benefitId, clubPlanId: planId },
    });

    if (!benefit) {
      return NextResponse.json({ error: "BENEFIT_NOT_FOUND", message: "Benefício não encontrado." }, { status: 404 });
    }

    // Guardião de auditoria: bloqueia se houver usage histórico
    const usageCount = await prisma.clubBenefitUsage.count({
      where: { clubPlanBenefitId: benefitId },
    });

    if (usageCount > 0) {
      return NextResponse.json(
        { error: "AUDIT_LOCK", message: "Não é possível excluir um benefício com histórico de utilização." },
        { status: 422 }
      );
    }

    await prisma.clubPlanBenefit.delete({
      where: { id: benefitId },
    });

    return NextResponse.json({ message: "Benefício excluído com sucesso." });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao excluir benefício." }, { status: 500 });
  }
}
