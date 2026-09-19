import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  canAdjustCustomerCredit,
  canGrantCustomerCredit,
  canViewCustomerCredit,
} from "@/lib/operations/permissions";
import {
  adjustCustomerCredit,
  getCustomerCreditAccount,
  grantCustomerCredit,
  reconcileCustomerCreditBalance,
} from "@/lib/operations/customer-credit";
import { OperationalError } from "@/lib/operations/comandas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: sessionError, data: sessionData } = await getAdminSession();
  if (sessionError) return sessionError;

  const barbershopId = sessionData!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não vinculada." }, { status: 403 });
  }

  if (!canViewCustomerCredit(sessionData!.role)) {
    return NextResponse.json(
      { error: "CREDIT_PERMISSION_REQUIRED", message: "Sem permissão para visualizar créditos." },
      { status: 403 }
    );
  }

  const { id: customerId } = await params;

  try {
    const account = await getCustomerCreditAccount(barbershopId, customerId);

    const entries = await prisma.customerCreditEntry.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdByUser: {
          select: { id: true, name: true },
        },
      },
    });

    const reconciliation = await reconcileCustomerCreditBalance(barbershopId, customerId);

    return NextResponse.json({
      account: {
        id: account.id,
        barbershopId: account.barbershopId,
        customerId: account.customerId,
        balance: Number(account.balance),
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        sourceKind: entry.sourceKind,
        amount: Number(entry.amount),
        balanceAfter: Number(entry.balanceAfter),
        description: entry.description,
        comandaId: entry.comandaId,
        paymentId: entry.paymentId,
        createdBy: entry.createdByUser ? entry.createdByUser.name : null,
        createdAt: entry.createdAt.toISOString(),
      })),
      reconciliation,
    });
  } catch (err: unknown) {
    if (err instanceof OperationalError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "Erro ao buscar conta de crédito." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: sessionError, data: sessionData } = await getAdminSession();
  if (sessionError) return sessionError;

  const barbershopId = sessionData!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não vinculada." }, { status: 403 });
  }

  const { id: customerId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const payload = body as {
    action: "GRANT" | "ADJUST";
    type?: "CREDIT" | "DEBIT";
    amount: number | string;
    description: string;
    idempotencyKey?: string;
  };

  if (!payload.action || (payload.action !== "GRANT" && payload.action !== "ADJUST")) {
    return NextResponse.json(
      { error: "Ação inválida. Escolha 'GRANT' ou 'ADJUST'." },
      { status: 400 }
    );
  }

  if (payload.action === "GRANT" && !canGrantCustomerCredit(sessionData!.role)) {
    return NextResponse.json(
      { error: "CREDIT_GRANT_FORBIDDEN", message: "Concessão de crédito exige perfil OWNER ou MANAGER." },
      { status: 403 }
    );
  }

  if (payload.action === "ADJUST" && !canAdjustCustomerCredit(sessionData!.role)) {
    return NextResponse.json(
      { error: "CREDIT_ADJUST_FORBIDDEN", message: "Ajuste de crédito exige perfil de gerente ou proprietário." },
      { status: 403 }
    );
  }

  if (payload.amount === undefined || payload.amount === null || Number(payload.amount) <= 0) {
    return NextResponse.json(
      { error: "Valor de crédito deve ser um número positivo." },
      { status: 400 }
    );
  }

  try {
    const updatedAccount = await prisma.$transaction(async (tx) => {
      if (payload.action === "GRANT") {
        return grantCustomerCredit(tx, {
          barbershopId,
          customerId,
          amount: payload.amount,
          description: payload.description || "Concessão manual de crédito",
          createdByUserId: sessionData!.userId,
          idempotencyKey: payload.idempotencyKey || null,
        });
      } else {
        return adjustCustomerCredit(tx, {
          barbershopId,
          customerId,
          type: payload.type || "CREDIT",
          amount: payload.amount,
          description: payload.description || "Ajuste manual de crédito",
          createdByUserId: sessionData!.userId,
          idempotencyKey: payload.idempotencyKey || null,
        });
      }
    });

    return NextResponse.json({
      success: true,
      account: {
        id: updatedAccount?.id,
        balance: Number(updatedAccount?.balance ?? 0),
      },
    });
  } catch (err: unknown) {
    if (err instanceof OperationalError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "Erro ao processar operação de crédito." }, { status: 500 });
  }
}
