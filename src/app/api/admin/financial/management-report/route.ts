import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  getManagementReport,
  isValidISODateString,
  calculateDaysDifference,
  CategoryNotFoundError,
} from "@/lib/financial/management-report";

export async function GET(request: NextRequest) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const categoryId = searchParams.get("categoryId") || undefined;

  if (!startDate || !isValidISODateString(startDate)) {
    return NextResponse.json(
      { error: "Formato de startDate inválido. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  if (!endDate || !isValidISODateString(endDate)) {
    return NextResponse.json(
      { error: "Formato de endDate inválido. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  if (endDate < startDate) {
    return NextResponse.json(
      { error: "endDate não pode ser anterior a startDate." },
      { status: 400 }
    );
  }

  const daysDiff = calculateDaysDifference(startDate, endDate);
  if (daysDiff > 366) {
    return NextResponse.json(
      { error: "Intervalo máximo permitido é de 366 dias." },
      { status: 400 }
    );
  }

  try {
    const report = await getManagementReport({
      barbershopId,
      startDate,
      endDate,
      categoryId,
    });

    return NextResponse.json(report, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Erro interno ao processar relatório gerencial.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
