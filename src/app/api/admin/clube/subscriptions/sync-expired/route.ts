import { NextRequest, NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import { syncExpiredCustomerClubSubscriptions } from "@/lib/operations/club";

export async function POST(_request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const result = await syncExpiredCustomerClubSubscriptions({
      barbershopId: data.barbershopId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao sincronizar assinaturas expiradas." }, { status: 500 });
  }
}
