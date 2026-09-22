import { CheckoutAllocation, CheckoutTransaction, Comanda, PaymentMethod, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, MoneyValue, positiveCents, toCents } from "./money";
import { lockComandaRow, OperationalError } from "./comandas";
import { closeComanda, registerPayment } from "./payments";
import { consumeCustomerCredit, depositCustomerCreditFromCheckout } from "./customer-credit";
import { recordTip } from "./tips";

export interface TenderInput {
  method: PaymentMethod;
  receivedAmount: MoneyValue;
  tipAmount?: MoneyValue;
  tipMemberId?: string | null;
  creditDepositAmount?: MoneyValue;
}

function computeCheckoutFingerprint(input: {
  barbershopId: string;
  comandaId: string;
  tenders: TenderInput[];
}): string {
  const sortedTenders = [...input.tenders].sort((a, b) => a.method.localeCompare(b.method));
  const tenderStr = sortedTenders
    .map(
      (t) =>
        `${t.method}:${toCents(t.receivedAmount)}:${toCents(t.tipAmount || 0)}:${t.tipMemberId || ""}:${toCents(t.creditDepositAmount || 0)}`
    )
    .join("|");
  return `${input.barbershopId}:${input.comandaId}:${tenderStr}`;
}

export async function processCheckoutAllocation(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    comandaId: string;
    customerId?: string | null;
    tenders: TenderInput[];
    createdById: string;
    idempotencyKey?: string | null;
  }
): Promise<{ transaction: CheckoutTransaction & { allocations: CheckoutAllocation[] }; comanda: Comanda }> {
  if (!input.tenders || input.tenders.length === 0) {
    throw new OperationalError(
      "EMPTY_TENDERS",
      "É necessário informar pelo menos um meio de pagamento.",
      400
    );
  }

  const fingerprint = computeCheckoutFingerprint(input);

  if (input.idempotencyKey) {
    const existingTx = await tx.checkoutTransaction.findFirst({
      where: { barbershopId: input.barbershopId, fingerprint },
      include: { allocations: true },
    });
    if (existingTx) {
      const existingComanda = await tx.comanda.findUnique({ where: { id: input.comandaId } });
      return { transaction: existingTx, comanda: existingComanda! };
    }

    const keyConflict = await tx.idempotencyKey.findUnique({
      where: { barbershopId_key: { barbershopId: input.barbershopId, key: input.idempotencyKey } },
    });
    if (keyConflict) {
      throw new OperationalError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "A chave de idempotência já foi utilizada com parâmetros diferentes.",
        409
      );
    }
  }

  await lockComandaRow(tx, input.barbershopId, input.comandaId);
  const comanda = await tx.comanda.findUnique({
    where: { id: input.comandaId },
  });
  if (!comanda || comanda.barbershopId !== input.barbershopId) {
    throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);
  }

  if (comanda.status === "CLOSED" || comanda.status === "CANCELLED") {
    throw new OperationalError(
      "INVALID_COMANDA_STATUS",
      `Comanda não pode receber pagamentos no status atual (${comanda.status}).`,
      422
    );
  }

  const comandaRemainingCents = toCents(comanda.remainingTotal);
  let accumulatedSaleCents = 0;
  let totalReceivedCents = 0;
  let totalTipCents = 0;
  let totalCreditDepositCents = 0;
  let totalChangeCents = 0;

  const parsedTenders = input.tenders.map((t, idx) => {
    const receivedCents = positiveCents(t.receivedAmount, `Recebido meio #${idx + 1}`);
    const tipCents = t.tipAmount ? positiveCents(t.tipAmount, `Gorjeta meio #${idx + 1}`) : 0;
    const creditDepositCents = t.creditDepositAmount
      ? positiveCents(t.creditDepositAmount, `Depósito crédito meio #${idx + 1}`)
      : 0;

    if (t.method === "CUSTOMER_CREDIT") {
      if (tipCents > 0) {
        throw new OperationalError(
          "INVALID_CREDIT_TENDER",
          "Crédito do cliente não pode ser utilizado para pagar gorjeta.",
          422
        );
      }
      if (creditDepositCents > 0) {
        throw new OperationalError(
          "INVALID_CREDIT_TENDER",
          "Crédito do cliente não pode gerar novo depósito em crédito.",
          422
        );
      }
    }

    if (tipCents > 0 && !t.tipMemberId) {
      throw new OperationalError(
        "TIP_MEMBER_REQUIRED",
        `Profissional favorecido deve ser informado para a gorjeta do meio #${idx + 1}.`,
        422
      );
    }

    const nonSaleAllocatedCents = tipCents + creditDepositCents;
    if (receivedCents < nonSaleAllocatedCents) {
      throw new OperationalError(
        "INVALID_TENDER_ALLOCATION",
        `Valor recebido em ${t.method} (${receivedCents / 100}) é menor que gorjetas e depósitos (${nonSaleAllocatedCents / 100}).`,
        422
      );
    }

    const unallocatedAfterTips = receivedCents - nonSaleAllocatedCents;
    const neededForComandaRemaining = comandaRemainingCents - accumulatedSaleCents;

    let saleAppliedCents = 0;
    let changeCents = 0;

    if (unallocatedAfterTips <= neededForComandaRemaining) {
      saleAppliedCents = unallocatedAfterTips;
    } else {
      saleAppliedCents = neededForComandaRemaining;
      changeCents = unallocatedAfterTips - neededForComandaRemaining;
    }

    if (changeCents > 0 && t.method !== "CASH") {
      throw new OperationalError(
        "CHANGE_NOT_ALLOWED",
        `Meios de pagamento não em dinheiro (${t.method}) não podem gerar troco. Aloque o valor exato ou direcione para crédito.`,
        422
      );
    }

    accumulatedSaleCents += saleAppliedCents;
    totalReceivedCents += receivedCents;
    totalTipCents += tipCents;
    totalCreditDepositCents += creditDepositCents;
    totalChangeCents += changeCents;

    return {
      method: t.method,
      receivedCents,
      saleAppliedCents,
      tipCents,
      tipMemberId: t.tipMemberId || null,
      creditDepositCents,
      changeCents,
    };
  });

  if (accumulatedSaleCents !== comandaRemainingCents) {
    throw new OperationalError(
      "SALE_ALLOCATION_MISMATCH",
      `O total alocado para a venda (R$ ${(accumulatedSaleCents / 100).toFixed(2)}) não quita o saldo remanescente da comanda (R$ ${(comandaRemainingCents / 100).toFixed(2)}).`,
      422
    );
  }

  const effectiveCustomerId = comanda.customerId || input.customerId;

  const checkoutTx = await tx.checkoutTransaction.create({
    data: {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      totalReceivedAmount: fromCents(totalReceivedCents),
      totalSaleApplied: fromCents(accumulatedSaleCents),
      totalTipAmount: fromCents(totalTipCents),
      totalCreditDeposit: fromCents(totalCreditDepositCents),
      totalChangeAmount: fromCents(totalChangeCents),
      fingerprint,
      createdById: input.createdById,
    },
    include: { allocations: true },
  });

  for (const t of parsedTenders) {
    if (t.saleAppliedCents > 0) {
      const allocation = await tx.checkoutAllocation.create({
        data: {
          checkoutTransactionId: checkoutTx.id,
          barbershopId: input.barbershopId,
          tenderMethod: t.method,
          receivedAmount: fromCents(t.receivedCents),
          allocationKind: "SALE_PAYMENT",
          allocatedAmount: fromCents(t.saleAppliedCents),
        },
      });

      if (t.method === "CUSTOMER_CREDIT") {
        if (!effectiveCustomerId) {
          throw new OperationalError(
            "CUSTOMER_REQUIRED_FOR_CREDIT",
            "É necessário um cliente identificado na comanda para pagar com crédito.",
            422
          );
        }
        const creditPaymentId = `CP-CREDIT-${allocation.id}`;
        await consumeCustomerCredit(tx, {
          barbershopId: input.barbershopId,
          customerId: effectiveCustomerId,
          amount: fromCents(t.saleAppliedCents),
          comandaId: input.comandaId,
          paymentId: creditPaymentId,
          createdByUserId: input.createdById,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:sale:${allocation.id}` : null,
        });

        const payment = await tx.payment.create({
          data: {
            barbershopId: input.barbershopId,
            comandaId: input.comandaId,
            method: "CUSTOMER_CREDIT",
            amount: fromCents(t.saleAppliedCents),
            status: "CONFIRMED",
            receivedById: input.createdById,
            checkoutAllocationId: allocation.id,
          },
        });

        await tx.financialEntry.create({
          data: {
            barbershopId: input.barbershopId,
            type: "COMMAND_REVENUE",
            category: "RECEITA_COMANDA",
            amount: fromCents(t.saleAppliedCents),
            description: `Pagamento de comanda via Crédito de Cliente`,
            comandaId: input.comandaId,
            paymentId: payment.id,
          },
        });
      } else {
        await registerPayment(tx, {
          barbershopId: input.barbershopId,
          comandaId: input.comandaId,
          method: t.method,
          amount: t.saleAppliedCents / 100,
          userId: input.createdById,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:sale:${allocation.id}` : null,
          checkoutAllocationId: allocation.id,
        });
      }
    }

    if (t.tipCents > 0 && t.tipMemberId) {
      const tipAllocation = await tx.checkoutAllocation.create({
        data: {
          checkoutTransactionId: checkoutTx.id,
          barbershopId: input.barbershopId,
          tenderMethod: t.method,
          receivedAmount: fromCents(t.receivedCents),
          allocationKind: "TIP",
          allocatedAmount: fromCents(t.tipCents),
          tipMemberId: t.tipMemberId,
        },
      });

      await recordTip(tx, {
        barbershopId: input.barbershopId,
        comandaId: input.comandaId,
        memberId: t.tipMemberId,
        amount: fromCents(t.tipCents),
        method: t.method,
        checkoutAllocationId: tipAllocation.id,
        createdById: input.createdById,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:tip:${tipAllocation.id}` : null,
      });
    }

    if (t.creditDepositCents > 0) {
      if (!effectiveCustomerId) {
        throw new OperationalError(
          "CUSTOMER_REQUIRED_FOR_CREDIT",
          "É necessário um cliente identificado na comanda para depositar o troco em crédito.",
          422
        );
      }

      const depositAllocation = await tx.checkoutAllocation.create({
        data: {
          checkoutTransactionId: checkoutTx.id,
          barbershopId: input.barbershopId,
          tenderMethod: t.method,
          receivedAmount: fromCents(t.receivedCents),
          allocationKind: "CUSTOMER_CREDIT_DEPOSIT",
          allocatedAmount: fromCents(t.creditDepositCents),
        },
      });

      const { entry: creditEntry } = await depositCustomerCreditFromCheckout(tx, {
        barbershopId: input.barbershopId,
        customerId: effectiveCustomerId,
        amount: fromCents(t.creditDepositCents),
        fundingMethod: t.method,
        comandaId: input.comandaId,
        checkoutAllocationId: depositAllocation.id,
        createdByUserId: input.createdById,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:deposit:${depositAllocation.id}` : null,
      });

      if (t.method === "CASH") {
        const activeSession = await tx.cashSession.findFirst({
          where: { barbershopId: input.barbershopId, status: "OPEN" },
        });
        if (activeSession) {
          await tx.cashMovement.create({
            data: {
              barbershopId: input.barbershopId,
              cashSessionId: activeSession.id,
              amount: fromCents(t.creditDepositCents),
              description: `Depósito de troco em crédito de cliente via dinheiro`,
              customerCreditEntryId: creditEntry.id,
            },
          });
        }
      }

      await tx.financialEntry.create({
        data: {
          barbershopId: input.barbershopId,
          type: "CUSTOMER_CREDIT_DEPOSIT",
          category: "DEPOSITO_CREDITO_CLIENTE",
          amount: fromCents(t.creditDepositCents),
          description: `Depósito de crédito de cliente via troco de checkout`,
          comandaId: input.comandaId,
          customerCreditEntryId: creditEntry.id,
        },
      });
    }

    if (t.changeCents > 0 && t.method === "CASH") {
      const activeSession = await tx.cashSession.findFirst({
        where: { barbershopId: input.barbershopId, status: "OPEN" },
      });
      if (activeSession) {
        await tx.cashMovement.create({
          data: {
            barbershopId: input.barbershopId,
            cashSessionId: activeSession.id,
            amount: fromCents(-t.changeCents),
            description: `Troco devolvido em dinheiro ao cliente na comanda ${input.comandaId.split("-")[0]}`,
          },
        });
      }
    }
  }

  if (input.idempotencyKey) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.idempotencyKey.create({
      data: {
        barbershopId: input.barbershopId,
        key: input.idempotencyKey,
        requestHash: fingerprint,
        result: { checkoutTransactionId: checkoutTx.id },
        expiresAt,
      },
    });
  }

  const updatedComanda = await closeComanda(tx, input.barbershopId, input.comandaId);

  return {
    transaction: checkoutTx,
    comanda: updatedComanda,
  };
}

