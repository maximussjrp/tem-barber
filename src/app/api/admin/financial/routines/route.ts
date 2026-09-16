import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import {
  createFinancialRoutine,
  FinancialRoutineError,
  listFinancialRoutines,
} from "@/lib/financial/routines";

export async function GET(request: NextRequest) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const isActiveParam = searchParams.get("isActive");
    const isActive = isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;

    const routines = await listFinancialRoutines({
      barbershopId: session.barbershopId,
      isActive,
    });

    return NextResponse.json({ routines });
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao listar rotinas financeiras." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, data: session } = await requireFinancialSession();
  if (error || !session) return error ?? NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const body = await request.json();

    const routine = await createFinancialRoutine({
      barbershopId: session.barbershopId,
      createdById: session.userId,
      categoryId: body.categoryId,
      title: body.title,
      kind: body.kind,
      amountMode: body.amountMode,
      baseAmount: body.baseAmount,
      frequency: body.frequency ?? "MONTHLY",
      dueDay: Number(body.dueDay),
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes,
    });

    return NextResponse.json({ routine }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao criar rotina financeira." }, { status: 500 });
  }
}
