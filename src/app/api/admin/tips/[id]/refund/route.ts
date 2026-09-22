import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canRefundTip, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { refundTip } from "@/lib/operations/tips";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canRefundTip(data!.role)) {
    return NextResponse.json({ error: "Apenas administradores e gerentes podem estornar gorjetas." }, { status: 403 });
  }

  const { id } = await params;
  let body: { amount?: number | string; reason?: string; idempotencyKey?: string } = {};
  try {
    body = await request.json();
  } catch {}

  const amountToRefund =
    body.amount !== undefined && body.amount !== null && body.amount !== ""
      ? body.amount
      : undefined;

  try {
    const refund = await prisma.$transaction(async (tx) => {
      return refundTip(tx, {
        barbershopId: data!.barbershopId,
        tipEntryId: id,
        amountToRefund,
        reason: body.reason,
        refundedById: data!.userId,
        idempotencyKey: request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null,
      });
    });

    return NextResponse.json(refund);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
