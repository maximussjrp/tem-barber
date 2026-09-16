import { NextRequest, NextResponse } from "next/server";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { FinancialSettlementError, reverseSettlement } from "@/lib/financial/settlements";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireFinancialSession();
  if (error) return error;

  const { id } = await params;
  const barbershopId = data!.barbershopId;
  const userId = data!.userId;
  const idempotencyKey = request.headers.get("idempotency-key");

  try {
    const body = await request.json().catch(() => ({}));
    const { result, isReplay } = await reverseSettlement(
      barbershopId,
      id,
      userId,
      idempotencyKey,
      body
    );

    const headers = new Headers();
    if (isReplay) {
      headers.set("Idempotent-Replay", "true");
    }

    return NextResponse.json(result, { status: isReplay ? 200 : 201, headers });
  } catch (err: unknown) {
    if (err instanceof FinancialSettlementError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao estornar liquidação de título." }, { status: 500 });
  }
}
