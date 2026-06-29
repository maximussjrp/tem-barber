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
  benefits: z.array(
    z.object({
      benefitId: z.string().optional().nullable(),
      serviceId: z.string().min(1),
      includedQty: z.number().int().min(1),
      pointWeight: z.number().min(0.01),
    })
  ).optional(),
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
    const { benefits } = updates;

    if (benefits && benefits.length > 0) {
      const serviceIds = benefits.map((b) => b.serviceId);
      if (new Set(serviceIds).size !== serviceIds.length) {
        return NextResponse.json(
          { error: "VALIDATION_ERROR", message: "Não é permitido adicionar o mesmo serviço mais de uma vez." },
          { status: 400 }
        );
      }
    }

    const newShopPct = updates.shopSharePercent !== undefined ? updates.shopSharePercent : Number(plan.shopSharePercent);
    const newBarberPct = updates.barberPoolPercent !== undefined ? updates.barberPoolPercent : Number(plan.barberPoolPercent);

    if (Math.round(newShopPct * 100) + Math.round(newBarberPct * 100) !== 10000) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "A soma dos percentuais da loja e dos barbeiros deve ser 100%." },
        { status: 400 }
      );
    }

    // Carregar benefícios existentes do plano
    const existingBenefits = await prisma.clubPlanBenefit.findMany({
      where: { clubPlanId: id },
    });

    const existingIncludedServices = existingBenefits.filter(
      (b) => b.benefitType === "INCLUDED_SERVICE"
    );

    let benefitsToDelete: typeof existingIncludedServices = [];
    if (benefits !== undefined) {
      const incomingServiceIds = new Set(benefits.map((b) => b.serviceId));
      benefitsToDelete = existingIncludedServices.filter(
        (b) => b.serviceId && !incomingServiceIds.has(b.serviceId)
      );

      // Guardião de auditoria: bloqueia se houver usage histórico de benefícios a serem deletados
      for (const b of benefitsToDelete) {
        const usageCount = await prisma.clubBenefitUsage.count({
          where: { clubPlanBenefitId: b.id },
        });
        if (usageCount > 0) {
          return NextResponse.json(
            {
              error: "AUDIT_LOCK",
              message: "Este benefício já foi usado por clientes assinantes e não pode ser removido. O histórico foi preservado.",
            },
            { status: 422 }
          );
        }
      }
    }

    const updatedPlan = await prisma.$transaction(async (tx) => {
      // 1. Atualizar dados do plano
      const updated = await tx.clubPlan.update({
        where: { id },
        data: {
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.description !== undefined && { description: updates.description?.trim() || null }),
          ...(updates.monthlyPrice !== undefined && { monthlyPrice: new Prisma.Decimal(updates.monthlyPrice) }),
          ...(updates.shopSharePercent !== undefined && { shopSharePercent: new Prisma.Decimal(updates.shopSharePercent) }),
          ...(updates.barberPoolPercent !== undefined && { barberPoolPercent: new Prisma.Decimal(updates.barberPoolPercent) }),
          ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        },
      });

      if (benefits !== undefined) {
        // 2. Deletar desmarcados
        if (benefitsToDelete.length > 0) {
          await tx.clubPlanBenefit.deleteMany({
            where: { id: { in: benefitsToDelete.map((b) => b.id) } },
          });
        }

        // 3. Atualizar ou criar
        for (const b of benefits) {
          const existing = existingIncludedServices.find((eb) => eb.serviceId === b.serviceId);
          if (existing) {
            await tx.clubPlanBenefit.update({
              where: { id: existing.id },
              data: {
                includedQty: b.includedQty,
                pointWeight: new Prisma.Decimal(b.pointWeight),
              },
            });
          } else {
            // Validar tenant
            const svc = await tx.service.findFirst({
              where: { id: b.serviceId, barbershopId: data.barbershopId },
            });
            if (!svc) {
              throw new Error("SERVICE_NOT_FOUND");
            }

            await tx.clubPlanBenefit.create({
              data: {
                clubPlanId: id,
                benefitType: "INCLUDED_SERVICE",
                serviceId: b.serviceId,
                includedQty: b.includedQty,
                pointWeight: new Prisma.Decimal(b.pointWeight),
              },
            });
          }
        }
      }

      return tx.clubPlan.findUnique({
        where: { id },
        include: { benefits: true },
      });
    });

    return NextResponse.json(updatedPlan);
  } catch (err: any) {
    if (err.message === "SERVICE_NOT_FOUND") {
      return NextResponse.json(
        {
          error: "SERVICE_NOT_FOUND",
          message: "Um ou mais serviços informados não foram encontrados ou pertencem a outra barbearia.",
        },
        { status: 404 }
      );
    }
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
