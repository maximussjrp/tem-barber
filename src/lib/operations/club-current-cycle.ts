import {
  ClubPaymentStatus,
  ClubPointStatus,
  ClubSettlementStatus,
  ClubBenefitUsageStatus,
} from "@prisma/client";
import prisma from "../prisma";
import { toCents } from "./money";

export interface CycleBarberShare {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  servicesCount: number;
  points: string;
  sharePercent: string;
  estimatedAmount: string;
}

export interface CurrentCycleSummary {
  cycle: {
    since: string | null;
    isFirstCycle: boolean;
    hasPoints: boolean;
    canClose: boolean;
    closedReason: string | null;
  };
  totals: {
    totalRevenue: string | null;
    barberPool: string;
    shopPool: string | null;
    totalPoints: string;
    totalServicesCount: number;
  };
  barbers: CycleBarberShare[];
}

export async function getCurrentCycleSummary(params: {
  barbershopId: string;
  role: string;
}): Promise<CurrentCycleSummary> {
  // 1. Cutoff date: last PAID settlement updatedAt date
  const lastPaidSettlement = await prisma.clubSettlement.findFirst({
    where: {
      barbershopId: params.barbershopId,
      status: ClubSettlementStatus.PAID,
    },
    orderBy: { updatedAt: "desc" },
  });

  const cutoff = lastPaidSettlement ? lastPaidSettlement.updatedAt : null;

  // 2. Fetch PAID payments in current cycle (paidAt > cutoff)
  const payments = await prisma.clubSubscriptionPayment.findMany({
    where: {
      barbershopId: params.barbershopId,
      status: ClubPaymentStatus.PAID,
      ...(cutoff ? { paidAt: { gt: cutoff } } : {}),
    },
  });

  let totalRevenueCents = 0;
  let barberPoolCents = 0;
  let shopPoolCents = 0;

  for (const payment of payments) {
    const amtCents = toCents(payment.amount);
    totalRevenueCents += amtCents;

    const shopPct = Number(payment.shopSharePercentSnapshot);
    const shopPortion = Math.round((amtCents * shopPct) / 100);
    const poolPortion = amtCents - shopPortion;

    shopPoolCents += shopPortion;
    barberPoolCents += poolPortion;
  }

  // 3. Fetch GENERATED point entries in current cycle (createdAt > cutoff, settlementId is null)
  const pointEntries = await prisma.clubPointEntry.findMany({
    where: {
      barbershopId: params.barbershopId,
      status: ClubPointStatus.GENERATED,
      settlementId: null,
      ...(cutoff ? { createdAt: { gt: cutoff } } : {}),
    },
  });

  const totalPoints = pointEntries.reduce((sum, p) => sum + Number(p.points), 0);

  // 4. Fetch valid APPLIED benefit usages for services count (usedAt > cutoff)
  const benefitUsages = await prisma.clubBenefitUsage.findMany({
    where: {
      barbershopId: params.barbershopId,
      status: ClubBenefitUsageStatus.APPLIED,
      ...(cutoff ? { usedAt: { gt: cutoff } } : {}),
    },
    select: {
      comandaItemId: true,
      serviceId: true,
      productId: true,
    },
  });

  const totalServicesCount = benefitUsages.length;

  // 5. Fetch all active barbershop members
  const activeMembers = await prisma.barbershopMember.findMany({
    where: {
      barbershopId: params.barbershopId,
      isActive: true,
    },
    include: {
      user: { select: { name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Calculate member points map
  const memberPointsMap = new Map<string, number>();
  for (const p of pointEntries) {
    const curr = memberPointsMap.get(p.memberId) ?? 0;
    memberPointsMap.set(p.memberId, curr + Number(p.points));
  }

  // Map comandaItemId to memberId via point entries
  const pointEntryMemberByComandaItem = new Map<string, string>();
  for (const p of pointEntries) {
    pointEntryMemberByComandaItem.set(p.comandaItemId, p.memberId);
  }

  const memberServicesMap = new Map<string, number>();
  for (const u of benefitUsages) {
    const memberId = pointEntryMemberByComandaItem.get(u.comandaItemId);
    if (memberId) {
      const curr = memberServicesMap.get(memberId) ?? 0;
      memberServicesMap.set(memberId, curr + 1);
    }
  }

  // Build barbers list
  const barbersList = activeMembers.map((m) => {
    const pts = memberPointsMap.get(m.id) ?? 0;
    const servicesCount = memberServicesMap.get(m.id) ?? 0;
    return {
      memberId: m.id,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl ?? null,
      servicesCount,
      points: pts,
    };
  });

  // Calculate shares and estimated amounts
  let barberShares: CycleBarberShare[] = [];

  if (totalPoints > 0) {
    // Sort deterministically by memberId to distribute remainder cents
    const sortedMembers = [...barbersList].sort((a, b) => a.memberId.localeCompare(b.memberId));

    let distributedCents = 0;
    const memberAmounts = sortedMembers.map((m) => {
      const shareCents = Math.floor((m.points / totalPoints) * barberPoolCents);
      distributedCents += shareCents;
      return {
        ...m,
        amountCents: shareCents,
      };
    });

    let remainderCents = barberPoolCents - distributedCents;
    let i = 0;
    while (remainderCents > 0 && memberAmounts.length > 0) {
      memberAmounts[i % memberAmounts.length].amountCents += 1;
      remainderCents -= 1;
      i += 1;
    }

    barberShares = memberAmounts.map((m) => {
      const pct = (m.points / totalPoints) * 100;
      return {
        memberId: m.memberId,
        name: m.name,
        avatarUrl: m.avatarUrl,
        servicesCount: m.servicesCount,
        points: m.points.toFixed(4),
        sharePercent: pct.toFixed(2),
        estimatedAmount: (m.amountCents / 100).toFixed(2),
      };
    });
  } else {
    // Zero points: return all active members zeroed
    barberShares = barbersList.map((m) => ({
      memberId: m.memberId,
      name: m.name,
      avatarUrl: m.avatarUrl,
      servicesCount: 0,
      points: "0.0000",
      sharePercent: "0.00",
      estimatedAmount: "0.00",
    }));
  }

  const isOwner = ["OWNER", "SUPER_ADMIN"].includes(params.role);

  return {
    cycle: {
      since: cutoff ? cutoff.toISOString() : null,
      isFirstCycle: !lastPaidSettlement,
      hasPoints: totalPoints > 0,
      canClose: false, // LOTE A is strictly read-only
      closedReason: totalPoints === 0 ? "ZERO_POINTS" : "READ_ONLY_PREVIEW",
    },
    totals: {
      totalRevenue: isOwner ? (totalRevenueCents / 100).toFixed(2) : null,
      barberPool: (barberPoolCents / 100).toFixed(2),
      shopPool: isOwner ? (shopPoolCents / 100).toFixed(2) : null,
      totalPoints: totalPoints.toFixed(4),
      totalServicesCount,
    },
    barbers: barberShares,
  };
}
