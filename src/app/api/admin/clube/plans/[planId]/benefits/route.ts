import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const createBenefitSchema = z.discriminatedUnion("benefitType", [
  z.object({
    benefitType: z.literal("INCLUDED_SERVICE"),
    serviceId: z.string().min(1),
    includedQty: z.number().int().min(1),
    pointWeight: z.number().min(0),
    productId: z.null().optional(),
    discountPercent: z.null().optional(),
  }),
  z.object({
    benefitType: z.literal("SERVICE_DISCOUNT"),
    serviceId: z.string().min(1),
    discountPercent: z.number().min(0).max(100),
    pointWeight: z.number().min(0).optional().nullable(),
    productId: z.null().optional(),
    includedQty: z.null().optional(),
  }),
  z.object({
    benefitType: z.literal("PRODUCT_DISCOUNT"),
    productId: z.string().min(1),
    discountPercent: z.number().min(0).max(100),
    pointWeight: z.number().min(0).optional().nullable(),
    serviceId: z.null().optional(),
    includedQty: z.null().optional(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { planId } = await params;

  try {
    const plan = await prisma.clubPlan.findFirst({
      where: { id: planId, barbershopId: data.barbershopId },
    });

    if (!plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND", message: "Plano não encontrado." }, { status: 404 });
    }

    const json = await request.json();
    const result = createBenefitSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const benefitData = result.data;

    if (benefitData.benefitType === "INCLUDED_SERVICE" || benefitData.benefitType === "SERVICE_DISCOUNT") {
      const svc = await prisma.service.findFirst({
        where: { id: benefitData.serviceId, barbershopId: data.barbershopId },
      });
      if (!svc) {
        return NextResponse.json(
          { error: "SERVICE_NOT_FOUND", message: "Serviço não encontrado na barbearia." },
          { status: 400 }
        );
      }
    } else if (benefitData.benefitType === "PRODUCT_DISCOUNT") {
      const prod = await prisma.product.findFirst({
        where: { id: benefitData.productId, barbershopId: data.barbershopId },
      });
      if (!prod) {
        return NextResponse.json(
          { error: "PRODUCT_NOT_FOUND", message: "Produto não encontrado na barbearia." },
          { status: 400 }
        );
      }
    }

    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: planId,
        benefitType: benefitData.benefitType,
        serviceId: benefitData.benefitType !== "PRODUCT_DISCOUNT" ? benefitData.serviceId : null,
        productId: benefitData.benefitType === "PRODUCT_DISCOUNT" ? benefitData.productId : null,
        includedQty: benefitData.benefitType === "INCLUDED_SERVICE" ? benefitData.includedQty : null,
        discountPercent: benefitData.benefitType !== "INCLUDED_SERVICE" && benefitData.discountPercent != null
          ? new Prisma.Decimal(benefitData.discountPercent)
          : null,
        pointWeight: benefitData.pointWeight != null
          ? new Prisma.Decimal(benefitData.pointWeight)
          : null,
      },
    });

    return NextResponse.json(benefit, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao criar benefício." }, { status: 500 });
  }
}
