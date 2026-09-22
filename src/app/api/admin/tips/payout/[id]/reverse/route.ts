import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canReverseTipPayout, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { reverseTipPayout } from "@/lib/operations/tips";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canReverseTipPayout(data!.role)) {
    return NextResponse.json({ error: "Apenas administradores e gerentes podem reverter repasse de gorjetas." }, { status: 403 });
  }

  const { id } = await params;
  let body: { reason?: string; idempotencyKey?: string } = {};
  try {
    body = await request.json();
  } catch {}

  try {
    const reversal = await prisma.$transaction(async (tx) => {
      return reverseTipPayout(tx, {
        barbershopId: data!.barbershopId,
        payoutId: id,
        reason: body.reason,
        createdById: data!.userId,
        idempotencyKey: request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null,
      });
    });

    return NextResponse.json(reversal);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
