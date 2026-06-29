import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const createPlanSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().optional().nullable(),
  monthlyPrice: z.number().positive(),
  shopSharePercent: z.number().min(0).max(100),
  barberPoolPercent: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
  benefits: z.array(
    z.object({
      serviceId: z.string().min(1),
      includedQty: z.number().int().min(1),
      pointWeight: z.number().min(0.01),
    })
  ).optional(),
}).refine((data) => {
  return Math.round(data.shopSharePercent * 100) + Math.round(data.barberPoolPercent * 100) === 10000;
}, {
  message: "A soma dos percentuais da loja e dos barbeiros deve ser exatamente 100%.",
  path: ["shopSharePercent"],
});

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const plans = await prisma.clubPlan.findMany({
      where: { barbershopId: data.barbershopId },
      include: { benefits: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(plans);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar planos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const json = await request.json();
    const result = createPlanSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const { name, description, monthlyPrice, shopSharePercent, barberPoolPercent, isActive, benefits } = result.data;

    if (benefits && benefits.length > 0) {
      const serviceIds = benefits.map((b) => b.serviceId);
      if (new Set(serviceIds).size !== serviceIds.length) {
        return NextResponse.json(
          { error: "VALIDATION_ERROR", message: "Não é permitido adicionar o mesmo serviço mais de uma vez." },
          { status: 400 }
        );
      }
    }

    const plan = await prisma.$transaction(async (tx) => {
      const newPlan = await tx.clubPlan.create({
        data: {
          barbershopId: data.barbershopId,
          name: name.trim(),
          description: description?.trim() || null,
          monthlyPrice: new Prisma.Decimal(monthlyPrice),
          shopSharePercent: new Prisma.Decimal(shopSharePercent),
          barberPoolPercent: new Prisma.Decimal(barberPoolPercent),
          isActive: isActive !== false,
        },
      });

      if (benefits && benefits.length > 0) {
        const dbServices = await tx.service.findMany({
          where: {
            id: { in: benefits.map((b) => b.serviceId) },
            barbershopId: data.barbershopId,
          },
        });

        if (dbServices.length !== benefits.length) {
          throw new Error("SERVICE_NOT_FOUND");
        }

        await tx.clubPlanBenefit.createMany({
          data: benefits.map((b) => ({
            clubPlanId: newPlan.id,
            benefitType: "INCLUDED_SERVICE",
            serviceId: b.serviceId,
            includedQty: b.includedQty,
            pointWeight: new Prisma.Decimal(b.pointWeight),
          })),
        });
      }

      return tx.clubPlan.findUnique({
        where: { id: newPlan.id },
        include: { benefits: true },
      });
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (err: any) {
    if (err.message === "SERVICE_NOT_FOUND") {
      return NextResponse.json(
        { error: "SERVICE_NOT_FOUND", message: "Um ou mais serviços informados não foram encontrados ou pertencem a outra barbearia." },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao criar plano." }, { status: 500 });
  }
}
