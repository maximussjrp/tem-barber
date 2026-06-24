import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { recalculateComandaTotals, OperationalError } from "@/lib/operations/comandas";
import { syncCommissionReleaseForComanda } from "@/lib/operations/commissions";
import { canManageComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const { id, itemId } = await params;

  let body: { status?: "PENDING" | "DONE" | "CANCELLED" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.comandaItem.findFirst({
        where: { id: itemId, comandaId: id, barbershopId: data!.barbershopId },
        include: { comanda: true },
      });
      if (!item) throw new OperationalError("ITEM_NOT_FOUND", "Item nao encontrado.", 404);
      if (item.comanda.status === "CLOSED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada nao pode ser editada.", 422);
      }
      if (data!.role === "BARBER" && item.executorId !== data!.memberId) return forbidden();
      if (data!.role === "BARBER" && body.status === "CANCELLED") return forbidden();
      if (!canManageComandas(data!.role) && body.status !== "DONE") return forbidden();

      await tx.comandaItem.update({
        where: { id: itemId },
        data: {
          status: body.status,
          ...(body.status === "DONE" && { completedAt: new Date() }),
          ...(body.status === "CANCELLED" && { cancelledAt: new Date() }),
        },
      });
      const updated = await recalculateComandaTotals(tx, id);
      await syncCommissionReleaseForComanda(tx, data!.barbershopId, id);
      return updated;
    });
    return result instanceof Response ? result : NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();
  const { id, itemId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.comandaItem.findFirst({
        where: { id: itemId, comandaId: id, barbershopId: data!.barbershopId },
        include: { comanda: true },
      });
      if (!item) throw new OperationalError("ITEM_NOT_FOUND", "Item nao encontrado.", 404);
      if (item.comanda.status === "CLOSED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada nao pode ser editada.", 422);
      }
      await tx.comandaItem.update({
        where: { id: itemId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const updated = await recalculateComandaTotals(tx, id);
      await syncCommissionReleaseForComanda(tx, data!.barbershopId, id);
      return updated;
    });
    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}

