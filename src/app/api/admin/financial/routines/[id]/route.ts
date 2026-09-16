import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  FinancialRoutineError,
  getFinancialRoutineById,
  updateFinancialRoutine,
} from "@/lib/financial/routines";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { id } = await params;
    const routine = await getFinancialRoutineById({
      barbershopId: session.barbershopId,
      routineId: id,
    });

    return NextResponse.json({ routine });
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar detalhes da rotina." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();

    const routine = await updateFinancialRoutine({
      barbershopId: session.barbershopId,
      routineId: id,
      title: body.title,
      categoryId: body.categoryId,
      kind: body.kind,
      amountMode: body.amountMode,
      baseAmount: body.baseAmount,
      dueDay: body.dueDay !== undefined ? Number(body.dueDay) : undefined,
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes,
      isActive: body.isActive,
    });

    return NextResponse.json({ routine });
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao atualizar rotina." }, { status: 500 });
  }
}
