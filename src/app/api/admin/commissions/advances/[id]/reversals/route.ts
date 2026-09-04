/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { canManageFinancial } from "@/lib/operations/permissions";
import {
  reverseCommissionAdvance,
  CommissionError,
} from "@/lib/operations/commissions";
import { CommissionDisbursementMethod } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  // RBAC: OWNER or MANAGER only
  if (!canManageFinancial(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { id: advanceId } = await params;

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

  const { amount, returnMethod, reason, isPhysicalCashReturned } = body || {};

  if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json(
      { error: "Valor de estorno inválido.", code: "INVALID_AMOUNT" },
      { status: 422 }
    );
  }

  if (!returnMethod || !Object.values(CommissionDisbursementMethod).includes(returnMethod)) {
    return NextResponse.json(
      { error: "Método de devolução inválido.", code: "INVALID_RETURN_METHOD" },
      { status: 422 }
    );
  }

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json(
      { error: "Motivo do estorno é obrigatório.", code: "REASON_REQUIRED" },
      { status: 422 }
    );
  }

  const barbershopId = data!.barbershopId;

  // Tenant-qualification: verify advance belongs to this barbershop
  const advance = await prisma.commissionAdvance.findFirst({
    where: { id: advanceId, barbershopId },
  });
  if (!advance) {
    return NextResponse.json({ error: "Adiantamento não encontrado." }, { status: 404 });
  }

  try {
    const reversal = await prisma.$transaction((tx) =>
      reverseCommissionAdvance(tx, {
        barbershopId,
        advanceId,
        amount: Number(amount),
        returnMethod,
        reason,
        idempotencyKey,
        createdById: data!.userId,
        isPhysicalCashReturned,
      })
    );

    return NextResponse.json(
      {
        success: true,
        reversal: {
          id: reversal.id,
          advanceId: reversal.advanceId,
          amount: Number(reversal.amount),
          returnMethod: reversal.returnMethod,
          isPhysicalCashReturned: reversal.isPhysicalCashReturned,
          returnedAt: reversal.returnedAt,
          reason: reversal.reason,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Erro ao processar estorno de adiantamento." },
      { status: 500 }
    );
  }
}
