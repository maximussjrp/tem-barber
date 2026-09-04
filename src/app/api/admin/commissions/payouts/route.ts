/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { canManageFinancial } from "@/lib/operations/permissions";
import {
  executeCommissionPayout,
  CommissionError,
} from "@/lib/operations/commissions";
import { CommissionDisbursementMethod } from "@prisma/client";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  // RBAC: OWNER or MANAGER only
  if (!canManageFinancial(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  // Mandatory Idempotency-Key
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Header Idempotency-Key é obrigatório.", code: "IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { memberId, paymentMethod, notes, expectedAmount } = body || {};

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId é obrigatório." }, { status: 400 });
  }

  if (
    paymentMethod !== undefined &&
    paymentMethod !== null &&
    !Object.values(CommissionDisbursementMethod).includes(paymentMethod)
  ) {
    return NextResponse.json(
      { error: "Método de pagamento inválido.", code: "INVALID_PAYMENT_METHOD" },
      { status: 422 }
    );
  }

  const barbershopId = data!.barbershopId;

  // Tenant-qualification: verify member belongs to this barbershop
  const member = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId },
  });
  if (!member) {
    return NextResponse.json({ error: "Profissional não encontrado." }, { status: 404 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId,
        memberId,
        amount: expectedAmount !== undefined && expectedAmount !== null ? Number(expectedAmount) : null,
        paymentMethod: paymentMethod ?? null,
        notes: notes ?? null,
        idempotencyKey,
        createdById: data!.userId,
      })
    );

    return NextResponse.json(
      {
        success: true,
        payout: {
          id: result.payout.id,
          cycleId: result.payout.cycleId,
          memberId: result.payout.memberId,
          amount: Number(result.payout.amount),
          paymentMethod: result.payout.paymentMethod,
          paidAt: result.payout.paidAt,
          notes: result.payout.notes,
        },
        paidCycle: {
          id: result.paidCycle.id,
          cycleNumber: result.paidCycle.cycleNumber,
          status: result.paidCycle.status,
          finalPayoutAmount: Number(result.paidCycle.finalPayoutAmount),
          remainingBalance: Number(result.paidCycle.remainingBalance),
          closedAt: result.paidCycle.closedAt,
          paidAt: result.paidCycle.paidAt,
        },
        successorOpenCycle: {
          id: result.nextCycle.id,
          cycleNumber: result.nextCycle.cycleNumber,
          status: result.nextCycle.status,
          openedAt: result.nextCycle.openedAt,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Erro ao processar liquidação de comissão." },
      { status: 500 }
    );
  }
}
