import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { freezeCustomerSweepstake } from "@/lib/marketing/sweepstake-engine";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  if (!barbershopId || !userId) {
    return NextResponse.json({ error: "Sessão inválida ou barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  try {
    const sweepstake = await prisma.$transaction(async (tx) => {
      return freezeCustomerSweepstake(tx, id, barbershopId, userId);
    });

    return NextResponse.json({
      success: true,
      sweepstake,
      message: "Campanha congelada com sucesso. Bilhetes emitidos e semente pré-comprometida imutável registrada.",
    });
  } catch (err: any) {
    console.error("Erro ao congelar sorteio:", err);
    return NextResponse.json({ error: err.message || "Erro ao congelar sorteio." }, { status: 422 });
  }
}
