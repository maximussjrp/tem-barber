import { NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { FinancialCategoryError, getCategoryById, updateCategory } from "@/lib/financial/categories";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const { id } = await params;
    const category = await getCategoryById(data!.barbershopId, id);
    if (!category) {
      return NextResponse.json(
        { error: "Categoria não encontrada.", code: "FINANCIAL_CATEGORY_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(category);
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao buscar categoria." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateCategory(data!.barbershopId, id, { name: body.name });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao atualizar categoria." }, { status: 500 });
  }
}
