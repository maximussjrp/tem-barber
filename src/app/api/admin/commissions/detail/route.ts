import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

function competenceToDates(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0)); // 00:00 local America/Sao_Paulo (UTC-3)
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(Date.UTC(nextYear, nextMonth - 1, 1, 3, 0, 0, 0)); // 00:00 local of next month
  return { start, end };
}

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const memberId = request.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Parâmetro memberId é obrigatório." }, { status: 400 });
  }

  const competence = request.nextUrl.searchParams.get("competence");
  const startDateParam = request.nextUrl.searchParams.get("startDate");
  const endDateParam = request.nextUrl.searchParams.get("endDate");

  let startDate: Date;
  let endDate: Date;

  if (startDateParam && endDateParam) {
    startDate = localDateToUTCBoundary(startDateParam);
    endDate = localDateToUTCBoundary(shiftDateISO(endDateParam, 1));
  } else if (competence) {
    const dates = competenceToDates(competence);
    startDate = dates.start;
    endDate = dates.end;
  } else {
    // Fallback para o mês corrente
    const currentComp = new Date().toISOString().slice(0, 7);
    const dates = competenceToDates(currentComp);
    startDate = dates.start;
    endDate = dates.end;
  }

  // 1. Buscar comissões do profissional no intervalo
  const entries = await prisma.commissionEntry.findMany({
    where: {
      barbershopId: data!.barbershopId!,
      memberId,
      OR: [
        {
          comandaItem: {
            comanda: {
              closedAt: { gte: startDate, lt: endDate },
            },
          },
        },
        {
          comandaItem: {
            comanda: {
              closedAt: null,
            },
          },
          createdAt: { gte: startDate, lt: endDate },
        },
      ],
    },
    include: {
      comandaItem: {
        include: {
          comanda: {
            select: {
              id: true,
              customerName: true,
              closedAt: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // 2. Buscar ajustes criados no intervalo
  const adjustments = await prisma.commissionAdjustment.findMany({
    where: {
      barbershopId: data!.barbershopId!,
      memberId,
      createdAt: { gte: startDate, lt: endDate },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // 3. Computar resumo em centavos
  let grossService = 0;
  let grossProduct = 0;
  let discount = 0;
  let netBase = 0;
  let generated = 0;
  let released = 0;
  let paid = 0;

  for (const entry of entries) {
    const itemTotal = Math.round(Number(entry.comandaItem.total) * 100);
    const base = Math.round(Number(entry.baseAmount) * 100);
    const gen = Math.round(Number(entry.generatedAmount) * 100);
    const rel = Math.round(Number(entry.releasedAmount) * 100);
    const p = Math.round(Number(entry.paidAmount) * 100);

    if (entry.type === "SERVICE") {
      grossService += itemTotal;
    } else {
      grossProduct += itemTotal;
    }
    
    discount += Math.max(0, itemTotal - base);
    netBase += base;
    generated += gen;
    released += rel;
    paid += p;
  }

  let reversals = 0;
  let rollover = 0;
  let manualAdjustments = 0;
  let signedAdjustments = 0;

  for (const adj of adjustments) {
    const amount = Math.round(Number(adj.amount) * 100);
    if (adj.type === "REVERSAL") {
      reversals += Math.abs(amount);
    } else if (adj.type === "PAID_ADJUSTMENT") {
      signedAdjustments += amount;
      if (adj.rolloverFromCompetence !== null) {
        rollover += amount;
        if (amount < 0) {
          reversals += Math.abs(amount);
        }
      } else {
        manualAdjustments += amount;
      }
    }
  }

  const balance = released - paid + signedAdjustments;

  return NextResponse.json({
    summary: {
      grossService: grossService / 100,
      grossProduct: grossProduct / 100,
      discount: discount / 100,
      netBase: netBase / 100,
      generated: generated / 100,
      released: released / 100,
      paid: paid / 100,
      reversals: reversals / 100,
      rollover: rollover / 100,
      manualAdjustments: manualAdjustments / 100,
      balance: balance / 100,
    },
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      description: entry.comandaItem.description,
      customerName: entry.comandaItem.comanda.customerName,
      date: entry.comandaItem.comanda.closedAt || entry.createdAt,
      baseAmount: Number(entry.baseAmount),
      generatedAmount: Number(entry.generatedAmount),
      releasedAmount: Number(entry.releasedAmount),
      paidAmount: Number(entry.paidAmount),
      reversedAmount: Number(entry.reversedAmount),
      status: entry.status,
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      type: adj.type,
      amount: Number(adj.amount),
      description: adj.description,
      competence: adj.competence,
      createdAt: adj.createdAt,
    })),
  });
}
