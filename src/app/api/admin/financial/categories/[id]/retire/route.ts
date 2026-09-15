import { NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { FinancialCategoryError, retireCategory } from "@/lib/financial/categories";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const replacementCategoryId = body.replacementCategoryId;

    const result = await retireCategory(data!.barbershopId, id, replacementCategoryId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof FinancialCategoryError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao aposentar categoria." }, { status: 500 });
  }
}
