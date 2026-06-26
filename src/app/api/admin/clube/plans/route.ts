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

    const { name, description, monthlyPrice, shopSharePercent, barberPoolPercent, isActive } = result.data;

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: data.barbershopId,
        name: name.trim(),
        description: description?.trim() || null,
        monthlyPrice: new Prisma.Decimal(monthlyPrice),
        shopSharePercent: new Prisma.Decimal(shopSharePercent),
        barberPoolPercent: new Prisma.Decimal(barberPoolPercent),
        isActive: isActive !== false,
      },
      include: { benefits: true },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao criar plano." }, { status: 500 });
  }
}
