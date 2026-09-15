import { NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { createCategory, FinancialCategoryError, listCategoriesTree } from "@/lib/financial/categories";

export async function GET() {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const tree = await listCategoriesTree(data!.barbershopId);
    return NextResponse.json(tree);
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao listar categorias." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const body = await request.json();
    const category = await createCategory(data!.barbershopId, body);
    return NextResponse.json(category, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao criar categoria." }, { status: 500 });
  }
}
