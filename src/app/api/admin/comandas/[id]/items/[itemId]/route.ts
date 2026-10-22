/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { recalculateComandaTotals, comandaInclude, OperationalError } from "@/lib/operations/comandas";
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
      if (item.comanda.status === "CLOSED" || item.comanda.status === "CANCELLED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada ou cancelada não pode ser editada.", 422);
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
      if (!canManageComandas(data!.role) && body.status !== undefined && body.status !== "DONE" && body.status !== "PENDING") return forbidden();

      // Bloqueio de mutação em item já cancelado
      if (item.status === "CANCELLED") {
        if (body.status === "CANCELLED") {
          // Retentativa idempotente sem mutação nem efeitos colaterais: leitura pura
          const current = await tx.comanda.findUnique({
            where: { id },
            include: comandaInclude,
          });
          return current;
        }
        if (body.status === "PENDING" || body.status === "DONE") {
          throw new OperationalError(
            "INVALID_STATUS_TRANSITION",
            "Itens cancelados não podem ser reativados ou concluídos.",
            422
          );
        }
        throw new OperationalError(
          "INVALID_OPERATION",
          "Itens cancelados não podem ser alterados.",
          422
        );
      }

      if (body.status !== undefined) {
        if (body.status !== "PENDING" && body.status !== "DONE" && body.status !== "CANCELLED") {
          throw new OperationalError("INVALID_STATUS", "Status informado inválido.", 400);
        }

        // Validação estrita da matriz de transição de status
        if (item.status === "DONE") {
          if (body.status === "PENDING") {
            if (item.type !== "SERVICE") {
              throw new OperationalError(
                "INVALID_STATUS_TRANSITION",
                "Apenas serviços concluídos podem retornar para pendente.",
                422
              );
            }

            if (body.quantity !== undefined && Number(body.quantity) !== Number(item.quantity)) {
              throw new OperationalError(
                "INVALID_OPERATION",
                "Não é permitido alterar quantidade ao desmarcar a conclusão do serviço.",
                422
              );
            }

            // Proteção financeira ao desmarcar conclusão de serviço (DONE -> PENDING)
            const currentCommission = await tx.commissionEntry.findFirst({
              where: { comandaItemId: itemId, isCurrent: true },
            });
            if (currentCommission) {
              const { toCents } = await import("@/lib/operations/money");
              if (toCents(currentCommission.paidAmount) > 0 || currentCommission.status === "PAID") {
                throw new OperationalError(
                  "COMMISSION_ALREADY_PAID",
                  "Não é possível reverter a conclusão: a comissão deste item já foi paga ao profissional.",
                  422
                );
              }
            }

            const point = await tx.clubPointEntry.findUnique({
              where: { comandaItemId: itemId },
            });
            if (point && point.status === "SETTLED") {
              throw new OperationalError(
                "SETTLEMENT_LOCKED",
                "Não é possível reverter a conclusão: o benefício de clube deste item já foi liquidado em fechamento.",
                422
              );
            }
          }
        }
      }

      const isStatusChanging = body.status !== undefined && body.status !== item.status;
      const isQuantityChanging = body.quantity !== undefined && Number(body.quantity) !== Number(item.quantity);
      const isClubBenefitChanging =
        (body.clubBenefitRequested !== undefined && body.clubBenefitRequested !== item.clubBenefitRequested) ||
        (body.requestedClubPlanBenefitId !== undefined && body.requestedClubPlanBenefitId !== item.requestedClubPlanBenefitId);

      const hasOperationalMutation = isStatusChanging || isQuantityChanging || isClubBenefitChanging;

      // Se requisição não altera status, quantidade nem benefícios de clube, retorna consulta de leitura pura sem tocar em banco, revisão, estoque ou alocações
      if (!hasOperationalMutation) {
        const current = await tx.comanda.findUnique({
          where: { id },
          include: comandaInclude,
        });
        return current;
      }

      let desiredQuantity = Number(item.quantity);
      if (isStatusChanging && body.status === "CANCELLED") {
        desiredQuantity = 0;
      } else if (body.quantity !== undefined) {
        desiredQuantity = body.quantity;
      }

      if (isStatusChanging || isQuantityChanging) {
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

      if (isStatusChanging && body.status === "CANCELLED") {
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
          ...(isStatusChanging && { status: body.status }),
          ...(isStatusChanging && body.status === "DONE" && { completedAt: new Date() }),
          ...(isStatusChanging && body.status === "PENDING" && { completedAt: null }),
          ...(isStatusChanging && body.status === "CANCELLED" && { cancelledAt: new Date() }),
          ...(body.clubBenefitRequested !== undefined && { clubBenefitRequested: body.clubBenefitRequested }),
          ...(body.requestedClubPlanBenefitId !== undefined && { requestedClubPlanBenefitId: body.requestedClubPlanBenefitId }),
          ...(body.quantity !== undefined && { quantity: new Prisma.Decimal(body.quantity.toFixed(3)), total: newTotal }),
        },
      });

      if (isStatusChanging) {
        await tx.comanda.update({
          where: { id },
          data: { commissionRevision: { increment: 1 } },
        });
      }

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
      if (item.comanda.status === "CLOSED" || item.comanda.status === "CANCELLED") {
        throw new OperationalError("COMANDA_CLOSED", "Comanda fechada ou cancelada não pode ser editada.", 422);
      }

      // Idempotência estrita: se o item já está CANCELLED, DELETE repetido retorna o estado atual via leitura pura sem mutações ou novos eventos
      if (item.status === "CANCELLED") {
        const current = await tx.comanda.findUnique({
          where: { id },
          include: comandaInclude,
        });
        return current;
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
      await tx.comanda.update({
        where: { id },
        data: { commissionRevision: { increment: 1 } },
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

