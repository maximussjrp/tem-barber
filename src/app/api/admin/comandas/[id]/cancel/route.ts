import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cancelComanda } from "@/lib/operations/comandas";
import { canCancelComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canCancelComandas(data!.role)) return forbidden();
  const { id } = await params;

  let body: { reason?: string; refundAll?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  try {
    const { runSerializableTransaction } = await import("@/lib/operations/stock");
    const result = await runSerializableTransaction(async (tx) =>
      cancelComanda(tx, {
        barbershopId: data!.barbershopId,
        comandaId: id,
        reason: body.reason ?? "",
        userId: data!.userId,
        refundAll: body.refundAll ?? false,
      })
    );
    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
