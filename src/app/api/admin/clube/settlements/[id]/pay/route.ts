import { NextRequest, NextResponse } from "next/server";
import { markClubSettlementPaid } from "@/lib/operations/club";
import { requireOperationalSession } from "@/lib/api-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const updated = await markClubSettlementPaid({
      barbershopId: data.barbershopId,
      settlementId: id,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err.code === "SETTLEMENT_NOT_FOUND") {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 404 });
    }
    if (err.code === "INVALID_STATUS") {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: err.message || "Erro ao pagar fechamento." }, { status: 500 });
  }
}
