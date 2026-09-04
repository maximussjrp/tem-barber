/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import { canManageFinancial } from "@/lib/operations/permissions";
import {
  correctCommissionExecutor,
  CommissionError,
} from "@/lib/operations/commissions";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  // RBAC: OWNER or MANAGER only. BARBER receives 403.
  if (!canManageFinancial(data!.role)) {
    return NextResponse.json(
      { error: "Acesso negado. Apenas administradores podem executar correções de comissão.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

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
    return NextResponse.json({ error: "JSON inválido.", code: "INVALID_JSON" }, { status: 400 });
  }

  const { comandaItemId, newExecutorMemberId, reason } = body || {};

  if (!comandaItemId || typeof comandaItemId !== "string") {
    return NextResponse.json({ error: "comandaItemId é obrigatório.", code: "INVALID_PARAM" }, { status: 400 });
  }

  if (!newExecutorMemberId || typeof newExecutorMemberId !== "string") {
    return NextResponse.json({ error: "newExecutorMemberId é obrigatório.", code: "INVALID_PARAM" }, { status: 400 });
  }

  if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
    return NextResponse.json(
      { error: "Motivo deve ter no mínimo 10 caracteres.", code: "INVALID_REASON" },
      { status: 400 }
    );
  }

  try {
    const result = await correctCommissionExecutor({
      barbershopId: data!.barbershopId,
      comandaItemId,
      newExecutorMemberId,
      reason,
      idempotencyKey,
      userId: data!.userId,
      role: data!.role,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[CORRECT_COMMISSION_EXECUTOR_ERROR]", err);
    return NextResponse.json(
      { error: "Erro interno ao processar correção de executor." },
      { status: 500 }
    );
  }
}
