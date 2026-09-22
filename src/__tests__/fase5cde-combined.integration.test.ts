import { describe, test, expect, beforeAll, afterAll } from "vitest";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { processCheckoutAllocation, reconcileCheckoutTransaction } from "@/lib/operations/checkout";
import { recordTip, refundTip, executeTipPayout, reverseTipPayout, reconcileTipLedger } from "@/lib/operations/tips";
import { cancelComanda } from "@/lib/operations/comandas";
import { getCustomerCreditAccount, reconcileCustomerCreditBalance } from "@/lib/operations/customer-credit";
import { canRefundTip, canPayoutTips, canReverseTipPayout } from "@/lib/operations/permissions";

describe("FASE 5C+5D+5E - Combined Integration Test Suite", () => {
  let barbershopId: string;
  let barberMemberId: string;
  let customerId: string;
  let cashierUserId: string;
  let serviceId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const barbershop = await prisma.barbershop.create({
      data: {
        name: `Barbearia Integration 5CDE ${timestamp}`,
        slug: `barbearia-int-5cde-${timestamp}`,
        phone: `119999${timestamp.toString().slice(-5)}`,
        street: "Rua Teste",
        number: "100",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        zipCode: "01000-000",
      },
    });
    barbershopId = barbershop.id;

    const userBarber = await prisma.user.create({
      data: {
        name: "Barbeiro Teste",
        phone: `119888${timestamp.toString().slice(-5)}`,
      },
    });

    const member = await prisma.barbershopMember.create({
      data: {
        barbershopId,
        userId: userBarber.id,
        role: "BARBER",
      },
    });
    barberMemberId = member.id;

    const userCustomer = await prisma.user.create({
      data: {
        name: "Cliente Teste",
        phone: `119777${timestamp.toString().slice(-5)}`,
      },
    });
    customerId = userCustomer.id;

    const userCashier = await prisma.user.create({
      data: {
        name: "Caixa Teste",
        phone: `119666${timestamp.toString().slice(-5)}`,
      },
    });
    cashierUserId = userCashier.id;

    const category = await prisma.category.create({
      data: {
        barbershopId,
        name: "Corte",
        slug: `corte-int-${timestamp}`,
      },
    });

    const service = await prisma.service.create({
      data: {
        barbershopId,
        categoryId: category.id,
        name: "Corte de Cabelo",
        price: 50.0,
        durationMin: 30,
      },
    });
    serviceId = service.id;

    // Open cash session
    await prisma.cashSession.create({
      data: {
        barbershopId,
        openedById: cashierUserId,
        openingAmount: 100.0,
        status: "OPEN",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("1. RBAC and Permissions Invariants (Fase 5E Hardening)", () => {
    test("SUPER_ADMIN and BARBER are DENIED (403) for tip refund, payout, and reversal", () => {
      expect(canRefundTip("SUPER_ADMIN")).toBe(false);
      expect(canPayoutTips("SUPER_ADMIN")).toBe(false);
      expect(canReverseTipPayout("SUPER_ADMIN")).toBe(false);

      expect(canRefundTip("BARBER")).toBe(false);
      expect(canPayoutTips("BARBER")).toBe(false);
      expect(canReverseTipPayout("BARBER")).toBe(false);

      expect(canRefundTip("OWNER")).toBe(true);
      expect(canRefundTip("MANAGER")).toBe(true);
      expect(canPayoutTips("OWNER")).toBe(true);
      expect(canPayoutTips("MANAGER")).toBe(true);
      expect(canReverseTipPayout("OWNER")).toBe(true);
      expect(canReverseTipPayout("MANAGER")).toBe(true);
    });
  });

  describe("2. Gorjetas Invariants & Partial Refunds (Fase 5C)", () => {
    test("TIP_RECEIVED does NOT change comanda total or commission base", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      const tip = await prisma.$transaction(async (tx) => {
        return recordTip(tx, {
          barbershopId,
          comandaId: comanda.id,
          memberId: barberMemberId,
          amount: 15.0,
          method: PaymentMethod.PIX,
          createdById: cashierUserId,
        });
      });

      expect(tip.status).toBe("ACTIVE");
      expect(Number(tip.amount)).toBe(15.0);

      const refreshedComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
      expect(Number(refreshedComanda?.total)).toBe(50.0);
      expect(Number(refreshedComanda?.subtotal)).toBe(50.0);

      const financialEntry = await prisma.financialEntry.findFirst({
        where: { tipEntryId: tip.id },
      });
      expect(financialEntry?.type).toBe("TIP_RECEIVED");
      expect(Number(financialEntry?.amount)).toBe(15.0);

      const ledger = await reconcileTipLedger(barbershopId, barberMemberId);
      expect(ledger.isBalanced).toBe(true);
      expect(ledger.activePending).toBe(15.0);
    });

    test("Partial tip refund, multiple partials, exceed available, and idempotency", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste Partial",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 50.0,
          remainingTotal: 0.0,
          status: "CLOSED",
        },
      });

      const tip = await prisma.$transaction(async (tx) => {
        return recordTip(tx, {
          barbershopId,
          comandaId: comanda.id,
          memberId: barberMemberId,
          amount: 30.0,
          method: PaymentMethod.PIX,
          createdById: cashierUserId,
        });
      });

      // First partial refund $10
      const refund1 = await prisma.$transaction(async (tx) => {
        return refundTip(tx, {
          barbershopId,
          tipEntryId: tip.id,
          amountToRefund: 10.0,
          reason: "Primeiro estorno parcial",
          refundedById: cashierUserId,
          idempotencyKey: `ref-partial-1-${tip.id}`,
        });
      });
      expect(Number(refund1.amount)).toBe(10.0);

      const tipAfter1 = await prisma.tipEntry.findUnique({ where: { id: tip.id } });
      expect(tipAfter1?.status).toBe("PARTIALLY_REFUNDED");
      expect(Number(tipAfter1?.refundedAmount)).toBe(10.0);

      // Replay same idempotency key with same payload -> returns same refund
      const refund1Replay = await prisma.$transaction(async (tx) => {
        return refundTip(tx, {
          barbershopId,
          tipEntryId: tip.id,
          amountToRefund: 10.0,
          reason: "Primeiro estorno parcial",
          refundedById: cashierUserId,
          idempotencyKey: `ref-partial-1-${tip.id}`,
        });
      });
      expect(refund1Replay.id).toBe(refund1.id);

      // Same key with different amount -> 409 conflict
      await expect(
        prisma.$transaction(async (tx) => {
          return refundTip(tx, {
            barbershopId,
            tipEntryId: tip.id,
            amountToRefund: 15.0,
            reason: "Payload diferente",
            refundedById: cashierUserId,
            idempotencyKey: `ref-partial-1-${tip.id}`,
          });
        })
      ).rejects.toThrow("A chave de idempotência já foi utilizada com parâmetros diferentes.");

      // Second partial refund $10 (available remaining = 20)
      const refund2 = await prisma.$transaction(async (tx) => {
        return refundTip(tx, {
          barbershopId,
          tipEntryId: tip.id,
          amountToRefund: 10.0,
          reason: "Segundo estorno parcial",
          refundedById: cashierUserId,
        });
      });
      expect(Number(refund2.amount)).toBe(10.0);

      const tipAfter2 = await prisma.tipEntry.findUnique({ where: { id: tip.id } });
      expect(tipAfter2?.status).toBe("PARTIALLY_REFUNDED");
      expect(Number(tipAfter2?.refundedAmount)).toBe(20.0);

      // Attempt refund of $15 (available remaining is 10) -> throws TIP_REFUND_EXCEEDS_AVAILABLE
      await expect(
        prisma.$transaction(async (tx) => {
          return refundTip(tx, {
            barbershopId,
            tipEntryId: tip.id,
            amountToRefund: 15.0,
            reason: "Excede disponível",
            refundedById: cashierUserId,
          });
        })
      ).rejects.toThrow("excede o saldo disponível para estorno");

      // Full remaining refund $10 -> transitions status to REFUNDED
      const refund3 = await prisma.$transaction(async (tx) => {
        return refundTip(tx, {
          barbershopId,
          tipEntryId: tip.id,
          amountToRefund: 10.0,
          reason: "Estorno final restante",
          refundedById: cashierUserId,
        });
      });
      expect(Number(refund3.amount)).toBe(10.0);

      const tipAfter3 = await prisma.tipEntry.findUnique({ where: { id: tip.id } });
      expect(tipAfter3?.status).toBe("REFUNDED");
      expect(Number(tipAfter3?.refundedAmount)).toBe(30.0);
    });

    test("Payout and Reversal lifecycle with isPhysicalCashReturned flag", async () => {
      const cashUser = await prisma.user.create({
        data: { name: "Barbeiro Cash Payout", phone: `119333${Date.now().toString().slice(-5)}` },
      });
      const cashMember = await prisma.barbershopMember.create({
        data: { barbershopId, userId: cashUser.id, role: "BARBER" },
      });

      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Cash Payout",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 50.0,
          remainingTotal: 0.0,
          status: "CLOSED",
        },
      });

      await prisma.$transaction(async (tx) => {
        return recordTip(tx, {
          barbershopId,
          comandaId: comanda.id,
          memberId: cashMember.id,
          amount: 40.0,
          method: PaymentMethod.CASH,
          createdById: cashierUserId,
        });
      });

      // Payout in CASH (-40 in cash session)
      const payout = await prisma.$transaction(async (tx) => {
        return executeTipPayout(tx, {
          barbershopId,
          memberId: cashMember.id,
          method: PaymentMethod.CASH,
          createdById: cashierUserId,
        });
      });

      // Reversal WITHOUT physical cash return (isPhysicalCashReturned = false)
      const reversalNoCash = await prisma.$transaction(async (tx) => {
        return reverseTipPayout(tx, {
          barbershopId,
          payoutId: payout.id,
          isPhysicalCashReturned: false,
          reason: "Sem retorno fisico ao caixa",
          createdById: cashierUserId,
        });
      });

      const movementNoCash = await prisma.cashMovement.findFirst({
        where: { tipPayoutReversalId: reversalNoCash.id },
      });
      expect(movementNoCash).toBeNull();

      // Re-execute payout and reverse WITH physical cash return (isPhysicalCashReturned = true)
      const payout2 = await prisma.$transaction(async (tx) => {
        return executeTipPayout(tx, {
          barbershopId,
          memberId: cashMember.id,
          method: PaymentMethod.CASH,
          createdById: cashierUserId,
        });
      });

      const reversalWithCash = await prisma.$transaction(async (tx) => {
        return reverseTipPayout(tx, {
          barbershopId,
          payoutId: payout2.id,
          isPhysicalCashReturned: true,
          reason: "Com retorno fisico ao caixa",
          createdById: cashierUserId,
        });
      });

      const movementWithCash = await prisma.cashMovement.findFirst({
        where: { tipPayoutReversalId: reversalWithCash.id },
      });
      expect(movementWithCash).not.toBeNull();
      expect(Number(movementWithCash?.amount)).toBe(40.0);
    });
  });

  describe("3. Checkout Allocation Engine Invariants (Fase 5D)", () => {
    test("Rejects non-CASH change", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return processCheckoutAllocation(tx, {
            barbershopId,
            comandaId: comanda.id,
            tenders: [
              {
                method: PaymentMethod.PIX,
                receivedAmount: 70.0,
              },
            ],
            createdById: cashierUserId,
          });
        })
      ).rejects.toThrow("Meios de pagamento não em dinheiro (PIX) não podem gerar troco.");
    });

    test("Rejects CUSTOMER_CREDIT tip or deposit", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return processCheckoutAllocation(tx, {
            barbershopId,
            comandaId: comanda.id,
            tenders: [
              {
                method: PaymentMethod.CUSTOMER_CREDIT,
                receivedAmount: 50.0,
                tipAmount: 10.0,
              },
            ],
            createdById: cashierUserId,
          });
        })
      ).rejects.toThrow("Crédito do cliente não pode ser utilizado para pagar gorjeta.");
    });

    test("Valid Multi-tender Checkout (PIX + CASH with Credit Deposit)", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      await prisma.comandaItem.create({
        data: {
          comandaId: comanda.id,
          barbershopId,
          type: "SERVICE",
          description: "Corte de Cabelo",
          quantity: 1,
          unitPrice: 50.0,
          total: 50.0,
          serviceId,
          executorId: barberMemberId,
          status: "DONE",
        },
      });

      const { transaction, comanda: closedComanda } = await prisma.$transaction(async (tx) => {
        return processCheckoutAllocation(tx, {
          barbershopId,
          comandaId: comanda.id,
          tenders: [
            {
              method: PaymentMethod.CASH,
              receivedAmount: 50.0,
              creditDepositAmount: 10.0,
            },
            {
              method: PaymentMethod.PIX,
              receivedAmount: 20.0,
              tipAmount: 10.0,
              tipMemberId: barberMemberId,
            },
          ],
          createdById: cashierUserId,
        });
      });

      expect(closedComanda?.status).toBe("CLOSED");
      expect(Number(closedComanda?.paidTotal)).toBe(50.0);
      expect(Number(closedComanda?.remainingTotal)).toBe(0.0);

      const reconciliation = await reconcileCheckoutTransaction(barbershopId, transaction.id);
      expect(reconciliation.isBalanced).toBe(true);
      expect(reconciliation.saleApplied).toBe(50.0);
      expect(reconciliation.tipAmount).toBe(10.0);
      expect(reconciliation.creditDeposit).toBe(10.0);

      const account = await getCustomerCreditAccount(barbershopId, customerId);
      expect(Number(account.balance)).toBe(10.0);
    });
  });

  describe("4. Full Atomic Rollback on Comanda Cancel (Fase 5E)", () => {
    test("Cancelling comanda refunds sale, tips, and credit deposits", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Teste",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      await prisma.comandaItem.create({
        data: {
          comandaId: comanda.id,
          barbershopId,
          type: "SERVICE",
          description: "Corte",
          quantity: 1,
          unitPrice: 50.0,
          total: 50.0,
          serviceId,
          executorId: barberMemberId,
          status: "DONE",
        },
      });

      await prisma.$transaction(async (tx) => {
        return processCheckoutAllocation(tx, {
          barbershopId,
          comandaId: comanda.id,
          tenders: [
            {
              method: PaymentMethod.CASH,
              receivedAmount: 60.0,
              tipAmount: 10.0,
              tipMemberId: barberMemberId,
              creditDepositAmount: 10.0,
            },
            {
              method: PaymentMethod.PIX,
              receivedAmount: 10.0,
            },
          ],
          createdById: cashierUserId,
        });
      });

      const cancelledComanda = await prisma.$transaction(async (tx) => {
        return cancelComanda(tx, {
          barbershopId,
          comandaId: comanda.id,
          reason: "Cliente desistiu",
          userId: cashierUserId,
          refundAll: true,
        });
      });

      expect(cancelledComanda.status).toBe("CANCELLED");

      const tip = await prisma.tipEntry.findFirst({ where: { comandaId: comanda.id } });
      expect(tip?.status).toBe("REFUNDED");

      const creditReversal = await prisma.customerCreditEntry.findFirst({
        where: { comandaId: comanda.id, sourceKind: "OVERPAYMENT_REVERSAL" },
      });
      expect(creditReversal).not.toBeNull();

      const creditReconcile = await reconcileCustomerCreditBalance(barbershopId, customerId);
      expect(creditReconcile.isBalanced).toBe(true);
    });
  });

  describe("5. Advanced Business Scenarios & Hardening (Fase 5E)", () => {
    test("Zero-price comanda checkout with Tip", async () => {
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Clube Zero",
          subtotal: 0.0,
          total: 0.0,
          paidTotal: 0.0,
          remainingTotal: 0.0,
          status: "OPEN",
        },
      });

      const { comanda: closedComanda } = await prisma.$transaction(async (tx) => {
        return processCheckoutAllocation(tx, {
          barbershopId,
          comandaId: comanda.id,
          tenders: [
            {
              method: PaymentMethod.PIX,
              receivedAmount: 20.0,
              tipAmount: 20.0,
              tipMemberId: barberMemberId,
            },
          ],
          createdById: cashierUserId,
        });
      });

      expect(closedComanda?.status).toBe("CLOSED");
      expect(Number(closedComanda?.paidTotal)).toBe(0.0);
      expect(Number(closedComanda?.remainingTotal)).toBe(0.0);

      const tip = await prisma.tipEntry.findFirst({ where: { comandaId: comanda.id } });
      expect(tip?.status).toBe("ACTIVE");
      expect(Number(tip?.amount)).toBe(20.0);
    });

    test("Tenant isolation blocks cross-tenant checkout or tip access", async () => {
      const foreignBarbershop = await prisma.barbershop.create({
        data: {
          name: "Barbearia Outra",
          slug: `outra-${Date.now()}`,
          phone: "11911111111",
          street: "Rua B",
          number: "2",
          neighborhood: "Bairro",
          city: "SP",
          state: "SP",
          zipCode: "02000-000",
        },
      });

      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Iso",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 0.0,
          remainingTotal: 50.0,
          status: "OPEN",
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return processCheckoutAllocation(tx, {
            barbershopId: foreignBarbershop.id,
            comandaId: comanda.id,
            tenders: [{ method: PaymentMethod.CASH, receivedAmount: 50.0 }],
            createdById: cashierUserId,
          });
        })
      ).rejects.toThrow("Comanda nao encontrada.");
    });
  });
});
