import { NextRequest, NextResponse } from "next/server";
import { CommissionPeriodStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

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
    const startDate = new Date(`${startDateParam}T00:00:00Z`);
    const endDate = new Date(`${endDateParam}T23:59:59Z`);

    const [entries, adjustments, paidPeriods, members] = await Promise.all([
      prisma.commissionEntry.findMany({
        where: {
          barbershopId: data!.barbershopId!,
          createdAt: { gte: startDate, lte: endDate },
          ...(memberId ? { memberId } : {}),
        },
      }),
      prisma.commissionAdjustment.findMany({
        where: {
          barbershopId: data!.barbershopId!,
          createdAt: { gte: startDate, lte: endDate },
          ...(memberId ? { memberId } : {}),
        },
      }),
      prisma.commissionPeriod.findMany({
        where: {
          barbershopId: data!.barbershopId!,
          paidAt: { gte: startDate, lte: endDate },
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
      reversed: number;
    }>();

    for (const entry of entries) {
      const sums = memberSums.get(entry.memberId) || { generated: 0, released: 0, paid: 0, reversed: 0 };
      sums.generated += Number(entry.generatedAmount);
      memberSums.set(entry.memberId, sums);
    }

    for (const adj of adjustments) {
      const sums = memberSums.get(adj.memberId) || { generated: 0, released: 0, paid: 0, reversed: 0 };
      if (adj.type === "RELEASE") {
        sums.released += Number(adj.amount);
      } else if (adj.type === "REVERSAL") {
        sums.reversed += Math.abs(Number(adj.amount));
      } else if (adj.type === "PAID_ADJUSTMENT") {
        const val = Number(adj.amount);
        if (val < 0) {
          sums.reversed += Math.abs(val);
        } else {
          sums.released += val;
        }
      }
      memberSums.set(adj.memberId, sums);
    }

    for (const p of paidPeriods) {
      const sums = memberSums.get(p.memberId) || { generated: 0, released: 0, paid: 0, reversed: 0 };
      sums.paid += Number(p.paidAmount);
      memberSums.set(p.memberId, sums);
    }

    const result = members.map((m) => {
      const sums = memberSums.get(m.id) || { generated: 0, released: 0, paid: 0, reversed: 0 };
      const balanceAmount = Math.max(0, sums.released - sums.paid - sums.reversed);
      return {
        id: m.id,
        competence: `${startDateParam} / ${endDateParam}`,
        status: "REPORT",
        generatedAmount: sums.generated.toFixed(2),
        releasedAmount: sums.released.toFixed(2),
        paidAmount: sums.paid.toFixed(2),
        reversedAmount: sums.reversed.toFixed(2),
        balanceAmount: balanceAmount.toFixed(2),
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
