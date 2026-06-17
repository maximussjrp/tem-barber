import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { registerPayment } from "@/lib/operations/payments";
import { canManageComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();
  const { id } = await params;

  let body: { method?: PaymentMethod; amount?: string | number; idempotencyKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  if (!body.method || body.amount === undefined) {
    return NextResponse.json({ error: "method e amount sao obrigatorios." }, { status: 400 });
  }

  try {
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null;
    const result = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: data!.barbershopId,
        comandaId: id,
        method: body.method!,
        amount: body.amount!,
        userId: data!.userId,
        idempotencyKey,
      })
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

