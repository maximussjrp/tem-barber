import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import {
  getMemberCheckoutContext,
  memberCheckoutPayNow,
  memberCheckoutLeaveForCash,
  type MemberCheckoutInput,
  type CheckoutMode,
} from "@/lib/operations/member-checkout";
import { OperationalError } from "@/lib/operations/comandas";
import { PaymentMethod } from "@prisma/client";

/**
 * GET /api/member/agenda/[id]/checkout
 * Returns checkout context with operationalState and capabilities
 * DECISION #14: Return operationalState, canPayNow, canLeaveForCash, hasTeamPendingService
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const { id } = await params;

  try {
    const context = await prisma.$transaction(async (tx) => {
      return getMemberCheckoutContext(tx, id, data!.barbershopId, data!.memberId);
    });

    return NextResponse.json(context);
  } catch (err: unknown) {
    if (err instanceof OperationalError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[checkout GET]", err);
    return NextResponse.json({ error: "Erro ao carregar contexto de checkout." }, { status: 500 });
  }
}

/**
 * POST /api/member/agenda/[id]/checkout
 * Finalize checkout: PAY_NOW or LEAVE_FOR_CASH
 * DECISION #8, #9: Atomic finalization with proper state transitions
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const { id } = await params;

  let body: {
    mode?: string;
    method?: string;
    amount?: string | number;
    idempotencyKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { mode, method, amount, idempotencyKey } = body;

  // Validate mode
  if (!mode || !["pay_now", "leave_for_cash"].includes(mode)) {
    return NextResponse.json(
      {
        error: "MODE_INVALID",
        message: "Mode deve ser 'pay_now' ou 'leave_for_cash'.",
      },
      { status: 400 }
    );
  }

  // Validate pay_now requirements
  if (mode === "pay_now") {
    if (!method || !["CASH", "PIX", "DEBIT", "CREDIT", "OTHER"].includes(method)) {
      return NextResponse.json(
        {
          error: "METHOD_INVALID",
          message: "Método de pagamento inválido.",
        },
        { status: 400 }
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const input: MemberCheckoutInput = {
        barbershopId: data!.barbershopId,
        appointmentId: id,
        memberId: data!.memberId,
        mode: mode as CheckoutMode,
        method: method as PaymentMethod | undefined,
        amount,
        userId: data!.userId,
        idempotencyKey,
      };

      if (mode === "pay_now") {
        return memberCheckoutPayNow(tx, {
          ...input,
          method: method as PaymentMethod,
        });
      } else {
        return memberCheckoutLeaveForCash(tx, input);
      }
    });

    return NextResponse.json({
      success: true,
      comanda: result,
      mode,
      message:
        mode === "pay_now"
          ? "Atendimento finalizado e pagamento registrado."
          : "Atendimento concluído. Pagamento pendente no caixa.",
    });
  } catch (err: unknown) {
    if (err instanceof OperationalError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    console.error("[checkout POST]", err);
    return NextResponse.json({ error: "Erro ao finalizar atendimento." }, { status: 500 });
  }
}
