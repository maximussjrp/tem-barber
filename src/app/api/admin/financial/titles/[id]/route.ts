import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { FinancialTitleError, getTitleById, updateTitle } from "@/lib/financial/titles";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const { id } = await params;
  const barbershopId = data!.barbershopId;

  try {
    const title = await getTitleById(barbershopId, id);
    if (!title) {
      return NextResponse.json({ error: "Título financeiro não encontrado." }, { status: 404 });
    }
    return NextResponse.json(title);
  } catch (err: unknown) {
    if (err instanceof FinancialTitleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao buscar título financeiro." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const { id } = await params;
  const barbershopId = data!.barbershopId;
  const userId = data!.userId;

  try {
    const body = await request.json();
    const updated = await updateTitle(barbershopId, id, userId, body);
    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof FinancialTitleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao atualizar título financeiro." }, { status: 500 });
  }
}
