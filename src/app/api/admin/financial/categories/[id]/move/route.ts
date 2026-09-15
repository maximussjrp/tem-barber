import { NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { FinancialCategoryError, moveCategory } from "@/lib/financial/categories";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const { id } = await params;
    const body = await request.json();
    const parentCategoryId = body.parentCategoryId ?? null;

    const moved = await moveCategory(data!.barbershopId, id, parentCategoryId);
    return NextResponse.json(moved);
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao mover categoria." }, { status: 500 });
  }
}
