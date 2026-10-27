import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { registerPayment, payComandaWithCustomerCredit } from "@/lib/operations/payments";
import { OperationalError } from "@/lib/operations/comandas";
import {
  canBackdatePayment,
  canManageComandas,
  forbidden,
  isLegacyOwnComanda,
  requireOperationalSession,
} from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { parseAndValidatePaymentDate } from "@/lib/operations/payment-dates";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();
  const { id } = await params;

  let body: { method?: PaymentMethod; amount?: string | number; idempotencyKey?: string; paidAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  if (!body.method || body.amount === undefined) {
    return NextResponse.json({ error: "method e amount sao obrigatorios." }, { status: 400 });
  }

  try {
    if (body.paidAt) {
      const { isBackdated } = parseAndValidatePaymentDate(body.paidAt);
      if (isBackdated && !canBackdatePayment(data!.role)) {
        return NextResponse.json(
          {
            error: "BACKDATE_PERMISSION_REQUIRED",
            message: "Apenas gerentes e administradores podem retroagir a data de pagamento.",
          },
          { status: 403 }
        );
      }
    }
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null;
    const result = await prisma.$transaction(async (tx) => {
      if (data!.role === "BARBER") {
        const comanda = await tx.comanda.findFirst({
          where: { id, barbershopId: data!.barbershopId },
          select: {
            appointment: { select: { memberId: true } },
            items: { select: { executorId: true, type: true } },
          },
        });

        if (!comanda) {
          throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);
        }

        if (!isLegacyOwnComanda(comanda, data!.memberId)) {
          throw new OperationalError(
            "COMANDA_SCOPE_FORBIDDEN",
            "Esta comanda não pertence ao profissional autenticado.",
            403
          );
        }
      }

      const allowClosedDebtPayment = data!.role !== "BARBER";

      if (body.method === "CUSTOMER_CREDIT") {
        return payComandaWithCustomerCredit(tx, {
          barbershopId: data!.barbershopId,
          comandaId: id,
          amount: body.amount!,
          userId: data!.userId,
          idempotencyKey,
          allowClosedDebtPayment,
          paidAt: body.paidAt,
        });
      }

      return registerPayment(tx, {
        barbershopId: data!.barbershopId,
        comandaId: id,
        method: body.method!,
        amount: body.amount!,
        userId: data!.userId,
        idempotencyKey,
        allowClosedDebtPayment,
        paidAt: body.paidAt,
      });
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

