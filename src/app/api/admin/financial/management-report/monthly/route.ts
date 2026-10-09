import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  getMonthlyManagementReport,
  isValidYearMonth,
  CategoryNotFoundError,
} from "@/lib/financial/management-report";

export async function GET(request: NextRequest) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  const endMonth = searchParams.get("endMonth");
  const countStr = searchParams.get("count") ?? "3";
  const categoryId = searchParams.get("categoryId") || undefined;

  if (!endMonth || !isValidYearMonth(endMonth)) {
    return NextResponse.json(
      { error: "Formato de endMonth inválido. Use YYYY-MM." },
      { status: 400 }
    );
  }

  if (!/^(3|6|12)$/.test(countStr)) {
    return NextResponse.json(
      { error: "Parâmetro count inválido. Valores permitidos: 3, 6, 12." },
      { status: 400 }
    );
  }
  const count = Number(countStr);

  try {
    // Leitura atômica sob RepeatableRead para garantir snapshot consistente
    const report = await prisma.$transaction(
      async (tx) => {
        return getMonthlyManagementReport(
          {
            barbershopId,
            endMonth,
            count,
            categoryId,
          },
          tx
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      }
    );

    return NextResponse.json(report, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Erro interno ao processar relatório gerencial mensal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
