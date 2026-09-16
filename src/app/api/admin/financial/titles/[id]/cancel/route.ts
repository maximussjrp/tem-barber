import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { cancelTitle, FinancialTitleError } from "@/lib/financial/titles";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const { id } = await params;
  const barbershopId = data!.barbershopId;
  const userId = data!.userId;

  try {
    const body = await request.json().catch(() => ({}));
    const cancelled = await cancelTitle(barbershopId, id, userId, body.reason);
    return NextResponse.json(cancelled);
  } catch (err: unknown) {
    if (err instanceof FinancialTitleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao cancelar título financeiro." }, { status: 500 });
  }
}
