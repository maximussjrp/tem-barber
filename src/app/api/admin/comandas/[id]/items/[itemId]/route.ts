/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { recalculateComandaTotals, OperationalError } from "@/lib/operations/comandas";
import { syncCommissionReleaseForComanda } from "@/lib/operations/commissions";
import {
  canManageComandas,
  comandaScopeForbidden,
  forbidden,
  isLegacyOwnComanda,
  requireOperationalSession,
} from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const { id, itemId } = await params;

  let body: {
    status?: "PENDING" | "DONE" | "CANCELLED";
    clubBenefitRequested?: boolean;
    requestedClubPlanBenefitId?: string | null;
    quantity?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    const { runSerializableTransaction } = await import("@/lib/operations/stock");
    const result = await runSerializableTransaction(async (tx) => {
      const item = await tx.comandaItem.findFirst({
        where: { id: itemId, comandaId: id, barbershopId: data!.barbershopId },
        include: { comanda: true },
      });
      if (!item) throw new OperationalError("ITEM_NOT_FOUND", "Item nao encontrado.", 404);
      if (item.comanda.status === "CLOSED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada nao pode ser editada.", 422);
      }
      if ((body as any).executorId !== undefined && (body as any).executorId !== item.executorId) {
        const currentEntry = await tx.commissionEntry.findFirst({
          where: { comandaItemId: itemId, isCurrent: true },
        });
        if (currentEntry) {
          throw new OperationalError(
            "EXECUTOR_CORRECTION_REQUIRED",
            "Alteração de executor exige operação versionada de correção de executor.",
            409
          );
        }
        throw new OperationalError(
          "DIRECT_EXECUTOR_MUTATION_FORBIDDEN",
          "Alteração direta de executor não permitida. Utilize a operação de correção de executor.",
          422
        );
      }
      if (data!.role === "BARBER" && item.executorId !== data!.memberId) return forbidden();
      if (data!.role === "BARBER" && body.status === "CANCELLED") return forbidden();
      if (!canManageComandas(data!.role) && body.status !== undefined && body.status !== "DONE") return forbidden();

      let desiredQuantity = Number(item.quantity);
      if (body.status === "CANCELLED") {
        desiredQuantity = 0;
      } else if (body.quantity !== undefined) {
        desiredQuantity = body.quantity;
      }

      if (body.status !== undefined || body.quantity !== undefined) {
        const { syncStockForComandaItem } = await import("@/lib/operations/stock");
        await syncStockForComandaItem(
          tx,
          data!.barbershopId,
          itemId,
          desiredQuantity,
          body.status === "CANCELLED"
            ? "Status alterado para cancelado"
            : `Sincronização de estoque por alteração no item`
        );
      }

      if (body.status === "CANCELLED") {
        const { reverseClubBenefitUsage } = await import("@/lib/operations/club");
        await reverseClubBenefitUsage({
          barbershopId: data!.barbershopId,
          comandaItemId: itemId,
          reversalReason: "Status alterado para cancelado",
          tx,
        });
      }

      let newTotal = item.total;
      if (body.quantity !== undefined) {
        const { calculateItemTotal } = await import("@/lib/operations/comandas");
        newTotal = calculateItemTotal({
          quantity: body.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          surchargeAmount: item.surchargeAmount,
        });
      }

      await tx.comandaItem.update({
        where: { id: itemId },
        data: {
          ...(body.status !== undefined && { status: body.status }),
          ...(body.status === "DONE" && { completedAt: new Date() }),
          ...(body.status === "CANCELLED" && { cancelledAt: new Date() }),
          ...(body.clubBenefitRequested !== undefined && { clubBenefitRequested: body.clubBenefitRequested }),
          ...(body.requestedClubPlanBenefitId !== undefined && { requestedClubPlanBenefitId: body.requestedClubPlanBenefitId }),
          ...(body.quantity !== undefined && { quantity: new Prisma.Decimal(body.quantity.toFixed(3)), total: newTotal }),
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

  if (data!.role === "BARBER") {
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
      const item = await tx.comandaItem.findFirst({
        where: { id: itemId, comandaId: id, barbershopId: data!.barbershopId },
        include: { comanda: true },
      });
      if (!item) throw new OperationalError("ITEM_NOT_FOUND", "Item nao encontrado.", 404);
      if (item.comanda.status === "CLOSED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada nao pode ser editada.", 422);
      }

      const { syncStockForComandaItem } = await import("@/lib/operations/stock");
      await syncStockForComandaItem(
        tx,
        data!.barbershopId,
        itemId,
        0,
        "Exclusão do item da comanda"
      );

      const { reverseClubBenefitUsage } = await import("@/lib/operations/club");
      await reverseClubBenefitUsage({
        barbershopId: data!.barbershopId,
        comandaItemId: itemId,
        reversalReason: "Exclusão do item da comanda",
        tx,
      });

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

