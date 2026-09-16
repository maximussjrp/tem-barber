import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  FinancialRoutineError,
  generateRoutineOccurrencesForMonth,
} from "@/lib/financial/routines";

export async function POST(request: NextRequest) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const body = await request.json();

    const output = await generateRoutineOccurrencesForMonth({
      barbershopId: session.barbershopId,
      referenceMonth: body.referenceMonth,
      source: "ROUTINE_ON_DEMAND",
      actorUserId: session.userId,
      amountOverrides: body.amountOverrides,
      routineId: body.routineId,
    });

    if (output.summary.failed > 0) {
      return NextResponse.json(output, { status: 500 });
    }

    return NextResponse.json(output);
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao gerar ocorrências financeiras sob demanda." }, { status: 500 });
  }
}
