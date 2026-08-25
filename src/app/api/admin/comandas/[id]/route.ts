import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ComandaStatus } from "@prisma/client";
import { closeComanda } from "@/lib/operations/payments";
import { comandaInclude, OperationalError, recalculateComandaTotals } from "@/lib/operations/comandas";
import {
  canManageComandas,
  canReopenComandas,
  canRefundPayments,
  canCancelComandas,
  comandaScopeForbidden,
  forbidden,
  isLegacyOwnComanda,
  requireOperationalSession,
} from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

const ALLOWED: Record<ComandaStatus, ComandaStatus[]> = {
  OPEN: ["IN_SERVICE", "PENDING_PAYMENT", "CLOSED", "CANCELLED"],
  IN_SERVICE: ["PENDING_PAYMENT", "CLOSED", "CANCELLED"],
  PENDING_PAYMENT: ["IN_SERVICE", "CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const { id } = await params;

  const comanda = await prisma.comanda.findFirst({
    where: { id, barbershopId: data!.barbershopId },
    include: comandaInclude,
  });
  if (!comanda) return NextResponse.json({ error: "Comanda nao encontrada." }, { status: 404 });
  if (data!.role === "BARBER" && !isLegacyOwnComanda(comanda, data!.memberId)) {
    return comandaScopeForbidden();
  }
  return NextResponse.json({
    ...comanda,
    permissions: {
      canReopen: comanda.status === "CLOSED" && canReopenComandas(data!.role),
      canRefund: canRefundPayments(data!.role),
      canCancel: canCancelComandas(data!.role),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();
  const { id } = await params;

  let body: { status?: ComandaStatus };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  if (!body.status) return NextResponse.json({ error: "status obrigatorio." }, { status: 400 });

  if (data!.role === "BARBER") {
    if (body.status === "CANCELLED") {
      return forbidden();
    }
    const comanda = await prisma.comanda.findFirst({
      where: { id, barbershopId: data!.barbershopId },
      include: { items: true, appointment: true }
    });
    if (!comanda) return NextResponse.json({ error: "Comanda não encontrada." }, { status: 404 });
    if (!isLegacyOwnComanda(comanda, data!.memberId)) {
      return comandaScopeForbidden();
    }
  }

  try {
    const { runSerializableTransaction } = await import("@/lib/operations/stock");
    const result = await runSerializableTransaction(async (tx) => {
      const comanda = await tx.comanda.findFirst({
        where: { id, barbershopId: data!.barbershopId },
      });
      if (!comanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);
      if (!ALLOWED[comanda.status].includes(body.status!)) {
        throw new OperationalError("INVALID_TRANSITION", "Transicao de comanda invalida.", 422);
      }
      if (body.status === "PENDING_PAYMENT") {
        const comandaWithItems = await tx.comanda.findUnique({
          where: { id },
          include: { items: true },
        });
        const hasPendingObligatoryItems = comandaWithItems?.items.some(
          (i) => i.status === "PENDING" && i.type === "SERVICE"
        );
        if (hasPendingObligatoryItems) {
          throw new OperationalError("PENDING_ITEMS", "Conclua ou cancele todos os itens de serviço antes de ir para pagamento.", 422);
        }
        await recalculateComandaTotals(tx, id);
      }
      
      if (body.status === "CLOSED") {
        return closeComanda(tx, data!.barbershopId, id);
      }
      if (body.status === "CANCELLED") {
        if (!canCancelComandas(data!.role)) return forbidden();
        const { cancelComanda } = await import("@/lib/operations/comandas");
        return cancelComanda(tx, {
          barbershopId: data!.barbershopId,
          comandaId: id,
          reason: "Cancelada via status",
          refundAll: true,
          userId: data!.userId,
        });
      }
      return tx.comanda.update({
        where: { id },
        data: {
          status: body.status,
          ...(body.status === "IN_SERVICE" && { startedAt: new Date() }),
        },
        include: comandaInclude,
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}

