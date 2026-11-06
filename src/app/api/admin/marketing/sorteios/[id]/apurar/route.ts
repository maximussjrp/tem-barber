import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { executeSweepstakeDraw } from "@/lib/marketing/sweepstake-engine";

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

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // Body vazio permitido para sorteio eletrônico
  }

  const {
    federalLotteryConcurso = null,
    federalLotteryPremios = null,
    isTechnicalSimulation = false,
  } = body;

  try {
    const drawnSweepstake = await prisma.$transaction(async (tx) => {
      return executeSweepstakeDraw(tx, {
        sweepstakeId: id,
        barbershopId,
        drawnByUserId: userId,
        federalLotteryConcurso,
        federalLotteryPremios,
        isTechnicalSimulation: Boolean(isTechnicalSimulation),
      });
    });

    return NextResponse.json({
      success: true,
      sweepstake: drawnSweepstake,
      message: "Apuração realizada com sucesso! Ganhadores determinados e ata registrada.",
    });
  } catch (err: any) {
    console.error("Erro ao apurar sorteio:", err);
    const isConflict = err.message?.includes("SWEEPSTAKE_ALREADY_DRAWN");
    return NextResponse.json(
      { error: err.message || "Erro ao executar apuração do sorteio." },
      { status: isConflict ? 409 : 422 }
    );
  }
}
