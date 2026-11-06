import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }

  const sweepstakes = await prisma.customerSweepstake.findMany({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    include: {
      prizes: { orderBy: { position: "asc" } },
      winners: { orderBy: { prizePosition: "asc" } },
      _count: {
        select: {
          participants: true,
          tickets: true,
          winners: true,
        },
      },
    },
  });

  return NextResponse.json({ sweepstakes });
}

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  if (!barbershopId || !userId) {
    return NextResponse.json({ error: "Sessão inválida ou barbearia não identificada." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      title,
      description,
      startDateCivil,
      endDateCivil,
      drawDateScheduled,
      participationMode = "ONE_PER_CUSTOMER",
      targetSegment = "ALL_CUSTOMERS",
      serviceIds = null,
      allowMultiplePrizesPerUser = false,
      drawMethod = "ELECTRONIC_DETERMINISTIC",
      isRegulatedPromotion = false,
      authorizationCode = null,
      regulationsSummary = null,
      regulationsDocumentUrl = null,
      federalLotteryContestNumber = null,
      prizes = [],
    } = body;

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      return NextResponse.json({ error: "Título da campanha é obrigatório (mínimo 3 caracteres)." }, { status: 400 });
    }

    if (!startDateCivil || !endDateCivil || !/^\d{4}-\d{2}-\d{2}$/.test(startDateCivil) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateCivil)) {
      return NextResponse.json({ error: "Datas de início e fim devem estar no formato YYYY-MM-DD." }, { status: 400 });
    }

    if (startDateCivil > endDateCivil) {
      return NextResponse.json({ error: "Data de início não pode ser posterior à data de término." }, { status: 400 });
    }

    if (!prizes || !Array.isArray(prizes) || prizes.length === 0) {
      return NextResponse.json({ error: "Cadastre pelo menos 1 prêmio para a campanha." }, { status: 400 });
    }

    const startInclusiveUtc = localDateToUTCBoundary(startDateCivil);
    const endExclusiveUtc = localDateToUTCBoundary(shiftDateISO(endDateCivil, 1));
    const drawDate = drawDateScheduled ? new Date(drawDateScheduled) : endExclusiveUtc;

    // Criar a campanha em transação com seus prêmios
    const sweepstake = await prisma.$transaction(async (tx) => {
      const created = await tx.customerSweepstake.create({
        data: {
          barbershopId,
          title: title.trim(),
          description: description?.trim() || null,
          startDateCivil,
          endDateCivil,
          startInclusiveUtc,
          endExclusiveUtc,
          drawDateScheduled: drawDate,
          status: "DRAFT",
          participationMode,
          targetSegment,
          serviceIds: Array.isArray(serviceIds) && serviceIds.length > 0 ? serviceIds : Prisma.JsonNull,
          allowMultiplePrizesPerUser: Boolean(allowMultiplePrizesPerUser),
          drawMethod,
          isRegulatedPromotion: Boolean(isRegulatedPromotion),
          authorizationCode: authorizationCode?.trim() || null,
          regulationsSummary: regulationsSummary?.trim() || null,
          regulationsDocumentUrl: regulationsDocumentUrl?.trim() || null,
          federalLotteryContestNumber: federalLotteryContestNumber?.trim() || null,
          createdById: userId,
        },
      });

      // Inserir os prêmios
      for (let i = 0; i < prizes.length; i++) {
        const p = prizes[i];
        await tx.customerSweepstakePrize.create({
          data: {
            sweepstakeId: created.id,
            barbershopId,
            position: i + 1,
            title: p.title?.trim() || `Prêmio ${i + 1}`,
            description: p.description?.trim() || null,
          },
        });
      }

      return tx.customerSweepstake.findUniqueOrThrow({
        where: { id_barbershopId: { id: created.id, barbershopId } },
        include: { prizes: { orderBy: { position: "asc" } } },
      });
    });

    return NextResponse.json({ sweepstake }, { status: 201 });
  } catch (err: any) {
    console.error("Erro ao criar campanha de sorteio:", err);
    return NextResponse.json({ error: err.message || "Erro ao processar criação." }, { status: 500 });
  }
}