export async function reconcileCheckoutTransaction(
  barbershopId: string,
  checkoutTransactionId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const transaction = await client.checkoutTransaction.findUnique({
    where: { id: checkoutTransactionId },
    include: { allocations: true },
  });

  if (!transaction || transaction.barbershopId !== barbershopId) {
    throw new OperationalError("TRANSACTION_NOT_FOUND", "Transação de checkout não encontrada.", 404);
  }

  const receivedCents = toCents(transaction.totalReceivedAmount);
  const saleCents = toCents(transaction.totalSaleApplied);
  const tipCents = toCents(transaction.totalTipAmount);
  const depositCents = toCents(transaction.totalCreditDeposit);
  const changeCents = toCents(transaction.totalChangeAmount);

  const equationBalanced = receivedCents === saleCents + tipCents + depositCents + changeCents;

  let allocatedSaleCents = 0;
  let allocatedTipCents = 0;
  let allocatedDepositCents = 0;

  for (const alloc of transaction.allocations) {
    const cents = toCents(alloc.allocatedAmount);
    if (alloc.allocationKind === "SALE_PAYMENT") allocatedSaleCents += cents;
    else if (alloc.allocationKind === "TIP") allocatedTipCents += cents;
    else if (alloc.allocationKind === "CUSTOMER_CREDIT_DEPOSIT") allocatedDepositCents += cents;
  }

  const allocationsBalanced =
    allocatedSaleCents === saleCents &&
    allocatedTipCents === tipCents &&
    allocatedDepositCents === depositCents;

  return {
    isBalanced: equationBalanced && allocationsBalanced,
    equationBalanced,
    allocationsBalanced,
    received: Number((receivedCents / 100).toFixed(2)),
    saleApplied: Number((saleCents / 100).toFixed(2)),
    tipAmount: Number((tipCents / 100).toFixed(2)),
    creditDeposit: Number((depositCents / 100).toFixed(2)),
    changeAmount: Number((changeCents / 100).toFixed(2)),
  };
}
