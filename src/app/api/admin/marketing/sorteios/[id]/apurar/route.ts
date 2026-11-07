import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import {
  assertTechnicalSimulationAuthorized,
  executeSweepstakeDraw,
} from "@/lib/marketing/sweepstake-engine";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  const sessionRole = data?.role;
  if (!barbershopId || !userId || !sessionRole) {
    return NextResponse.json(
      { error: "Sessão inválida ou barbearia não identificada." },
      { status: 403 }
    );
  }
  const { id } = await context.params;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Body vazio permitido para sorteio eletrônico
  }

  const federalLotteryConcurso =
    typeof body.federalLotteryConcurso === "string"
      ? body.federalLotteryConcurso
      : null;
  const federalLotteryPremios = Array.isArray(body.federalLotteryPremios)
    ? body.federalLotteryPremios.map((item) => String(item))
    : null;
  // Somente booleano literal `true` solicita simulação técnica;
  // a autorização efetiva depende exclusivamente da política do servidor e do papel autenticado na sessão.
  const requestedTechnicalSimulation = body.isTechnicalSimulation === true;

  try {
    const authenticatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!authenticatedUser) {
      return NextResponse.json(
        { error: "Usuário autenticado não encontrado." },
        { status: 403 }
      );
    }

    const effectiveServerRole =
      authenticatedUser.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : sessionRole;

    // Pré-validação de servidor: o parâmetro enviado pelo navegador NUNCA autoriza sozinho a simulação
    assertTechnicalSimulationAuthorized({
      isTechnicalSimulation: requestedTechnicalSimulation,
      userId: authenticatedUser.id,
      userRole: effectiveServerRole,
      userEmail: authenticatedUser.email,
    });

    const drawnSweepstake = await prisma.$transaction(async (tx) => {
      return executeSweepstakeDraw(tx, {
        sweepstakeId: id,
        barbershopId,
        drawnByUserId: authenticatedUser.id,
        drawnByUserRole: effectiveServerRole,
        drawnByUserEmail: authenticatedUser.email,
        federalLotteryConcurso,
        federalLotteryPremios,
        isTechnicalSimulation: requestedTechnicalSimulation,
      });
    });

    return NextResponse.json({
      success: true,
      sweepstake: drawnSweepstake,
      message:
        "Apuração realizada com sucesso! Ganhadores determinados e ata registrada.",
    });
  } catch (err: any) {
    console.error("Erro ao apurar sorteio:", err);
    const msg = String(err?.message || "Erro ao executar apuração do sorteio.");
    const isForbidden =
      msg.includes("SIMULACAO_TECNICA_NAO_AUTORIZADA") ||
      msg.includes("SIMULACAO_TECNICA_DESABILITADA");
    const isConflict = msg.includes("SWEEPSTAKE_ALREADY_DRAWN");
    const status = isForbidden ? 403 : isConflict ? 409 : 422;
    return NextResponse.json({ error: msg }, { status });
  }
}
