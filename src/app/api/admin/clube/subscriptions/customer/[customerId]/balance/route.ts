import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getActiveCustomerClubSubscription, getClubBenefitsBalance } from "@/lib/operations/club";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { customerId } = await params;

  try {
    const activeSub = await getActiveCustomerClubSubscription({
      barbershopId: data.barbershopId,
      customerId,
      atDate: new Date(),
    });

    if (!activeSub) {
      return NextResponse.json({ benefits: [] });
    }

    const balance = await getClubBenefitsBalance({
      barbershopId: data.barbershopId,
      subscriptionId: activeSub.id,
      atDate: new Date(),
    });

    return NextResponse.json(balance);
  } catch (err: any) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: err.message || "Erro ao consultar benefícios do cliente." }, { status: 500 });
  }
}
