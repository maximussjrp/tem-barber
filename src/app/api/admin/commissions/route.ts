import { NextRequest, NextResponse } from "next/server";
import { CommissionPeriodStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

function getCompetence(request: NextRequest) {
  return request.nextUrl.searchParams.get("competence") || new Date().toISOString().slice(0, 7);
}

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const startDateParam = request.nextUrl.searchParams.get("startDate");
  const endDateParam = request.nextUrl.searchParams.get("endDate");
  const memberId = request.nextUrl.searchParams.get("memberId") || undefined;

  if (startDateParam && endDateParam) {
    const startDate = localDateToUTCBoundary(startDateParam);
    const endDate = localDateToUTCBoundary(shiftDateISO(endDateParam, 1));

    const [entries, adjustments, members] = await Promise.all([
      prisma.commissionEntry.findMany({
        where: {
          barbershopId: data!.barbershopId!,
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
          ...(memberId ? { memberId } : {}),
        },
      }),
      prisma.commissionAdjustment.findMany({
        where: {
          barbershopId: data!.barbershopId!,
          createdAt: { gte: startDate, lt: endDate },
          ...(memberId ? { memberId } : {}),
        },
      }),
      prisma.barbershopMember.findMany({
        where: {
          barbershopId: data!.barbershopId!,
          isActive: true,
          ...(memberId ? { id: memberId } : {}),
        },
        include: { user: { select: { name: true } } },
      }),
    ]);

    const memberSums = new Map<string, {
      generated: number;
      released: number;
      paid: number;
      reversals: number;
      signedAdjustments: number;
    }>();

    for (const entry of entries) {
      const sums = memberSums.get(entry.memberId) || { generated: 0, released: 0, paid: 0, reversals: 0, signedAdjustments: 0 };
      sums.generated += Math.round(Number(entry.generatedAmount) * 100);
      sums.released += Math.round(Number(entry.releasedAmount) * 100);
      sums.paid += Math.round(Number(entry.paidAmount) * 100);
      memberSums.set(entry.memberId, sums);
    }

    for (const adj of adjustments) {
      const sums = memberSums.get(adj.memberId) || { generated: 0, released: 0, paid: 0, reversals: 0, signedAdjustments: 0 };
      const amount = Math.round(Number(adj.amount) * 100);
      if (adj.type === "REVERSAL") {
        sums.reversals += Math.abs(amount);
      } else if (adj.type === "PAID_ADJUSTMENT") {
        sums.signedAdjustments += amount;
        if (amount < 0) {
          sums.reversals += Math.abs(amount);
        }
      }
      memberSums.set(adj.memberId, sums);
    }

    const result = members.map((m) => {
      const sums = memberSums.get(m.id) || { generated: 0, released: 0, paid: 0, reversals: 0, signedAdjustments: 0 };
      const balance = sums.released - sums.paid + sums.signedAdjustments;
      return {
        id: m.id,
        competence: `${startDateParam} / ${endDateParam}`,
        status: "REPORT",
        generatedAmount: (sums.generated / 100).toFixed(2),
        releasedAmount: (sums.released / 100).toFixed(2),
        paidAmount: (sums.paid / 100).toFixed(2),
        reversedAmount: (sums.reversals / 100).toFixed(2),
        balanceAmount: (Math.max(0, balance) / 100).toFixed(2),
        member: { user: { name: m.user.name } },
      };
    });

    return NextResponse.json(result);
  }

  const competence = getCompetence(request);
  const statusParam = request.nextUrl.searchParams.get("status") || undefined;
  const status = statusParam && Object.values(CommissionPeriodStatus).includes(statusParam as CommissionPeriodStatus)
    ? (statusParam as CommissionPeriodStatus)
    : undefined;

  const periods = await prisma.commissionPeriod.findMany({
    where: {
      barbershopId: data!.barbershopId!,
      competence,
      ...(memberId ? { memberId } : {}),
      ...(status ? { status } : {}),
    },
    include: { member: { include: { user: { select: { name: true } } } } },
    orderBy: [{ status: "asc" }, { member: { user: { name: "asc" } } }],
  });
  return NextResponse.json(periods);
}
