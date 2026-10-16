/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { canManageFinancial } from "@/lib/operations/permissions";
import {
  executeCommissionPayout,
  CommissionError,
} from "@/lib/operations/commissions";
import { CommissionDisbursementMethod } from "@prisma/client";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

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

function isValidYearMonthString(str: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(str)) return false;
  const [y] = str.split("-").map(Number);
  return y >= 2000 && y <= 2100;
}

export function neutralizeSpreadsheetValue(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function formatCsvCell(value: unknown): string {
  const text = neutralizeSpreadsheetValue(value === null || value === undefined ? "" : String(value));
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  // RBAC: OWNER or MANAGER only
  if (!canManageFinancial(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  const memberId = searchParams.get("memberId")?.trim() || null;
  const startDateStr = searchParams.get("startDate")?.trim() || null;
  const endDateStr = searchParams.get("endDate")?.trim() || null;
  const yearMonthStr = searchParams.get("yearMonth")?.trim() || null;
  const paymentMethodParam = searchParams.get("paymentMethod")?.trim() || null;
  const searchQuery = searchParams.get("search")?.trim() || null;
  const format = searchParams.get("format")?.trim().toLowerCase() || null;

  const where: any = {
    barbershopId,
  };

  if (memberId) {
    const member = await prisma.barbershopMember.findFirst({
      where: { id: memberId, barbershopId },
    });
    if (!member) {
      return NextResponse.json({ error: "Profissional não encontrado." }, { status: 404 });
    }
    where.memberId = memberId;
  }

  // Date filtering in America/Sao_Paulo civil timezone
  if (startDateStr || endDateStr) {
    if (!startDateStr || !endDateStr) {
      return NextResponse.json(
        { error: "Datas inicial e final (startDate e endDate) devem ser fornecidas em conjunto." },
        { status: 400 }
      );
    }
    if (!isValidDateString(startDateStr) || !isValidDateString(endDateStr)) {
      return NextResponse.json(
        { error: "Formato de data inválido. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    const start = localDateToUTCBoundary(startDateStr);
    const endExclusive = localDateToUTCBoundary(shiftDateISO(endDateStr, 1));
    if (endExclusive <= start) {
      return NextResponse.json(
        { error: "A data final não pode ser anterior à data inicial." },
        { status: 400 }
      );
    }
    where.paidAt = { gte: start, lt: endExclusive };
  } else if (yearMonthStr) {
    if (!isValidYearMonthString(yearMonthStr)) {
      return NextResponse.json(
        { error: "Formato de mês/ano inválido. Use YYYY-MM." },
        { status: 400 }
      );
    }
    const [yStr, mStr] = yearMonthStr.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const startMonthStr = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const nextMonthStr = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    const start = localDateToUTCBoundary(startMonthStr);
    const endExclusive = localDateToUTCBoundary(nextMonthStr);
    where.paidAt = { gte: start, lt: endExclusive };
  }

  // Payment method filter
  if (paymentMethodParam) {
    const methodUpper = paymentMethodParam.toUpperCase();
    if (["NULL", "NONE", "UNSPECIFIED"].includes(methodUpper)) {
      where.paymentMethod = null;
    } else if (methodUpper !== "ALL" && methodUpper !== "") {
      if (!Object.values(CommissionDisbursementMethod).includes(methodUpper as any)) {
        return NextResponse.json(
          { error: "Método de pagamento inválido.", code: "INVALID_PAYMENT_METHOD" },
          { status: 422 }
        );
      }
      where.paymentMethod = methodUpper as CommissionDisbursementMethod;
    }
  }

  // Search filter (professional name or cycle number)
  if (searchQuery && searchQuery.length > 0) {
    const isNum = /^\d+$/.test(searchQuery);
    const cycleNum = isNum ? parseInt(searchQuery, 10) : NaN;
    where.OR = [
      { member: { user: { name: { contains: searchQuery, mode: "insensitive" } } } },
      ...(!isNaN(cycleNum) ? [{ cycle: { cycleNumber: cycleNum } }] : []),
    ];
  }

  // CSV Export Mode (full filtered set up to safety limit)
  if (format === "csv") {
    const MAX_CSV_EXPORT_LIMIT = 5000;
    const totalMatching = await prisma.commissionPayout.count({ where });
    if (totalMatching > MAX_CSV_EXPORT_LIMIT) {
      return NextResponse.json(
        {
          error: `O volume de registros para exportação (${totalMatching}) excede o limite operacional de ${MAX_CSV_EXPORT_LIMIT} registros. Refine os filtros ou reduza o intervalo de datas.`,
          code: "CSV_EXPORT_LIMIT_EXCEEDED",
          totalMatching,
          maxLimit: MAX_CSV_EXPORT_LIMIT,
        },
        { status: 422 }
      );
    }

    const csvPayouts = await prisma.commissionPayout.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: MAX_CSV_EXPORT_LIMIT,
      include: {
        member: {
          select: {
            id: true,
            role: true,
            isActive: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        cycle: {
          select: {
            id: true,
            cycleNumber: true,
            status: true,
            grossCommission: true,
            adjustmentsTotal: true,
            advancesTotal: true,
            finalPayoutAmount: true,
            remainingBalance: true,
            openedAt: true,
            closedAt: true,
            paidAt: true,
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });

    const headers = [
      "Data do Pagamento",
      "Profissional",
      "Status do Colaborador",
      "Ciclo",
      "Valor Pago (R$)",
      "Forma de Pagamento",
      "Comissão Bruta (R$)",
      "Adiantamentos (R$)",
      "Ajustes (R$)",
      "Responsável",
      "Observações",
    ];

    const rows = csvPayouts.map((p) => [
      new Date(p.paidAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) +
        " " +
        new Date(p.paidAt).toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
        }),
      p.member.user?.name ?? "Sem nome",
      p.member.isActive ? "Ativo" : "Inativo",
      `Ciclo #${p.cycle.cycleNumber}`,
      Number(p.amount).toFixed(2).replace(".", ","),
      p.paymentMethod ?? "Não informado",
      Number(p.cycle.grossCommission).toFixed(2).replace(".", ","),
      Number(p.cycle.advancesTotal).toFixed(2).replace(".", ","),
      Number(p.cycle.adjustmentsTotal).toFixed(2).replace(".", ","),
      p.createdBy?.name ?? "Sistema",
      p.notes ?? "",
    ]);

    const csvBody = [headers, ...rows]
      .map((row) => row.map(formatCsvCell).join(";"))
      .join("\r\n");

    const csvBuffer = Buffer.from(`\uFEFF${csvBody}`, "utf8");

    return new NextResponse(csvBuffer, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="historico-pagamentos-comissoes.csv"',
      },
    });
  }

  const payoutIncludes = {
    member: {
      select: {
        id: true,
        role: true,
        isActive: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    },
    cycle: {
      select: {
        id: true,
        cycleNumber: true,
        status: true,
        grossCommission: true,
        adjustmentsTotal: true,
        advancesTotal: true,
        finalPayoutAmount: true,
        remainingBalance: true,
        openedAt: true,
        closedAt: true,
        paidAt: true,
      },
    },
    createdBy: {
      select: {
        id: true,
        name: true,
      },
    },
  };

  const mapPayout = (p: any) => ({
    id: p.id,
    cycleId: p.cycleId,
    memberId: p.memberId,
    amount: Number(p.amount),
    paymentMethod: p.paymentMethod,
    paidAt: p.paidAt.toISOString(),
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    member: {
      id: p.member.id,
      name: p.member.user?.name ?? "Sem nome",
      role: p.member.role,
      isActive: p.member.isActive,
    },
    cycle: {
      id: p.cycle.id,
      cycleNumber: p.cycle.cycleNumber,
      status: p.cycle.status,
      grossCommission: Number(p.cycle.grossCommission),
      adjustmentsTotal: Number(p.cycle.adjustmentsTotal),
      advancesTotal: Number(p.cycle.advancesTotal),
      finalPayoutAmount: Number(p.cycle.finalPayoutAmount),
      remainingBalance: Number(p.cycle.remainingBalance),
      openedAt: p.cycle.openedAt.toISOString(),
      closedAt: p.cycle.closedAt ? p.cycle.closedAt.toISOString() : null,
      paidAt: p.cycle.paidAt ? p.cycle.paidAt.toISOString() : null,
    },
    createdBy: {
      id: p.createdBy.id,
      name: p.createdBy.name,
    },
  });

  // Print Mode (full filtered set up to safety limit of 5000)
  if (format === "print") {
    const MAX_PRINT_LIMIT = 5000;
    const totalMatching = await prisma.commissionPayout.count({ where });
    if (totalMatching > MAX_PRINT_LIMIT) {
      return NextResponse.json(
        {
          error: `O volume de registros para impressão (${totalMatching}) excede o limite operacional de ${MAX_PRINT_LIMIT} registros. Refine os filtros ou reduza o intervalo de datas.`,
          code: "PRINT_LIMIT_EXCEEDED",
          totalMatching,
          maxLimit: MAX_PRINT_LIMIT,
        },
        { status: 422 }
      );
    }

    const [summary, payouts] = await Promise.all([
      prisma.commissionPayout.aggregate({
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.commissionPayout.findMany({
        where,
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        take: MAX_PRINT_LIMIT,
        include: payoutIncludes,
      }),
    ]);

    const totalPaidAmount = summary._sum.amount ? Number(summary._sum.amount) : 0;

    return NextResponse.json({
      payouts: payouts.map(mapPayout),
      pagination: {
        page: 1,
        limit: MAX_PRINT_LIMIT,
        totalRecords: totalMatching,
        totalPages: 1,
        hasMore: false,
        isPrintMode: true,
      },
      summary: {
        totalPaidAmount,
        totalPayoutsCount: totalMatching,
      },
    });
  }

  // Standard JSON Paginated Query (strictly capped at 100 max)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
  const skip = (page - 1) * limit;

  const [summary, totalRecords, payouts] = await Promise.all([
    prisma.commissionPayout.aggregate({
      where,
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.commissionPayout.count({ where }),
    prisma.commissionPayout.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: payoutIncludes,
    }),
  ]);

  const totalPaidAmount = summary._sum.amount ? Number(summary._sum.amount) : 0;
  const totalPages = Math.ceil(totalRecords / limit) || 1;

  return NextResponse.json({
    payouts: payouts.map(mapPayout),
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages,
      hasMore: page < totalPages,
    },
    summary: {
      totalPaidAmount,
      totalPayoutsCount: totalRecords,
    },
  });
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  // RBAC: OWNER or MANAGER only
  if (!canManageFinancial(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  // Mandatory Idempotency-Key
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Header Idempotency-Key é obrigatório.", code: "IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { memberId, paymentMethod, notes, expectedAmount } = body || {};

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId é obrigatório." }, { status: 400 });
  }

  if (
    paymentMethod !== undefined &&
    paymentMethod !== null &&
    !Object.values(CommissionDisbursementMethod).includes(paymentMethod)
  ) {
    return NextResponse.json(
      { error: "Método de pagamento inválido.", code: "INVALID_PAYMENT_METHOD" },
      { status: 422 }
    );
  }

  const barbershopId = data!.barbershopId;

  // Tenant-qualification: verify member belongs to this barbershop
  const member = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId },
  });
  if (!member) {
    return NextResponse.json({ error: "Profissional não encontrado." }, { status: 404 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId,
        memberId,
        amount: expectedAmount !== undefined && expectedAmount !== null ? Number(expectedAmount) : null,
        paymentMethod: paymentMethod ?? null,
        notes: notes ?? null,
        idempotencyKey,
        createdById: data!.userId,
      })
    );

    return NextResponse.json(
      {
        success: true,
        payout: {
          id: result.payout.id,
          cycleId: result.payout.cycleId,
          memberId: result.payout.memberId,
          amount: Number(result.payout.amount),
          paymentMethod: result.payout.paymentMethod,
          paidAt: result.payout.paidAt,
          notes: result.payout.notes,
        },
        paidCycle: {
          id: result.paidCycle.id,
          cycleNumber: result.paidCycle.cycleNumber,
          status: result.paidCycle.status,
          finalPayoutAmount: Number(result.paidCycle.finalPayoutAmount),
          remainingBalance: Number(result.paidCycle.remainingBalance),
          closedAt: result.paidCycle.closedAt,
          paidAt: result.paidCycle.paidAt,
        },
        successorOpenCycle: {
          id: result.nextCycle.id,
          cycleNumber: result.nextCycle.cycleNumber,
          status: result.nextCycle.status,
          openedAt: result.nextCycle.openedAt,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Erro ao processar liquidação de comissão." },
      { status: 500 }
    );
  }
}
