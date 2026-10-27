import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { canBackdatePayment, canManageDebt, isLegacyOwnComanda, requireOperationalSession } from "@/lib/operations/permissions";
import { parseAndValidatePaymentDate } from "@/lib/operations/payment-dates";
import { operationErrorResponse } from "@/lib/operations/responses";
import { comandaInclude, lockComandaRow, OperationalError, recalculateComandaTotals } from "@/lib/operations/comandas";
import { registerPayment, payComandaWithCustomerCredit, closeComanda } from "@/lib/operations/payments";
import { positiveCents, toCents } from "@/lib/operations/money";
import { formatTimestampToCivilDateBR } from "@/lib/time-utils";

import { computeCheckoutFingerprint, processCheckoutAllocation, TenderInput } from "@/lib/operations/checkout";

interface PaymentItem {
  method: PaymentMethod;
  amount: string | number;
  paidAt?: string;
}

interface FinalizeBody {
  payments?: PaymentItem[];
  allocations?: TenderInput[];
  closeWithDebt?: boolean;
  confirmOutstandingBalance?: boolean;
  idempotencyKey?: string;
  paidAt?: string;
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

  if (!body.allocations && !Array.isArray(body.payments)) {
    return NextResponse.json({ error: "Informe 'allocations' ou 'payments'." }, { status: 400 });
  }

  // Obter chave de idempotência dos headers ou do body
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null;

  if (body.allocations && body.allocations.length > 0 && !idempotencyKey) {
    return NextResponse.json(
      {
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "É necessário fornecer uma chave de idempotência ao utilizar o modo de alocação de checkout.",
      },
      { status: 400 }
    );
  }

  try {
    // Validação de retrodatação e permissões gerenciais
    const datesToCheck: (string | undefined)[] = [
      body.paidAt,
      ...(body.payments?.map((p) => p.paidAt) || []),
      ...(body.allocations?.map((a) => (typeof a.paidAt === "string" ? a.paidAt : undefined)) || []),
    ];

    for (const dateStr of datesToCheck) {
      if (dateStr) {
        const { isBackdated } = parseAndValidatePaymentDate(dateStr);
        if (isBackdated && !canBackdatePayment(data!.role)) {
          return NextResponse.json(
            {
              error: "BACKDATE_PERMISSION_REQUIRED",
              message: "Apenas gerentes e administradores podem retroagir a data de pagamento.",
            },
            { status: 403 }
          );
        }
      }
    }
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

      // RESOLVER ROOT TRANSACTION EXISTENTE ANTES DA DECISÃO OPEN/CLOSED OU FINALIZE/DEBT_PAYMENT
      if (body.allocations && body.allocations.length > 0 && idempotencyKey) {
        const existingTx = await tx.checkoutTransaction.findFirst({
          where: { barbershopId: data!.barbershopId, idempotencyKey },
          include: { allocations: true },
        });

        if (existingTx) {
          if (existingTx.comandaId !== id) {
            throw new OperationalError(
              "IDEMPOTENCY_KEY_CONFLICT",
              "A chave de idempotência já foi utilizada com parâmetros diferentes.",
              409
            );
          }

          let derivedAllowOutstanding: boolean | undefined = undefined;
          if (existingTx.mode === "FINALIZE") {
            const fpTrue = computeCheckoutFingerprint({
              barbershopId: data!.barbershopId,
              comandaId: id,
              tenders: body.allocations,
              mode: "FINALIZE",
              allowOutstanding: true,
              paidAt: body.paidAt,
            });
            const fpFalse = computeCheckoutFingerprint({
              barbershopId: data!.barbershopId,
              comandaId: id,
              tenders: body.allocations,
              mode: "FINALIZE",
              allowOutstanding: false,
              paidAt: body.paidAt,
            });

            if (existingTx.payloadFingerprint === fpTrue) {
              derivedAllowOutstanding = true;
            } else if (existingTx.payloadFingerprint === fpFalse) {
              derivedAllowOutstanding = false;
            } else {
              throw new OperationalError(
                "IDEMPOTENCY_KEY_CONFLICT",
                "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                409
              );
            }

            if (body.closeWithDebt !== undefined) {
              const requestedAllow = Boolean(body.closeWithDebt && body.confirmOutstandingBalance);
              if (requestedAllow !== derivedAllowOutstanding) {
                throw new OperationalError(
                  "IDEMPOTENCY_KEY_CONFLICT",
                  "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                  409
                );
              }
            }
          } else if (existingTx.mode === "DEBT_PAYMENT") {
            const fpDebt = computeCheckoutFingerprint({
              barbershopId: data!.barbershopId,
              comandaId: id,
              tenders: body.allocations,
              mode: "DEBT_PAYMENT",
              paidAt: body.paidAt,
            });
            if (existingTx.payloadFingerprint !== fpDebt) {
              throw new OperationalError(
                "IDEMPOTENCY_KEY_CONFLICT",
                "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                409
              );
            }
          }

          const { comanda: closedComanda } = await processCheckoutAllocation(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            customerId: comanda.customerId,
            tenders: body.allocations,
            createdById: data!.userId,
            actorMemberId: data!.memberId,
            actorRole: data!.role,
            mode: existingTx.mode,
            allowOutstanding: derivedAllowOutstanding,
            idempotencyKey,
            paidAt: body.paidAt,
          });
          return closedComanda;
        }
      }

