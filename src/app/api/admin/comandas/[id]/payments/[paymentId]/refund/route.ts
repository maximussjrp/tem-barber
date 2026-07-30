import { NextRequest, NextResponse } from "next/server";
import { refundPayment } from "@/lib/operations/payments";
import { canRefundPayments, canCancelComandas, canReopenComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canRefundPayments(data!.role)) return forbidden();

  const { id: comandaId, paymentId } = await params;

  let body: { amount?: string | number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  if (body.amount === undefined || body.amount === "") {
    return NextResponse.json(
      { error: "REFUND_AMOUNT_REQUIRED", message: "Valor do estorno é obrigatório." },
      { status: 400 }
    );
  }

  if (!body.reason || body.reason.trim().length < 5) {
    return NextResponse.json(
      { error: "REFUND_REASON_REQUIRED", message: "O motivo do estorno deve ter pelo menos 5 caracteres." },
      { status: 400 }
    );
  }

  try {
    const { runSerializableTransaction } = await import("@/lib/operations/stock");
    const result = await runSerializableTransaction(async (tx) =>
      refundPayment(tx, {
        barbershopId: data!.barbershopId,
        comandaId,
        paymentId,
        amount: body.amount!,
        reason: body.reason!,
        userId: data!.userId,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      })
    );
    return NextResponse.json({
      ...result,
      permissions: {
        canReopen: result.status === "CLOSED" && canReopenComandas(data!.role),
        canRefund: canRefundPayments(data!.role),
        canCancel: canCancelComandas(data!.role),
      },
    });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

