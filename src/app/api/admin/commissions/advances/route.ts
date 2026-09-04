/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { canManageFinancial } from "@/lib/operations/permissions";
import {
  createCommissionAdvance,
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

  const { memberId, amount, paymentMethod, notes, description } = body || {};

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId é obrigatório." }, { status: 400 });
  }

  if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json(
      { error: "Valor de adiantamento inválido.", code: "INVALID_AMOUNT" },
      { status: 422 }
    );
  }

  if (!paymentMethod || !Object.values(CommissionDisbursementMethod).includes(paymentMethod)) {
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
    const advance = await prisma.$transaction((tx) =>
      createCommissionAdvance(tx, {
        barbershopId,
        memberId,
        amount: Number(amount),
        paymentMethod,
        idempotencyKey,
        createdById: data!.userId,
        notes,
        description,
      })
    );

    return NextResponse.json(
      {
        success: true,
        advance: {
          id: advance.id,
          cycleId: advance.cycleId,
          memberId: advance.memberId,
          amount: Number(advance.amount),
          paymentMethod: advance.paymentMethod,
          disbursedAt: advance.disbursedAt,
          notes: advance.notes,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao processar adiantamento." }, { status: 500 });
  }
}
