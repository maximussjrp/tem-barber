import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { refundPayment } from "@/lib/operations/payments";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();
  const { paymentId } = await params;

  let body: { amount?: string | number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  if (body.amount === undefined) {
    return NextResponse.json({ error: "amount obrigatorio." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      refundPayment(tx, {
        barbershopId: data!.barbershopId,
        paymentId,
        amount: body.amount!,
        reason: body.reason ?? "Estorno",
        userId: data!.userId,
      })
    );
    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}

