import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id: cycleId } = await params;
  const barbershopId = data!.barbershopId;

  // Tenant-qualification: verify cycle belongs to session tenant
  const cycle = await prisma.commissionCycle.findFirst({
    where: { id: cycleId, barbershopId },
    include: {
      member: { include: { user: { select: { id: true, name: true } } } },
      payableItems: { orderBy: { createdAt: "desc" } },
      adjustments: { orderBy: { createdAt: "desc" } },
      advances: { include: { reversals: true }, orderBy: { disbursedAt: "desc" } },
      payout: true,
    },
  });

  if (!cycle) {
    return NextResponse.json({ error: "Ciclo não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    cycle: {
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      grossCommission: Number(cycle.grossCommission),
      adjustmentsTotal: Number(cycle.adjustmentsTotal),
      advancesTotal: Number(cycle.advancesTotal),
      finalPayoutAmount: Number(cycle.finalPayoutAmount),
      remainingBalance: Number(cycle.remainingBalance),
      openedAt: cycle.openedAt,
      closedAt: cycle.closedAt,
      paidAt: cycle.paidAt,
      member: {
        id: cycle.member.id,
        name: cycle.member.user?.name ?? "Sem nome",
      },
      payableItems: cycle.payableItems.map((p) => ({
        id: p.id,
        type: p.type,
        amount: Number(p.amount),
        sourceKind: p.sourceKind,
        createdAt: p.createdAt,
      })),
      adjustments: cycle.adjustments.map((a) => ({
        id: a.id,
        type: a.type,
        amount: Number(a.amount),
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      advances: cycle.advances.map((a) => ({
        id: a.id,
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
      payout: cycle.payout
        ? {
            id: cycle.payout.id,
            amount: Number(cycle.payout.amount),
            paymentMethod: cycle.payout.paymentMethod,
            paidAt: cycle.payout.paidAt,
            notes: cycle.payout.notes,
          }
        : null,
    },
  });
}
