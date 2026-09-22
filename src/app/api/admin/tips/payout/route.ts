import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canPayoutTips, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { executeTipPayout } from "@/lib/operations/tips";
import { PaymentMethod } from "@prisma/client";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canPayoutTips(data!.role)) {
    return NextResponse.json({ error: "Apenas administradores e gerentes podem realizar repasse de gorjetas." }, { status: 403 });
  }

  let body: {
    memberId: string;
    tipEntryIds?: string[];
    method: PaymentMethod;
    idempotencyKey?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  if (!body.memberId || !body.method) {
    return NextResponse.json({ error: "memberId e method são obrigatórios." }, { status: 400 });
  }

  try {
    const payout = await prisma.$transaction(async (tx) => {
      return executeTipPayout(tx, {
        barbershopId: data!.barbershopId,
        memberId: body.memberId,
        tipEntryIds: body.tipEntryIds,
        method: body.method,
        createdById: data!.userId,
        idempotencyKey: request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null,
      });
    });

    return NextResponse.json(payout);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
