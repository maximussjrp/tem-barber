/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const memberId = data!.memberId;

  // Zero side-effects: fetch member's current OPEN cycle, historical cycles, and legacy period
  const competence = request.nextUrl.searchParams.get("competence") || new Date().toISOString().slice(0, 7);

  const [currentCycle, historicalCycles, advances, payouts, awaitingEntries, legacyPeriod, legacyEntries, legacyAdjustments] =
    await Promise.all([
      prisma.commissionCycle.findFirst({
        where: { barbershopId, memberId, status: "OPEN" },
        orderBy: { cycleNumber: "desc" },
        include: {
          payableItems: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: {
              entry: {
                include: {
                  comandaItem: {
                    select: {
                      description: true,
                      total: true,
                      completedAt: true,
                      type: true,
                      comanda: {
                        select: {
                          customerName: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          adjustments: {
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      prisma.commissionCycle.findMany({
        where: { barbershopId, memberId, status: "PAID" },
        orderBy: { cycleNumber: "desc" },
        take: 12,
      }),
      prisma.commissionAdvance.findMany({
        where: { barbershopId, memberId },
        include: { reversals: true },
        orderBy: { disbursedAt: "desc" },
        take: 20,
      }),
      prisma.commissionPayout.findMany({
        where: { barbershopId, memberId },
        orderBy: { paidAt: "desc" },
        take: 20,
      }),
      prisma.commissionEntry.findMany({
        where: {
          barbershopId,
          memberId,
          isCurrent: true,
          releasedAmount: 0,
          generatedAmount: { gt: 0 },
          comandaItem: {
            status: "DONE",
            comanda: {
              status: "OPEN",
            },
          },
        },
        include: {
          comandaItem: {
            select: {
              description: true,
              total: true,
              completedAt: true,
              type: true,
              comanda: {
                select: {
                  customerName: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      // Legacy compatibility (no live queries to legacy tables)
      Promise.resolve(null),
      Promise.resolve([]),
      Promise.resolve([]),
    ]);

  const paidTotal = historicalCycles.reduce((sum, c) => sum + Number(c.finalPayoutAmount), 0);

  return NextResponse.json({
    currentCycle: currentCycle
      ? {
          id: currentCycle.id,
          cycleNumber: currentCycle.cycleNumber,
          status: currentCycle.status,
          accumulatedCommission: Number(currentCycle.grossCommission),
          netAdvances: Number(currentCycle.advancesTotal),
          remainingPayable: Number(currentCycle.remainingBalance),
          openedAt: currentCycle.openedAt,
          payableItems: currentCycle.payableItems.map((p) => {
            const entry = p.entry;
            const item = entry?.comandaItem;
            const snapshot = (entry?.configSnapshot as any) || {};
            const rateLabel =
              snapshot.type === "PERCENTAGE"
                ? `${snapshot.value}%`
                : snapshot.type === "FIXED"
                ? `R$ ${Number(snapshot.value || 0).toFixed(2)}`
                : null;

            return {
              id: p.id,
              type: p.type,
              amount: Number(p.amount),
              sourceKind: p.sourceKind,
              isHistoricalCorrection: p.isHistoricalCorrection,
              createdAt: p.createdAt,
              description:
                item?.description ||
                (p.isHistoricalCorrection ? "Estorno de comissão histórica" : "Comissão"),
              customerName: item?.comanda?.customerName || null,
              baseAmount: entry ? Number(entry.baseAmount) : null,
              rateLabel,
            };
          }),
          adjustments: currentCycle.adjustments.map((a) => ({
            id: a.id,
            type: a.type,
            amount: Number(a.amount),
            reason: a.reason,
            createdAt: a.createdAt,
          })),
        }
      : null,
    accumulatedCommission: currentCycle ? Number(currentCycle.grossCommission) : 0,
    netAdvances: currentCycle ? Number(currentCycle.advancesTotal) : 0,
    remainingPayable: currentCycle ? Number(currentCycle.remainingBalance) : 0,
    paidTotal,
    awaitingCustomerPayment: awaitingEntries.map((e) => {
      const item = e.comandaItem;
      const snapshot = (e.configSnapshot as any) || {};
      const rateLabel =
        snapshot.type === "PERCENTAGE"
          ? `${snapshot.value}%`
          : snapshot.type === "FIXED"
          ? `R$ ${Number(snapshot.value || 0).toFixed(2)}`
          : null;

      return {
        id: e.id,
        description: item.description,
        customerName: item.comanda?.customerName || null,
        baseAmount: Number(e.baseAmount),
        estimatedCommission: Number(e.generatedAmount),
        rateLabel,
        completedAt: item.completedAt || e.createdAt,
      };
    }),
    historicalCycles: historicalCycles.map((c) => ({
      id: c.id,
      cycleNumber: c.cycleNumber,
      status: c.status,
      grossCommission: Number(c.grossCommission),
      advancesTotal: Number(c.advancesTotal),
      adjustmentsTotal: Number(c.adjustmentsTotal),
      finalPayoutAmount: Number(c.finalPayoutAmount),
      closedAt: c.closedAt,
      paidAt: c.paidAt,
    })),
    advances: advances.map((a) => {
      const reversalsTotal = a.reversals.reduce((sum, r) => sum + Number(r.amount), 0);
      return {
        id: a.id,
        cycleId: a.cycleId,
        amount: Number(a.amount),
        reversalsTotal,
        netAmount: Number(a.amount) - reversalsTotal,
        paymentMethod: a.paymentMethod,
        disbursedAt: a.disbursedAt,
        notes: a.notes,
        reversals: a.reversals.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          returnedAt: r.returnedAt,
          reason: r.reason,
        })),
      };
    }),
    payouts: payouts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt,
    })),
    // Backward compatibility with legacy UI
    period: legacyPeriod,
    entries: legacyEntries,
    adjustments: legacyAdjustments,
    competence,
  });
}
