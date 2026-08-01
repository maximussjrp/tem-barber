import { NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import { getCurrentCycleSummary } from "@/lib/operations/club-current-cycle";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const summary = await getCurrentCycleSummary({
      barbershopId: data!.barbershopId,
      role: data!.role,
    });

    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar resumo do ciclo atual.";
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
