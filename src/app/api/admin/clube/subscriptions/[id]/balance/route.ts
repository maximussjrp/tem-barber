import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getClubBenefitsBalance } from "@/lib/operations/club";
import { requireOperationalSession } from "@/lib/api-auth";

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
    });

    if (!sub) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
    }

    const url = new URL(request.url);
    const atDateStr = url.searchParams.get("atDate");
    const atDate = atDateStr ? new Date(atDateStr) : new Date();

    const balance = await getClubBenefitsBalance({
      barbershopId: data.barbershopId,
      subscriptionId: id,
      atDate,
    });

    return NextResponse.json(balance);
  } catch (err: any) {
    if (err.code === "SUBSCRIPTION_NOT_FOUND") {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: err.message || "Erro ao consultar saldo." }, { status: 500 });
  }
}
