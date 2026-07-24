import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { createAsaasSubscriptionForBarbershop, SubscriptionValidationError } from "@/lib/asaas/subscriptions";
import { AsaasApiError } from "@/lib/asaas/client";

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (session.error) {
    return session.error;
  }

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada à sessão." },
      { status: 400 }
    );
  }

  // Permissão: OWNER apenas
  if (role !== "OWNER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas o proprietário pode gerenciar a assinatura de faturamento." },
      { status: 403 }
    );
  }

  // Validar payload
  let body: { planCode?: string; billingType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "Corpo da requisição inválido." },
      { status: 400 }
    );
  }

  const { planCode, billingType } = body;

  if (!planCode || typeof planCode !== "string") {
    return NextResponse.json(
      { error: "MISSING_PLAN_CODE", message: "planCode é obrigatório." },
      { status: 400 }
    );
  }

  if (!billingType || typeof billingType !== "string") {
    return NextResponse.json(
      { error: "MISSING_BILLING_TYPE", message: "billingType é obrigatório." },
      { status: 400 }
    );
  }

  try {
    const result = await createAsaasSubscriptionForBarbershop({
      barbershopId,
      planCode,
      billingType,
    });

    return NextResponse.json(result, { status: result.alreadyExisted ? 200 : 201 });
  } catch (err: unknown) {
    if (err instanceof SubscriptionValidationError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 }
      );
    }

    if (err instanceof AsaasApiError) {
      return NextResponse.json(
        {
          error: "ASAAS_ERROR",
          message: err.message,
          code: err.code,
        },
        { status: err.statusCode >= 500 ? 502 : err.statusCode }
      );
    }

    console.error("[billing/subscription] Erro inesperado:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro interno ao criar assinatura." },
      { status: 500 }
    );
  }
}
