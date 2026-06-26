import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const subscriptionId = url.searchParams.get("subscriptionId") || undefined;
    const competence = url.searchParams.get("competence") || undefined;

    const usages = await prisma.clubBenefitUsage.findMany({
      where: {
        barbershopId: data.barbershopId,
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(competence ? { competence } : {}),
      },
      include: {
        subscription: {
          include: {
            customer: { select: { id: true, name: true } },
          },
        },
        clubPlan: { select: { id: true, name: true } },
        clubPlanBenefit: true,
        service: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
      orderBy: { usedAt: "desc" },
    });

    return NextResponse.json(usages);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar logs de uso." }, { status: 500 });
  }
}
