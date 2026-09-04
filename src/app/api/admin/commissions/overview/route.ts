import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(_request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;

  // Zero side-effects: fetch active members and their current OPEN cycle
  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId, isActive: true },
    include: {
      user: { select: { id: true, name: true, email: true } },
      commissionCycles: {
        where: { status: "OPEN" },
        orderBy: { cycleNumber: "desc" },
        take: 1,
      },
    },
    orderBy: { user: { name: "asc" } },
  });

  const overview = members.map((m) => {
    const cycle = m.commissionCycles[0] || null;
    return {
      member: {
        id: m.id,
        name: m.user?.name ?? "Sem nome",
        role: m.role,
      },
      currentCycle: cycle
        ? {
            id: cycle.id,
            cycleNumber: cycle.cycleNumber,
            status: cycle.status,
            grossCommission: Number(cycle.grossCommission),
            adjustmentsTotal: Number(cycle.adjustmentsTotal),
            advancesTotal: Number(cycle.advancesTotal),
            remainingBalance: Number(cycle.remainingBalance),
            openedAt: cycle.openedAt,
          }
        : null,
    };
  });

  return NextResponse.json({ overview });
}
