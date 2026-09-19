import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/operations/permissions";
import { toCents } from "@/lib/operations/money";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

function money(value: number) {
  return Number((value / 100).toFixed(2));
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
  if (data!.role === "BARBER") {
    return NextResponse.json(
      {
        error: "FINANCIAL_TEAM_SCOPE_FORBIDDEN",
        message: "O resumo financeiro da equipe não está disponível para este perfil.",
      },
      { status: 403 }
    );
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const dateStr =
    dateParam && isValidDateString(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);

  const start = localDateToUTCBoundary(dateStr);
  const endExclusive = localDateToUTCBoundary(shiftDateISO(dateStr, 1));

  const [payments, entries, commandCounts, receivables] = await Promise.all([
    prisma.payment.findMany({
      where: { barbershopId: data!.barbershopId, paidAt: { gte: start, lt: endExclusive } },
    }),
    prisma.financialEntry.findMany({
      where: {
        barbershopId: data!.barbershopId,
        entryDate: { gte: start, lt: endExclusive },
        type: {
          in: [
            "MANUAL_IN",
            "MANUAL_OUT",
            "COMMISSION_ADVANCE",
            "COMMISSION_ADVANCE_REVERSAL",
            "COMMISSION_PAYOUT",
          ],
        },
      },
      include: {
        financialSettlement: {
          select: {
            title: {
              select: { kind: true },
            },
          },
        },
        financialSettlementReversal: {
          select: {
            settlement: {
              select: {
                title: {
                  select: { kind: true },
                },
              },
            },
          },
        },
      },
      orderBy: { entryDate: "desc" },
    }),
    prisma.comanda.groupBy({
      by: ["status"],
      where: { barbershopId: data!.barbershopId, openedAt: { gte: start, lt: endExclusive } },
      _count: { _all: true },
    }),
    prisma.comanda.aggregate({
      where: {
        barbershopId: data!.barbershopId,
        status: { not: "CANCELLED" },
        remainingTotal: { gt: 0 },
      },
      _sum: { remainingTotal: true },
    }),
  ]);

  const byMethod: Record<string, number> = {
    CASH: 0,
    PIX: 0,
    DEBIT: 0,
    CREDIT: 0,
    CUSTOMER_CREDIT: 0,
    OTHER: 0,
  };
  let cashRefunds = 0;
  let customerCreditRefunds = 0;
  for (const payment of payments) {
    if (payment.status === "REFUNDED") {
      if (payment.method === "CUSTOMER_CREDIT") {
        customerCreditRefunds += Math.abs(toCents(payment.amount));
      } else {
        cashRefunds += Math.abs(toCents(payment.amount));
      }
    } else {
      const m = byMethod[payment.method] !== undefined ? payment.method : "OTHER";
      byMethod[m] += toCents(payment.amount);
    }
  }

  let manualIn = 0;
  let manualOut = 0;
  let commissionAdvanceOut = 0;
  let commissionPayoutOut = 0;
  let commissionAdvanceReversalIn = 0;
  let titleReceivableCashNetCents = 0;
  let titlePayableExpenseNetCents = 0;

  for (const entry of entries) {
    const isTitleSettlement = entry.financialSettlementId !== null;
    const isTitleReversal = entry.financialSettlementReversalId !== null;
    const amtCents = toCents(entry.amount);

    if (!isTitleSettlement && !isTitleReversal) {
      if (entry.type === "MANUAL_IN") {
        manualIn += Math.max(0, amtCents);
      } else if (entry.type === "MANUAL_OUT") {
        manualOut += Math.abs(amtCents);
      } else if (entry.type === "COMMISSION_ADVANCE") {
        commissionAdvanceOut += Math.abs(amtCents);
      } else if (entry.type === "COMMISSION_PAYOUT") {
        commissionPayoutOut += Math.abs(amtCents);
      } else if (entry.type === "COMMISSION_ADVANCE_REVERSAL") {
        commissionAdvanceReversalIn += Math.max(0, amtCents);
      }
    } else {
      let titleKind: "RECEIVABLE" | "PAYABLE" | null = null;
      if (isTitleSettlement && entry.financialSettlement) {
        titleKind = entry.financialSettlement.title.kind;
      } else if (isTitleReversal && entry.financialSettlementReversal) {
        titleKind = entry.financialSettlementReversal.settlement.title.kind;
      }

      if (titleKind === "RECEIVABLE") {
        titleReceivableCashNetCents += amtCents;
      } else if (titleKind === "PAYABLE") {
        titlePayableExpenseNetCents += -amtCents;
      }
    }
  }

  const totalReceived =
    byMethod.CASH + byMethod.PIX + byMethod.DEBIT + byMethod.CREDIT + byMethod.OTHER;
  const counts = Object.fromEntries(commandCounts.map((row) => [row.status, row._count._all]));

  const netCents =
    totalReceived +
    manualIn +
    titleReceivableCashNetCents +
    commissionAdvanceReversalIn -
    manualOut -
    titlePayableExpenseNetCents -
    commissionAdvanceOut -
    commissionPayoutOut -
    cashRefunds;

  const movements = [
    ...payments.map((p) => ({
      id: p.id,
      time: p.paidAt,
      description: p.comandaId ? `Comanda ${p.comandaId.split("-")[0]}` : "Avulso",
      type: p.status === "REFUNDED" ? "ESTORNO" : "RECEBIMENTO",
      method: p.method,
      amount: money(Math.abs(toCents(p.amount))),
      status: p.status,
    })),
    ...entries.map((e) => {
      let movementType: string = e.type;
      const isSettlement = e.financialSettlementId !== null;
      const isReversal = e.financialSettlementReversalId !== null;

      if (isSettlement && e.financialSettlement) {
        movementType =
          e.financialSettlement.title.kind === "RECEIVABLE"
            ? "TITLE_RECEIVABLE_SETTLEMENT"
            : "TITLE_PAYABLE_SETTLEMENT";
      } else if (isReversal && e.financialSettlementReversal) {
        movementType =
          e.financialSettlementReversal.settlement.title.kind === "RECEIVABLE"
            ? "TITLE_RECEIVABLE_REVERSAL"
            : "TITLE_PAYABLE_REVERSAL";
      }

      return {
        id: e.id,
        time: e.entryDate,
        description: e.description,
        type: movementType,
        method: "FINANCIAL",
        amount: money(Math.abs(toCents(e.amount))),
        status: "CONFIRMED",
      };
    }),
  ].sort((a, b) => b.time.getTime() - a.time.getTime());

  return NextResponse.json({
    date: dateStr,
    totalReceived: money(totalReceived),
    cash: money(byMethod.CASH),
    pix: money(byMethod.PIX),
    debit: money(byMethod.DEBIT),
    credit: money(byMethod.CREDIT),
    customerCredit: money(byMethod.CUSTOMER_CREDIT),
    other: money(byMethod.OTHER),
    refunds: money(cashRefunds),
    customerCreditRefunds: money(customerCreditRefunds),
    manualIn: money(manualIn),
    manualOut: money(manualOut),
    titleReceivableCashNet: money(titleReceivableCashNetCents),
    titlePayableExpenseNet: money(titlePayableExpenseNetCents),
    commissionAdvanceOut: money(commissionAdvanceOut),
    commissionPayoutOut: money(commissionPayoutOut),
    commissionAdvanceReversalIn: money(commissionAdvanceReversalIn),
    net: money(netCents),
    openCommands: counts.OPEN ?? 0,
    pendingCommands: counts.PENDING_PAYMENT ?? 0,
    closedCommands: counts.CLOSED ?? 0,
    receivable: money(toCents(receivables._sum.remainingTotal)),
    movements,
  });
}
