import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { toCents } from "@/lib/operations/money";

function money(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function isValidDateString(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");

  if (!startDateStr || !endDateStr) {
    return NextResponse.json(
      { error: "As datas inicial e final (startDate e endDate) são obrigatórias." },
      { status: 400 }
    );
  }

  if (!isValidDateString(startDateStr) || !isValidDateString(endDateStr)) {
    return NextResponse.json(
      { error: "Formato de data inválido. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const [y1, m1, d1] = startDateStr.split("-").map(Number);
  const [y2, m2, d2] = endDateStr.split("-").map(Number);

  const start = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));

  if (end < start) {
    return NextResponse.json(
      { error: "A data final não pode ser anterior à data inicial." },
      { status: 400 }
    );
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 366) {
    return NextResponse.json(
      { error: "O período máximo permitido é de 366 dias." },
      { status: 400 }
    );
  }

  try {
    const [
      closedComandas,
      openComandas,
      payments,
      financialEntries,
      releasedCommissions,
      estimatedCommissions,
    ] = await Promise.all([
      // Concluded/closed comandas within period
      prisma.comanda.findMany({
        where: {
          barbershopId,
          status: "CLOSED",
          closedAt: { gte: start, lte: end },
        },
        include: {
          items: {
            where: { status: { not: "CANCELLED" } },
            include: {
              service: { select: { id: true, name: true } },
              executor: { select: { id: true, user: { select: { name: true } } } },
            },
          },
        },
      }),

      // Currently open/receivable comandas
      prisma.comanda.findMany({
        where: {
          barbershopId,
          status: { in: ["OPEN", "IN_SERVICE", "PENDING_PAYMENT"] },
        },
        select: {
          id: true,
          remainingTotal: true,
        },
      }),

      // Payments received in period
      prisma.payment.findMany({
        where: {
          barbershopId,
          paidAt: { gte: start, lte: end },
        },
      }),

      // Manual expenses in period
      prisma.financialEntry.findMany({
        where: {
          barbershopId,
          entryDate: { gte: start, lte: end },
          type: "MANUAL_OUT",
        },
      }),

      // Released commissions in period
      prisma.commissionEntry.findMany({
        where: {
          barbershopId,
          updatedAt: { gte: start, lte: end },
          status: { in: ["RELEASED", "PAID", "PARTIALLY_RELEASED"] },
        },
        select: {
          memberId: true,
          releasedAmount: true,
          reversedAmount: true,
        },
      }),

      // Estimated (generated, unreleased) commissions in period
      prisma.commissionEntry.findMany({
        where: {
          barbershopId,
          createdAt: { gte: start, lte: end },
          status: "GENERATED",
        },
        select: {
          generatedAmount: true,
        },
      }),
    ]);

    // 1. Calculations for Comandas & Items
    let grossRevenueCents = 0;
    let totalDiscountsCents = 0;

    const topServicesMap: Record<
      string,
      { serviceId: string; serviceName: string; quantity: number; grossRevenueCents: number; netRevenueCents: number }
    > = {};

    const topProfessionalsMap: Record<
      string,
      { memberId: string; name: string; serviceCount: number; grossRevenueCents: number; netRevenueCents: number }
    > = {};

    for (const comanda of closedComandas) {
      grossRevenueCents += toCents(comanda.subtotal);
      totalDiscountsCents += toCents(comanda.discountTotal);

      for (const item of comanda.items) {
        const itemGross = toCents(item.unitPrice) * Number(item.quantity);
        const itemNet = toCents(item.total);
        const qty = Number(item.quantity);

        // Top Services aggregation
        if (item.serviceId) {
          const sId = item.serviceId;
          const sName = item.service?.name || item.description;
          if (!topServicesMap[sId]) {
            topServicesMap[sId] = {
              serviceId: sId,
              serviceName: sName,
              quantity: 0,
              grossRevenueCents: 0,
              netRevenueCents: 0,
            };
          }
          topServicesMap[sId].quantity += qty;
          topServicesMap[sId].grossRevenueCents += itemGross;
          topServicesMap[sId].netRevenueCents += itemNet;
        }

        // Top Professionals aggregation
        if (item.executorId) {
          const mId = item.executorId;
          const mName = item.executor?.user?.name || "Profissional";
          if (!topProfessionalsMap[mId]) {
            topProfessionalsMap[mId] = {
              memberId: mId,
              name: mName,
              serviceCount: 0,
              grossRevenueCents: 0,
              netRevenueCents: 0,
            };
          }
          topProfessionalsMap[mId].serviceCount += qty;
          topProfessionalsMap[mId].grossRevenueCents += itemGross;
          topProfessionalsMap[mId].netRevenueCents += itemNet;
        }
      }
    }

    const netRevenueCents = grossRevenueCents - totalDiscountsCents;

    // 2. Open Comandas & Receivables
    let totalReceivableCents = 0;
    for (const openC of openComandas) {
      totalReceivableCents += toCents(openC.remainingTotal);
    }

    // 3. Payments & Methods
    const byMethod: Record<string, { cents: number; count: number }> = {
      CASH: { cents: 0, count: 0 },
      PIX: { cents: 0, count: 0 },
      DEBIT: { cents: 0, count: 0 },
      CREDIT: { cents: 0, count: 0 },
      OTHER: { cents: 0, count: 0 },
    };

    let refundCents = 0;
    for (const p of payments) {
      const amtCents = toCents(p.amount);
      if (p.status === "REFUNDED") {
        refundCents += Math.abs(amtCents);
      } else {
        const methodKey = byMethod[p.method] ? p.method : "OTHER";
        byMethod[methodKey].cents += amtCents;
        byMethod[methodKey].count += 1;
      }
    }

    const totalPaymentCents = Object.values(byMethod).reduce((acc, curr) => acc + curr.cents, 0);
    const totalReceivedCents = totalPaymentCents - refundCents;

    const paymentMethodsList = Object.entries(byMethod).map(([method, data]) => ({
      method,
      amount: money(data.cents),
      count: data.count,
    }));

    // 4. Expenses
    const totalExpensesCents = financialEntries.reduce(
      (sum, entry) => sum + Math.abs(toCents(entry.amount)),
      0
    );

    // 5. Commissions
    let releasedCommissionsCents = 0;
    const memberCommissionsMap: Record<string, number> = {};

    for (const comm of releasedCommissions) {
      const netReleased = toCents(comm.releasedAmount) - toCents(comm.reversedAmount);
      const posReleased = Math.max(0, netReleased);
      releasedCommissionsCents += posReleased;

      if (comm.memberId) {
        memberCommissionsMap[comm.memberId] = (memberCommissionsMap[comm.memberId] || 0) + posReleased;
      }
    }

    let estimatedCommissionsCents = 0;
    for (const comm of estimatedCommissions) {
      estimatedCommissionsCents += toCents(comm.generatedAmount);
    }

    // 6. Operational Result
    const operationalResultCents = totalReceivedCents - totalExpensesCents - releasedCommissionsCents;

    // 7. Format Top Services & Top Professionals
    const topServices = Object.values(topServicesMap)
      .map((s) => ({
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        quantity: s.quantity,
        grossRevenue: money(s.grossRevenueCents),
        netRevenue: money(s.netRevenueCents),
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue);

    const topProfessionals = Object.values(topProfessionalsMap)
      .map((p) => ({
        memberId: p.memberId,
        name: p.name,
        serviceCount: p.serviceCount,
        grossRevenue: money(p.grossRevenueCents),
        netRevenue: money(p.netRevenueCents),
        releasedCommissions: money(memberCommissionsMap[p.memberId] || 0),
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue);

    return NextResponse.json({
      period: {
        startDate: startDateStr,
        endDate: endDateStr,
        timezone: "America/Sao_Paulo",
      },
      totals: {
        grossRevenue: money(grossRevenueCents),
        totalDiscounts: money(totalDiscountsCents),
        netRevenue: money(netRevenueCents),
        totalReceived: money(totalReceivedCents),
        totalReceivable: money(totalReceivableCents),
        totalExpenses: money(totalExpensesCents),
        releasedCommissions: money(releasedCommissionsCents),
        estimatedCommissions: money(estimatedCommissionsCents),
        operationalResult: money(operationalResultCents),
      },
      paymentMethods: paymentMethodsList,
      topServices,
      topProfessionals,
      openCommands: {
        count: openComandas.length,
        amount: money(totalReceivableCents),
      },
      closedCommands: {
        count: closedComandas.length,
        amount: money(netRevenueCents),
      },
    });
  } catch {
    return NextResponse.json({ error: "Erro ao gerar resumo financeiro." }, { status: 500 });
  }
}
