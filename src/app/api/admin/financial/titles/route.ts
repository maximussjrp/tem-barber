import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { createTitle, FinancialTitleError, listTitles } from "@/lib/financial/titles";

export async function GET(request: NextRequest) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const searchParams = request.nextUrl.searchParams;

  try {
    const result = await listTitles(barbershopId, {
      kind: searchParams.get("kind") || undefined,
      status: searchParams.get("status") || undefined,
      categoryId: searchParams.get("categoryId") || undefined,
      dueFrom: searchParams.get("dueFrom") || undefined,
      dueTo: searchParams.get("dueTo") || undefined,
      q: searchParams.get("q") || undefined,
      page: searchParams.get("page") || undefined,
      limit: searchParams.get("limit") || undefined,
      civilToday: searchParams.get("civilToday") || undefined,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof FinancialTitleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao listar títulos financeiros." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  const userId = data!.userId;

  try {
    const body = await request.json();
    const created = await createTitle(barbershopId, userId, body);
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof FinancialTitleError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao criar título financeiro." }, { status: 500 });
  }
}
