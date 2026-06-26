import { NextRequest, NextResponse } from "next/server";
import { calculateClubSettlement } from "@/lib/operations/club";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const calculateSettlementSchema = z.object({
  competence: z.string().regex(/^\d{4}-\d{2}$/, "Competência deve seguir o formato YYYY-MM"),
});

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const json = await request.json();
    const result = calculateSettlementSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const { competence } = result.data;

    const settlement = await calculateClubSettlement({
      barbershopId: data.barbershopId,
      competence,
    });

    return NextResponse.json(settlement, { status: 200 });
  } catch (err: any) {
    if (err.code === "SETTLEMENT_APPROVED" || err.code === "SETTLEMENT_PAID") {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: err.message || "Erro ao calcular fechamento." }, { status: 500 });
  }
}
