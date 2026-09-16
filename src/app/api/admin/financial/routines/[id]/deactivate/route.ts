import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  deactivateFinancialRoutine,
  FinancialRoutineError,
} from "@/lib/financial/routines";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { id } = await params;
    const routine = await deactivateFinancialRoutine({
      barbershopId: session.barbershopId,
      routineId: id,
    });

    return NextResponse.json({ routine });
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao desativar rotina." }, { status: 500 });
  }
}
