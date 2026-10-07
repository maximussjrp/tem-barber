import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { fromCents, positiveCents } from "@/lib/operations/money";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";
import { FinancialEntryType, Prisma } from "@prisma/client";

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
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");
  const typeStr = searchParams.get("type");
  const direction = searchParams.get("direction"); // IN | OUT
  const categoryId = searchParams.get("categoryId");
  const q = searchParams.get("q")?.trim();
  const pageStr = searchParams.get("page");
  const limitStr = searchParams.get("limit");

  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const rawLimit = parseInt(limitStr || "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;

  const where: Prisma.FinancialEntryWhereInput = {
    barbershopId,
  };

  // Date filters
  if (startDateStr || endDateStr) {
    if (startDateStr && !isValidDateString(startDateStr)) {
      return NextResponse.json(
        { error: "Formato de startDate inválido. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    if (endDateStr && !isValidDateString(endDateStr)) {
      return NextResponse.json(
        { error: "Formato de endDate inválido. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    if (startDateStr && endDateStr) {
      const start = localDateToUTCBoundary(startDateStr);
      const endExclusive = localDateToUTCBoundary(shiftDateISO(endDateStr, 1));
      if (endExclusive <= start) {
        return NextResponse.json(
          { error: "A data final não pode ser anterior à data inicial." },
          { status: 400 }
        );
      }
      const diffDays = (endExclusive.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return NextResponse.json(
          { error: "O período máximo permitido é de 366 dias." },
          { status: 400 }
        );
      }
      where.entryDate = {
        gte: start,
        lt: endExclusive,
      };
    } else if (startDateStr) {
      where.entryDate = {
        gte: localDateToUTCBoundary(startDateStr),
      };
    } else if (endDateStr) {
      where.entryDate = {
        lt: localDateToUTCBoundary(shiftDateISO(endDateStr, 1)),
      };
    }
  }

  // Type filter
  if (typeStr && Object.values(FinancialEntryType).includes(typeStr as FinancialEntryType)) {
    where.type = typeStr as FinancialEntryType;
  }

  // Direction filter (IN = amount > 0, OUT = amount < 0)
  if (direction === "IN") {
    where.amount = { gt: 0 };
  } else if (direction === "OUT") {
    where.amount = { lt: 0 };
  }

  // Category filter via allocations
  if (categoryId && categoryId.trim().length > 0) {
    where.allocations = {
      some: {
        financialCategoryId: categoryId.trim(),
      },
    };
  }

  // Text search on description
  if (q && q.length > 0) {
    where.description = {
      contains: q,
      mode: "insensitive",
    };
  }

  const [total, entries] = await Promise.all([
    prisma.financialEntry.count({ where }),
    prisma.financialEntry.findMany({
      where,
      orderBy: [
        { entryDate: "desc" },
        { id: "desc" },
      ],
      skip,
      take: limit,
      include: {
        allocations: {
          select: {
            allocatedAmount: true,
            financialCategory: {
              select: {
                id: true,
                code: true,
                name: true,
                classification: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const items = entries.map((entry) => {
    const amountNum = entry.amount.toNumber();
    const isOut = amountNum < 0;
    const directionDerived = isOut ? "OUT" : "IN";

    const allocationsMapped = entry.allocations.map((a) => ({
      allocatedAmount: a.allocatedAmount.toFixed(2),
      financialCategory: {
        id: a.financialCategory.id,
        code: a.financialCategory.code,
        name: a.financialCategory.name,
        classification: a.financialCategory.classification,
      },
    }));

    return {
      id: entry.id,
      type: entry.type,
      amount: entry.amount.toFixed(2),
      description: entry.description,
      entryDate: entry.entryDate.toISOString(),
      direction: directionDerived,
      allocationStatus: allocationsMapped.length > 0 ? "ALLOCATED" : "UNALLOCATED",
      sourceRefs: {
        comandaId: entry.comandaId,
        paymentId: entry.paymentId,
        clubSubscriptionPaymentId: entry.clubSubscriptionPaymentId,
        financialSettlementId: entry.financialSettlementId,
        financialSettlementReversalId: entry.financialSettlementReversalId,
        commissionAdvanceId: entry.commissionAdvanceId,
        commissionAdvanceReversalId: entry.commissionAdvanceReversalId,
        commissionPayoutId: entry.commissionPayoutId,
        tipEntryId: entry.tipEntryId,
        tipRefundId: entry.tipRefundId,
        tipPayoutId: entry.tipPayoutId,
        tipPayoutReversalId: entry.tipPayoutReversalId,
        customerCreditEntryId: entry.customerCreditEntryId,
      },
      allocations: allocationsMapped,
    };
  });

  const totalPages = Math.ceil(total / limit) || 1;

  return NextResponse.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
    total,
    page,
    limit,
    totalPages,
  });
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();

  const body = await request.json();
  if (body.type !== "MANUAL_IN" && body.type !== "MANUAL_OUT") {
    return NextResponse.json({ error: "Tipo invalido." }, { status: 400 });
  }
  const amount = positiveCents(body.amount ?? 0, "Valor");
  const signed = body.type === "MANUAL_OUT" ? -amount : amount;

  const entry = await prisma.financialEntry.create({
    data: {
      barbershopId: data!.barbershopId,
      type: body.type,
      category: body.category?.trim() || "Manual",
      amount: fromCents(signed),
      description: body.description?.trim() || body.category?.trim() || "Lancamento manual",
      userId: data!.userId,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}
