import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  getCashFlowReport,
  isValidISODateString,
  calculateDaysDifference,
} from "@/lib/financial/cash-flow";

export async function GET(request: NextRequest) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const categoryId = searchParams.get("categoryId") || undefined;
  const directionRaw = searchParams.get("direction");

  let direction: "IN" | "OUT" | undefined = undefined;
  if (directionRaw === "IN" || directionRaw === "OUT") {
    direction = directionRaw;
  }

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
    const report = await getCashFlowReport({
      barbershopId,
      startDate,
      endDate,
      categoryId,
      direction,
    });

    return NextResponse.json(report, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno ao processar fluxo de caixa.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
