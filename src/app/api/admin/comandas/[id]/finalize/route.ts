import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { requireOperationalSession, forbidden } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import { comandaInclude, OperationalError, recalculateComandaTotals } from "@/lib/operations/comandas";
import { registerPayment, closeComanda } from "@/lib/operations/payments";
import { toCents } from "@/lib/operations/money";

interface PaymentItem {
  method: PaymentMethod;
  amount: string | number;
}

interface FinalizeBody {
  payments: PaymentItem[];
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

  if (!body.payments || !Array.isArray(body.payments) || body.payments.length === 0) {
    return NextResponse.json({ error: "payments é obrigatório e deve ser um array não vazio." }, { status: 400 });
  }

  // Obter chave de idempotência dos headers ou do body
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? body.idempotencyKey ?? null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Buscar a comanda e validar permissões do barbeiro
      const comanda = await tx.comanda.findFirst({
        where: { id, barbershopId: data!.barbershopId },
        include: { items: true, appointment: true },
      });

      if (!comanda) {
        throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);
      }

      // Se a comanda já estiver CLOSED, retorna ela imediatamente (idempotência amigável)
      if (comanda.status === "CLOSED") {
        const fullComanda = await tx.comanda.findUnique({
          where: { id },
          include: comandaInclude,
        });
        return fullComanda;
      }

      if (comanda.status === "CANCELLED") {
        throw new OperationalError("COMANDA_CANCELLED", "Comanda cancelada não pode ser finalizada.", 422);
      }

      // Validação de acesso do BARBER: deve estar associado à comanda ou agendamento
      if (data!.role === "BARBER") {
        const isExecutorOfAppt = comanda.appointment?.memberId === data!.memberId;
        const isExecutorOfItem = comanda.items.some(item => item.executorId === data!.memberId);
        const isCreator = comanda.customerId === null && comanda.items.length === 0;
        if (!isExecutorOfAppt && !isExecutorOfItem && !isCreator) {
          throw new OperationalError("FORBIDDEN", "Acesso negado para esta comanda.", 403);
        }
      }

      // Recalcular totais para garantir dados atualizados
      const currentComanda = await recalculateComandaTotals(tx, id);

      // 3. Validar se a soma dos pagamentos cobre exatamente o remainingTotal
      const totalPaymentsCents = body.payments.reduce((sum, p) => {
        const cents = Math.round(Number(p.amount) * 100);
        if (cents <= 0) {
          throw new OperationalError("INVALID_PAYMENT_AMOUNT", "Cada pagamento deve ser maior que zero.", 400);
        }
        return sum + cents;
      }, 0);

      const remainingCents = toCents(currentComanda.remainingTotal);

      // Se a comanda tiver valor total zero (ou coberta por descontos), e não enviou pagamentos
      // permitimos fechar se a soma de pagamentos for 0 e o restante for 0.
      if (remainingCents === 0 && totalPaymentsCents > 0) {
        throw new OperationalError("OVERPAYMENT", "A comanda já está totalmente paga.", 422);
      }

      if (remainingCents > 0 && totalPaymentsCents !== remainingCents) {
        throw new OperationalError(
          "PAYMENT_TOTAL_MISMATCH",
          `A soma dos pagamentos (R$ ${(totalPaymentsCents / 100).toFixed(2)}) não corresponde ao saldo restante da comanda (R$ ${(remainingCents / 100).toFixed(2)}).`,
          422
        );
      }

      // 4. Registrar cada pagamento sequencialmente
      for (let i = 0; i < body.payments.length; i++) {
        const p = body.payments[i];
        const paymentIdempotencyKey = idempotencyKey ? `${idempotencyKey}-part-${i}` : null;
        
        await registerPayment(tx, {
          barbershopId: data!.barbershopId,
          comandaId: id,
          method: p.method,
          amount: p.amount,
          userId: data!.userId,
          idempotencyKey: paymentIdempotencyKey,
        });
      }

      // 5. Chamar o fechamento da comanda (que valida estoque, atualiza agendamento e comissão)
      const closedComanda = await closeComanda(tx, data!.barbershopId, id);
      return closedComanda;
    });

    // Se o resultado for uma comanda ou um erro operacional
    return NextResponse.json(result);
  } catch (err) {
    return operationErrorResponse(err);
  }
}
