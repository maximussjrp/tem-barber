import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { canManageDebt, isLegacyOwnComanda, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { comandaInclude, lockComandaRow, OperationalError, recalculateComandaTotals } from "@/lib/operations/comandas";
import { registerPayment, payComandaWithCustomerCredit, closeComanda } from "@/lib/operations/payments";
import { toCents } from "@/lib/operations/money";

interface PaymentItem {
  method: PaymentMethod;
  amount: string | number;
}

interface FinalizeBody {
  payments: PaymentItem[];
  closeWithDebt?: boolean;
  confirmOutstandingBalance?: boolean;
  idempotencyKey?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const { id } = await params;

  // 1. Parse e validação básica do body
  let body: FinalizeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  if (!Array.isArray(body.payments)) {
    return NextResponse.json({ error: "payments deve ser um array." }, { status: 400 });
  }

  // Obter chave de idempotência dos headers ou do body
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockComandaRow(tx, data!.barbershopId, id);

      // 2. Buscar a comanda e validar permissões do barbeiro
      const comanda = await tx.comanda.findFirst({
        where: { id, barbershopId: data!.barbershopId },
        include: { items: true, appointment: true },
      });

      if (!comanda) {
        throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);
      }

      if (comanda.status === "CANCELLED") {
        throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada não pode ser finalizada.", 422);
      }

      // Validação de acesso do BARBER: deve estar associado à comanda ou agendamento
      if (data!.role === "BARBER") {
        if (!isLegacyOwnComanda(comanda, data!.memberId)) {
          throw new OperationalError(
            "COMANDA_SCOPE_FORBIDDEN",
            "Esta comanda não pertence ao profissional autenticado.",
            403
          );
        }
      }

      // 9B: COMANDA JÁ CLOSED
      if (comanda.status === "CLOSED") {
        const remainingCents = toCents(comanda.remainingTotal);
        if (remainingCents === 0) {
          if (body.payments.length > 0) {
            throw new OperationalError("COMANDA_ALREADY_SETTLED", "A comanda já está totalmente paga e encerrada.", 422);
          }
          const fullComanda = await tx.comanda.findUnique({
            where: { id },
            include: comandaInclude,
          });
          return fullComanda;
        }

        // CLOSED com dívida
        if (!canManageDebt(data!.role)) {
          throw new OperationalError("DEBT_PERMISSION_REQUIRED", "Apenas gerentes e proprietários podem receber saldo de comanda fechada.", 403);
        }

        const totalPaymentsCents = body.payments.reduce((sum, p) => {
          const cents = Math.round(Number(p.amount) * 100);
          if (cents <= 0) {
            throw new OperationalError("INVALID_PAYMENT_AMOUNT", "Cada pagamento deve ser maior que zero.", 400);
          }
          return sum + cents;
        }, 0);

        if (totalPaymentsCents === 0) {
          throw new OperationalError("PAYMENT_REQUIRED", "Informe o pagamento para receber o saldo em aberto.", 422);
        }

        if (totalPaymentsCents > remainingCents) {
          throw new OperationalError("PAYMENT_EXCEEDS_REMAINING", `A soma dos pagamentos (R$ ${(totalPaymentsCents / 100).toFixed(2)}) excede o saldo restante da comanda (R$ ${(remainingCents / 100).toFixed(2)}).`, 422);
        }

        for (let i = 0; i < body.payments.length; i++) {
          const p = body.payments[i];
          const paymentIdempotencyKey = idempotencyKey ? `${idempotencyKey}-part-${i}` : null;
          if (p.method === "CUSTOMER_CREDIT") {
            await payComandaWithCustomerCredit(tx, {
              barbershopId: data!.barbershopId,
              comandaId: id,
              amount: p.amount,
              userId: data!.userId,
              idempotencyKey: paymentIdempotencyKey,
              allowClosedDebtPayment: true,
            });
          } else {
            await registerPayment(tx, {
              barbershopId: data!.barbershopId,
              comandaId: id,
              method: p.method,
              amount: p.amount,
              userId: data!.userId,
              idempotencyKey: paymentIdempotencyKey,
              allowClosedDebtPayment: true,
            });
          }
        }

        return recalculateComandaTotals(tx, id);
      }

      // 9A: COMANDA AINDA ABERTA
      const hasPendingService = comanda.items.some(
        (item) => item.type === "SERVICE" && item.status === "PENDING"
      );
      if (hasPendingService) {
        throw new OperationalError(
          "PENDING_ITEMS",
          "Conclua ou cancele todos os itens de serviço antes de finalizar a comanda.",
          422
        );
      }

      // Recalcular totais para garantir dados atualizados
      const currentComanda = await recalculateComandaTotals(tx, id);
      const remainingCents = toCents(currentComanda.remainingTotal);

      const totalPaymentsCents = body.payments.reduce((sum, p) => {
        const cents = Math.round(Number(p.amount) * 100);
        if (cents <= 0) {
          throw new OperationalError("INVALID_PAYMENT_AMOUNT", "Cada pagamento deve ser maior que zero.", 400);
        }
        return sum + cents;
      }, 0);

      if (totalPaymentsCents > remainingCents) {
        throw new OperationalError("OVERPAYMENT", "A soma dos pagamentos excede o saldo da comanda.", 422);
      }

      const isPartialOrZero = totalPaymentsCents < remainingCents;

      if (isPartialOrZero) {
        if (!canManageDebt(data!.role)) {
          throw new OperationalError("DEBT_PERMISSION_REQUIRED", "Apenas gerentes e proprietários podem finalizar comanda com saldo em aberto.", 403);
        }
        if (!body.closeWithDebt || !body.confirmOutstandingBalance) {
          throw new OperationalError(
            "DEBT_CONFIRMATION_REQUIRED",
            "É necessário confirmar o encerramento com saldo em aberto.",
            422
          );
        }
      }

      // Registrar cada pagamento sequencialmente
      for (let i = 0; i < body.payments.length; i++) {
        const p = body.payments[i];
        const paymentIdempotencyKey = idempotencyKey ? `${idempotencyKey}-part-${i}` : null;
        
        if (p.method === "CUSTOMER_CREDIT") {
          await payComandaWithCustomerCredit(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            amount: p.amount,
            userId: data!.userId,
            idempotencyKey: paymentIdempotencyKey,
          });
        } else {
          await registerPayment(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            method: p.method,
            amount: p.amount,
            userId: data!.userId,
            idempotencyKey: paymentIdempotencyKey,
          });
        }
      }

      // Chamar o fechamento da comanda
      const closedComanda = await closeComanda(tx, data!.barbershopId, id, { allowOutstanding: isPartialOrZero });
      return closedComanda;
    });

    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
