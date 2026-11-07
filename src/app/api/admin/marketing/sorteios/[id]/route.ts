import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  const sweepstake = await prisma.customerSweepstake.findUnique({
    where: { id_barbershopId: { id, barbershopId } },
    include: {
      prizes: { orderBy: { position: "asc" } },
      winners: {
        orderBy: { prizePosition: "asc" },
      },
      drawAudit: true,
      _count: {
        select: {
          participants: true,
          tickets: true,
          winners: true,
          chanceOrigins: true,
        },
      },
    },
  });

  if (!sweepstake) {
    return NextResponse.json({ error: "Campanha de sorteio não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ sweepstake });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  const existing = await prisma.customerSweepstake.findUnique({
    where: { id_barbershopId: { id, barbershopId } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Campanha de sorteio não encontrada." }, { status: 404 });
  }

  if (existing.status !== "DRAFT" && existing.status !== "REGULATION_PENDING") {
    return NextResponse.json(
      { error: `Campanha com status ${existing.status} não pode ser editada.` },
      { status: 422 }
    );
  }

  try {
    const body = await request.json();
    const {
      title,
      description,
      startDateCivil,
      endDateCivil,
      drawDateScheduled,
      participationMode,
      targetSegment,
      serviceIds,
      allowMultiplePrizesPerUser,
      drawMethod,
      isRegulatedPromotion,
      authorizationCode,
      regulationsSummary,
      regulationsDocumentUrl,
      federalLotteryContestNumber,
      prizes,
    } = body;

    const startInclusiveUtc = startDateCivil ? localDateToUTCBoundary(startDateCivil) : existing.startInclusiveUtc;
    const endExclusiveUtc = endDateCivil ? localDateToUTCBoundary(shiftDateISO(endDateCivil, 1)) : existing.endExclusiveUtc;
    const drawDate = drawDateScheduled ? new Date(drawDateScheduled) : existing.drawDateScheduled;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.customerSweepstake.update({
        where: { id_barbershopId: { id, barbershopId } },
        data: {
          title: title ? title.trim() : existing.title,
          description: description !== undefined ? description?.trim() || null : existing.description,
          startDateCivil: startDateCivil || existing.startDateCivil,
          endDateCivil: endDateCivil || existing.endDateCivil,
          startInclusiveUtc,
          endExclusiveUtc,
          drawDateScheduled: drawDate,
          participationMode: participationMode || existing.participationMode,
          targetSegment: targetSegment || existing.targetSegment,
          serviceIds: serviceIds === null ? Prisma.JsonNull : serviceIds !== undefined ? serviceIds : existing.serviceIds,
          allowMultiplePrizesPerUser:
            allowMultiplePrizesPerUser !== undefined ? Boolean(allowMultiplePrizesPerUser) : existing.allowMultiplePrizesPerUser,
          drawMethod: drawMethod || existing.drawMethod,
          isRegulatedPromotion:
            isRegulatedPromotion !== undefined ? Boolean(isRegulatedPromotion) : existing.isRegulatedPromotion,
          authorizationCode: authorizationCode !== undefined ? authorizationCode?.trim() || null : existing.authorizationCode,
          regulationsSummary: regulationsSummary !== undefined ? regulationsSummary?.trim() || null : existing.regulationsSummary,
          regulationsDocumentUrl:
            regulationsDocumentUrl !== undefined ? regulationsDocumentUrl?.trim() || null : existing.regulationsDocumentUrl,
          federalLotteryContestNumber:
            federalLotteryContestNumber !== undefined
              ? federalLotteryContestNumber?.trim() || null
              : existing.federalLotteryContestNumber,
        },
      });

      if (Array.isArray(prizes) && prizes.length > 0) {
        await tx.customerSweepstakePrize.deleteMany({ where: { sweepstakeId: id, barbershopId } });
        for (let i = 0; i < prizes.length; i++) {
          const p = prizes[i];
          await tx.customerSweepstakePrize.create({
            data: {
              sweepstakeId: id,
              barbershopId,
              position: i + 1,
              title: p.title?.trim() || `Prêmio ${i + 1}`,
              description: p.description?.trim() || null,
            },
          });
        }
      }

      return tx.customerSweepstake.findUniqueOrThrow({
        where: { id_barbershopId: { id, barbershopId } },
        include: { prizes: { orderBy: { position: "asc" } } },
      });
    });

    return NextResponse.json({ sweepstake: updated });
  } catch (err: any) {
    console.error("Erro ao atualizar sorteio:", err);
    return NextResponse.json({ error: err.message || "Erro ao processar edição." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  const existing = await prisma.customerSweepstake.findUnique({
    where: { id_barbershopId: { id, barbershopId } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Campanha de sorteio não encontrada." }, { status: 404 });
  }

  if (existing.status === "DRAFT") {
    // Rascunho pode ser excluído
    await prisma.customerSweepstake.delete({
      where: { id_barbershopId: { id, barbershopId } },
    });
    return NextResponse.json({ success: true, message: "Rascunho excluído com sucesso." });
  }

  // Imutabilidade do histórico: campanhas apuradas/auditadas preservam status, ganhadores e ata.
  if (existing.status === "DRAWN" || existing.status === "AUDITED") {
    return NextResponse.json(
      { error: `Campanha com status ${existing.status} é imutável e não pode ser cancelada ou excluída.` },
      { status: 422 }
    );
  }

  if (existing.status === "CANCELLED") {
    return NextResponse.json({ error: "Campanha já está cancelada." }, { status: 422 });
  }

  // Se já foi ativada ou congelada (ainda não apurada), marcar como CANCELLED
  const cancelled = await prisma.customerSweepstake.update({
    where: { id_barbershopId: { id, barbershopId } },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ success: true, sweepstake: cancelled, message: "Campanha cancelada com sucesso." });
}
