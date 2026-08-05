import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { localDateToUTCBoundary, shiftDateISO, todayIsoBR } from "@/lib/time-utils";

function monthRange(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const lastDay = new Date(year, month, 0);
  const yStr = String(year);
  const mStr = String(month).padStart(2, "0");
  return {
    startDate: `${yStr}-${mStr}-01`,
    endDate: `${yStr}-${mStr}-${String(lastDay.getDate()).padStart(2, "0")}`,
  };
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekRange(refDateStr: string) {
  const [y, m, d] = refDateStr.split("-").map(Number);
  const ref = new Date(y, m - 1, d);
  const day = ref.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(y, m - 1, d + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { startDate: formatLocalDate(monday), endDate: formatLocalDate(sunday) };
}

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const type = request.nextUrl.searchParams.get("type");
  const competence = request.nextUrl.searchParams.get("competence");
  let startDateParam = request.nextUrl.searchParams.get("startDate");
  let endDateParam = request.nextUrl.searchParams.get("endDate");
  const memberId = request.nextUrl.searchParams.get("memberId") || undefined;
  const status = request.nextUrl.searchParams.get("status") || undefined;
  const weekRefDate = request.nextUrl.searchParams.get("weekRefDate");

  if (type === "MONTHLY") {
    if (!competence) {
      return NextResponse.json({ error: "competence is required for MONTHLY type" }, { status: 400 });
    }
    const range = monthRange(competence);
    startDateParam = range.startDate;
    endDateParam = range.endDate;
  } else if (type === "WEEKLY") {
    const range = weekRange(weekRefDate || todayIsoBR());
    startDateParam = range.startDate;
    endDateParam = range.endDate;
  } else if (type === "BIWEEKLY") {
    if (!startDateParam || !endDateParam) {
      if (!competence) {
        return NextResponse.json({ error: "competence or startDate/endDate is required for BIWEEKLY type" }, { status: 400 });
      }
      const range = monthRange(competence);
      startDateParam = range.startDate;
      endDateParam = range.endDate;
    }
  } else if (type === "CUSTOM") {
    if (!startDateParam || !endDateParam) {
      return NextResponse.json({ error: "startDate and endDate are required for CUSTOM type" }, { status: 400 });
    }
  } else {
    if (!startDateParam || !endDateParam) {
      if (competence) {
        const range = monthRange(competence);
        startDateParam = range.startDate;
        endDateParam = range.endDate;
      } else {
         return NextResponse.json({ error: "startDate and endDate or competence is required" }, { status: 400 });
      }
    }
  }

  const utcStart = localDateToUTCBoundary(startDateParam!);
  const utcEnd = localDateToUTCBoundary(shiftDateISO(endDateParam!, 1));

  const [entries, adjustments] = await Promise.all([
    prisma.commissionEntry.findMany({
      where: {
        barbershopId: data!.barbershopId!,
        ...(memberId ? { memberId } : {}),
        ...(status ? { status: status as any } : {}),
        OR: [
          { comandaItem: { comanda: { closedAt: { gte: utcStart, lt: utcEnd } } } },
          { comandaItem: { comanda: { closedAt: null } }, createdAt: { gte: utcStart, lt: utcEnd } },
        ],
      },
      include: {
        comandaItem: {
          select: {
            type: true, total: true, quantity: true, discountAmount: true, comandaId: true, status: true,
            comanda: { select: { status: true, closedAt: true } }
          },
        },
        member: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.commissionAdjustment.findMany({
      where: {
        barbershopId: data!.barbershopId!,
        createdAt: { gte: utcStart, lt: utcEnd },
        ...(memberId ? { memberId } : {}),
      },
      include: {
        member: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

  const membersMap = new Map<string, any>();

  for (const entry of entries) {
    const mId = entry.memberId;
    if (!membersMap.has(mId)) {
      membersMap.set(mId, {
        memberId: mId,
        memberName: entry.member?.user?.name || "Desconhecido",
        commandCountSet: new Set<string>(),
        serviceCount: 0,
        productCount: 0,
        grossServiceAmount: 0,
        grossProductAmount: 0,
        discountAmount: 0,
        netBaseAmount: 0,
        generatedCommission: 0,
        releasedCommission: 0,
        paidCommission: 0,
        reversedCommission: 0,
        signedAdjustments: 0
      });
    }

    const m = membersMap.get(mId);

    if (entry.comandaItem.comandaId) {
      m.commandCountSet.add(entry.comandaItem.comandaId);
    }

    if (entry.comandaItem.type === "SERVICE") {
      m.serviceCount += Number(entry.comandaItem.quantity);
      m.grossServiceAmount += Math.round(Number(entry.comandaItem.total) * 100);
    } else if (entry.comandaItem.type === "PRODUCT") {
      m.productCount += Number(entry.comandaItem.quantity);
      m.grossProductAmount += Math.round(Number(entry.comandaItem.total) * 100);
    }

    m.discountAmount += Math.round(Number(entry.comandaItem.discountAmount) * 100);
    m.netBaseAmount += Math.round(Number(entry.baseAmount) * 100);
    m.generatedCommission += Math.round(Number(entry.generatedAmount) * 100);
    m.releasedCommission += Math.round(Number(entry.releasedAmount) * 100);
    m.paidCommission += Math.round(Number(entry.paidAmount) * 100);
  }

  for (const adj of adjustments) {
    const mId = adj.memberId;
    if (!membersMap.has(mId)) {
      membersMap.set(mId, {
        memberId: mId,
        memberName: adj.member?.user?.name || "Desconhecido",
        commandCountSet: new Set<string>(),
        serviceCount: 0,
        productCount: 0,
        grossServiceAmount: 0,
        grossProductAmount: 0,
        discountAmount: 0,
        netBaseAmount: 0,
        generatedCommission: 0,
        releasedCommission: 0,
        paidCommission: 0,
        reversedCommission: 0,
        signedAdjustments: 0
      });
    }

    const m = membersMap.get(mId);
    const amt = Math.round(Number(adj.amount) * 100);

    if (adj.type === "REVERSAL") {
      m.reversedCommission += Math.abs(amt);
    } else if (adj.type === "PAID_ADJUSTMENT") {
      m.signedAdjustments += amt;
      if (amt < 0) {
        m.reversedCommission += Math.abs(amt);
      }
    }
  }

  const summary = {
    commandCount: 0,
    serviceCount: 0,
    productCount: 0,
    grossServiceAmount: 0,
    grossProductAmount: 0,
    discountAmount: 0,
    netBaseAmount: 0,
    generatedCommission: 0,
    releasedCommission: 0,
    paidCommission: 0,
    reversedCommission: 0,
    balanceAmount: 0,
    barbershopNetAmount: 0,
  };

  const membersResult = Array.from(membersMap.values()).map(m => {
    const balance = m.releasedCommission - m.paidCommission + m.signedAdjustments;
    const finalBalance = Math.max(0, balance);
    const barbershopNet = m.netBaseAmount - m.generatedCommission;
    const grossTotal = m.grossServiceAmount + m.grossProductAmount;
    const commandCount = m.commandCountSet.size;
    const avgTicket = commandCount > 0 ? grossTotal / commandCount : 0;
    const effectiveRate = m.netBaseAmount > 0 ? (m.generatedCommission / m.netBaseAmount) * 100 : 0;

    summary.commandCount += commandCount;
    summary.serviceCount += m.serviceCount;
    summary.productCount += m.productCount;
    summary.grossServiceAmount += m.grossServiceAmount;
    summary.grossProductAmount += m.grossProductAmount;
    summary.discountAmount += m.discountAmount;
    summary.netBaseAmount += m.netBaseAmount;
    summary.generatedCommission += m.generatedCommission;
    summary.releasedCommission += m.releasedCommission;
    summary.paidCommission += m.paidCommission;
    summary.reversedCommission += m.reversedCommission;
    summary.balanceAmount += finalBalance;
    summary.barbershopNetAmount += barbershopNet;

    return {
      memberId: m.memberId,
      memberName: m.memberName,
      commandCount: commandCount,
      serviceCount: m.serviceCount,
      productCount: m.productCount,
      grossServiceAmount: (m.grossServiceAmount / 100).toFixed(2),
      grossProductAmount: (m.grossProductAmount / 100).toFixed(2),
      discountAmount: (m.discountAmount / 100).toFixed(2),
      netBaseAmount: (m.netBaseAmount / 100).toFixed(2),
      generatedCommission: (m.generatedCommission / 100).toFixed(2),
      releasedCommission: (m.releasedCommission / 100).toFixed(2),
      paidCommission: (m.paidCommission / 100).toFixed(2),
      reversedCommission: (m.reversedCommission / 100).toFixed(2),
      balanceAmount: (finalBalance / 100).toFixed(2),
      barbershopNetAmount: (barbershopNet / 100).toFixed(2),
      averageTicket: (avgTicket / 100).toFixed(2),
      effectiveCommissionRate: effectiveRate.toFixed(2)
    };
  });

  const sumGrossTotal = summary.grossServiceAmount + summary.grossProductAmount;
  const sumAvgTicket = summary.commandCount > 0 ? sumGrossTotal / summary.commandCount : 0;
  const sumEffectiveRate = summary.netBaseAmount > 0 ? (summary.generatedCommission / summary.netBaseAmount) * 100 : 0;

  const summaryFormatted = {
    commandCount: summary.commandCount,
    serviceCount: summary.serviceCount,
    productCount: summary.productCount,
    grossServiceAmount: (summary.grossServiceAmount / 100).toFixed(2),
    grossProductAmount: (summary.grossProductAmount / 100).toFixed(2),
    discountAmount: (summary.discountAmount / 100).toFixed(2),
    netBaseAmount: (summary.netBaseAmount / 100).toFixed(2),
    generatedCommission: (summary.generatedCommission / 100).toFixed(2),
    releasedCommission: (summary.releasedCommission / 100).toFixed(2),
    paidCommission: (summary.paidCommission / 100).toFixed(2),
    reversedCommission: (summary.reversedCommission / 100).toFixed(2),
    balanceAmount: (summary.balanceAmount / 100).toFixed(2),
    barbershopNetAmount: (summary.barbershopNetAmount / 100).toFixed(2),
    averageTicket: (sumAvgTicket / 100).toFixed(2),
    effectiveCommissionRate: sumEffectiveRate.toFixed(2)
  };

  return NextResponse.json({
    summary: summaryFormatted,
    members: membersResult,
    period: {
      startDate: startDateParam,
      endDate: endDateParam,
      type: type || "CUSTOM"
    }
  });
}
