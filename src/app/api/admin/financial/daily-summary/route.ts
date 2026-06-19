import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/operations/permissions";
import { toCents } from "@/lib/operations/money";

function money(value: number) {
  return Number((value / 100).toFixed(2));
}

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const date = request.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

  const [payments, entries, commandCounts, receivables] = await Promise.all([
    prisma.payment.findMany({
      where: { barbershopId: data!.barbershopId, paidAt: { gte: start, lte: end } },
    }),
    prisma.financialEntry.findMany({
      where: { barbershopId: data!.barbershopId, entryDate: { gte: start, lte: end } },
      orderBy: { entryDate: "desc" },
    }),
    prisma.comanda.groupBy({
      by: ["status"],
      where: { barbershopId: data!.barbershopId, openedAt: { gte: start, lte: end } },
      _count: { _all: true },
    }),
    prisma.comanda.aggregate({
      where: {
        barbershopId: data!.barbershopId,
        status: { in: ["OPEN", "IN_SERVICE", "PENDING_PAYMENT"] },
      },
      _sum: { remainingTotal: true },
    }),
  ]);

  const byMethod: Record<string, number> = { CASH: 0, PIX: 0, DEBIT: 0, CREDIT: 0, OTHER: 0 };
  let refunds = 0;
  for (const payment of payments) {
    if (payment.status === "REFUNDED") refunds += Math.abs(toCents(payment.amount));
    else byMethod[payment.method] += toCents(payment.amount);
  }

  const manualIn = entries
    .filter((entry) => entry.type === "MANUAL_IN")
    .reduce((sum, entry) => sum + toCents(entry.amount), 0);
  const manualOut = entries
    .filter((entry) => entry.type === "MANUAL_OUT")
    .reduce((sum, entry) => sum + Math.abs(toCents(entry.amount)), 0);

  const totalReceived = Object.values(byMethod).reduce((sum, value) => sum + value, 0);
  const counts = Object.fromEntries(commandCounts.map((row) => [row.status, row._count._all]));

  const movements = [
    ...payments.map((p) => ({
      id: p.id,
      time: p.paidAt,
      description: p.comandaId ? `Comanda ${p.comandaId.split("-")[0]}` : "Avulso",
      type: p.status === "REFUNDED" ? "ESTORNO" : "RECEBIMENTO",
      method: p.method,
      amount: money(toCents(p.amount)),
      status: p.status,
    })),
    ...entries.map((e) => ({
      id: e.id,
      time: e.entryDate,
      description: e.description,
      type: e.type,
      method: "MANUAL",
      amount: money(toCents(e.amount)),
      status: "CONFIRMED",
    })),
  ].sort((a, b) => b.time.getTime() - a.time.getTime());

  return NextResponse.json({
    date,
    totalReceived: money(totalReceived),
    cash: money(byMethod.CASH),
    pix: money(byMethod.PIX),
    debit: money(byMethod.DEBIT),
    credit: money(byMethod.CREDIT),
    other: money(byMethod.OTHER),
    refunds: money(refunds),
    manualIn: money(manualIn),
    manualOut: money(manualOut),
    net: money(totalReceived + manualIn - manualOut - refunds),
    openCommands: counts.OPEN ?? 0,
    pendingCommands: counts.PENDING_PAYMENT ?? 0,
    closedCommands: counts.CLOSED ?? 0,
    receivable: money(toCents(receivables._sum.remainingTotal)),
    movements,
  });
}