      // 9B: COMANDA JÁ CLOSED
      if (comanda.status === "CLOSED") {
        const remainingCents = toCents(comanda.remainingTotal);
        if (remainingCents === 0) {
          if (idempotencyKey && body.payments && body.payments.length > 0) {
            const existingPayments = await tx.payment.findMany({
              where: {
                barbershopId: data!.barbershopId,
                comandaId: id,
                OR: [
                  { idempotencyKey: { startsWith: `${idempotencyKey}-part-` } },
                  { idempotencyKey: idempotencyKey },
                ],
              },
              orderBy: { createdAt: "asc" },
            });

            if (existingPayments.length > 0) {
              if (existingPayments.length !== body.payments.length) {
                throw new OperationalError(
                  "IDEMPOTENCY_KEY_CONFLICT",
                  "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                  409
                );
              }

              for (let i = 0; i < body.payments.length; i++) {
                const reqP = body.payments[i];
                const expectedKey = `${idempotencyKey}-part-${i}`;
                const exP =
                  existingPayments.find((ep) => ep.idempotencyKey === expectedKey) ||
                  (body.payments.length === 1
                    ? existingPayments.find((ep) => ep.idempotencyKey === idempotencyKey)
                    : undefined);

                if (!exP) {
                  throw new OperationalError(
                    "IDEMPOTENCY_KEY_CONFLICT",
                    "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                    409
                  );
                }

                const effectiveDateStr = reqP.paidAt || body.paidAt;
                const { civilDate: reqCivil } = parseAndValidatePaymentDate(effectiveDateStr);
                const exCivil = formatTimestampToCivilDateBR(exP.paidAt);

                if (
                  exP.method !== reqP.method ||
                  toCents(exP.amount) !== positiveCents(reqP.amount, "Valor do pagamento") ||
                  exCivil !== reqCivil
                ) {
                  throw new OperationalError(
                    "IDEMPOTENCY_KEY_CONFLICT",
                    "A chave de idempotência já foi utilizada com parâmetros diferentes.",
                    409
                  );
                }
              }

              const fullComanda = await tx.comanda.findUnique({
                where: { id },
                include: comandaInclude,
              });
              return fullComanda;
            }
          }

          if ((body.payments && body.payments.length > 0) || (body.allocations && body.allocations.length > 0)) {
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

        if (body.allocations && body.allocations.length > 0) {
          const { comanda: closedComanda } = await processCheckoutAllocation(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            customerId: comanda.customerId,
            tenders: body.allocations,
            createdById: data!.userId,
            actorMemberId: data!.memberId,
            actorRole: data!.role,
            mode: "DEBT_PAYMENT",
            idempotencyKey,
            paidAt: body.paidAt,
          });
          return closedComanda;
        }

        const paymentsList = body.payments || [];
        const totalPaymentsCents = paymentsList.reduce((sum, p) => {
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

        for (let i = 0; i < paymentsList.length; i++) {
          const p = paymentsList[i];
          const paymentIdempotencyKey = idempotencyKey ? `${idempotencyKey}-part-${i}` : null;
          const effectivePaymentPaidAt = p.paidAt || body.paidAt;
          if (p.method === "CUSTOMER_CREDIT") {
            await payComandaWithCustomerCredit(tx, {
              barbershopId: data!.barbershopId,
              comandaId: id,
              amount: p.amount,
              userId: data!.userId,
              idempotencyKey: paymentIdempotencyKey,
              allowClosedDebtPayment: true,
              paidAt: effectivePaymentPaidAt,
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
              paidAt: effectivePaymentPaidAt,
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

      if (body.allocations && body.allocations.length > 0) {
        const allowOutstanding = Boolean(body.closeWithDebt && body.confirmOutstandingBalance);
        const { comanda: closedComanda } = await processCheckoutAllocation(tx, {
          barbershopId: data!.barbershopId,
          comandaId: id,
          customerId: comanda.customerId,
          tenders: body.allocations,
          createdById: data!.userId,
          actorMemberId: data!.memberId,
          actorRole: data!.role,
          mode: "FINALIZE",
          allowOutstanding,
          idempotencyKey,
          paidAt: body.paidAt,
        });
        return closedComanda;
      }

      const remainingCents = toCents(currentComanda.remainingTotal);

      const paymentsList = body.payments || [];
      const totalPaymentsCents = paymentsList.reduce((sum, p) => {
        const cents = Math.round(Number(p.amount) * 100);
        if (cents <= 0) {
          throw new OperationalError("INVALID_PAYMENT_AMOUNT", "Cada pagamento deve ser maior que zero.", 400);
        }
        return sum + cents;
      }, 0);

      if (totalPaymentsCents > remainingCents) {
        throw new OperationalError("OVERPAYMENT", "A soma dos pagamentos excede o saldo da comanda.", 422);
      }

      if (totalPaymentsCents === 0 && remainingCents > 0 && !body.closeWithDebt) {
        throw new OperationalError("PAYMENT_REQUIRED", "Informe pelo menos um pagamento para a comanda.", 422);
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
      for (let i = 0; i < paymentsList.length; i++) {
        const p = paymentsList[i];
        const paymentIdempotencyKey = idempotencyKey ? `${idempotencyKey}-part-${i}` : null;
        
        const effectivePaymentPaidAt = p.paidAt || body.paidAt;
        if (p.method === "CUSTOMER_CREDIT") {
          await payComandaWithCustomerCredit(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            amount: p.amount,
            userId: data!.userId,
            idempotencyKey: paymentIdempotencyKey,
            paidAt: effectivePaymentPaidAt,
          });
        } else {
          await registerPayment(tx, {
            barbershopId: data!.barbershopId,
            comandaId: id,
            method: p.method,
            amount: p.amount,
            userId: data!.userId,
            idempotencyKey: paymentIdempotencyKey,
            paidAt: effectivePaymentPaidAt,
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
