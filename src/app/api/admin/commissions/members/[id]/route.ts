import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id: memberId } = await params;
  const barbershopId = data!.barbershopId;

  // Tenant-qualification: verify member belongs to session tenant
  const member = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!member) {
    return NextResponse.json({ error: "Profissional não encontrado." }, { status: 404 });
  }

  // Zero side-effects: fetch current OPEN cycle, historical cycles, advances, payouts
  const [currentCycle, historicalCycles, advances, payouts] = await Promise.all([
    prisma.commissionCycle.findFirst({
      where: { barbershopId, memberId, status: "OPEN" },
      orderBy: { cycleNumber: "desc" },
      include: {
        payableItems: {
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        adjustments: {
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.commissionCycle.findMany({
      where: { barbershopId, memberId, status: "PAID" },
      orderBy: { cycleNumber: "desc" },
      take: 20,
    }),
    prisma.commissionAdvance.findMany({
      where: { barbershopId, memberId },
      include: { reversals: true },
      orderBy: { disbursedAt: "desc" },
      take: 50,
    }),
    prisma.commissionPayout.findMany({
      where: { barbershopId, memberId },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({
    member: {
      id: member.id,
      name: member.user?.name ?? "Sem nome",
      role: member.role,
    },
    currentCycle: currentCycle
      ? {
          id: currentCycle.id,
          cycleNumber: currentCycle.cycleNumber,
          status: currentCycle.status,
          grossCommission: Number(currentCycle.grossCommission),
          adjustmentsTotal: Number(currentCycle.adjustmentsTotal),
          advancesTotal: Number(currentCycle.advancesTotal),
          remainingBalance: Number(currentCycle.remainingBalance),
          openedAt: currentCycle.openedAt,
          payableItems: currentCycle.payableItems.map((p) => ({
            id: p.id,
            type: p.type,
            amount: Number(p.amount),
            sourceKind: p.sourceKind,
            createdAt: p.createdAt,
          })),
          adjustments: currentCycle.adjustments.map((a) => ({
            id: a.id,
            type: a.type,
            amount: Number(a.amount),
            reason: a.reason,
            createdAt: a.createdAt,
          })),
        }
      : null,
    historicalCycles: historicalCycles.map((c) => ({
      id: c.id,
      cycleNumber: c.cycleNumber,
      status: c.status,
      grossCommission: Number(c.grossCommission),
      adjustmentsTotal: Number(c.adjustmentsTotal),
      advancesTotal: Number(c.advancesTotal),
      finalPayoutAmount: Number(c.finalPayoutAmount),
      remainingBalance: Number(c.remainingBalance),
      openedAt: c.openedAt,
      closedAt: c.closedAt,
      paidAt: c.paidAt,
    })),
    advances: advances.map((a) => ({
      id: a.id,
      cycleId: a.cycleId,
      amount: Number(a.amount),
      paymentMethod: a.paymentMethod,
      disbursedAt: a.disbursedAt,
      notes: a.notes,
      reversals: a.reversals.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        returnMethod: r.returnMethod,
        reason: r.reason,
        returnedAt: r.returnedAt,
      })),
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      cycleId: p.cycleId,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt,
      notes: p.notes,
    })),
  });
}
