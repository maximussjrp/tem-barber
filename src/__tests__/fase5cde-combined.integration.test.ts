import { describe, test, expect, beforeAll, afterAll } from "vitest";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { processCheckoutAllocation, reconcileCheckoutTransaction } from "@/lib/operations/checkout";
import { recordTip, executeTipPayout, reverseTipPayout, reconcileTipLedger } from "@/lib/operations/tips";
import { cancelComanda } from "@/lib/operations/comandas";
import { getCustomerCreditAccount, reconcileCustomerCreditBalance } from "@/lib/operations/customer-credit";

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

  describe("1. Gorjetas Invariants (Fase 5C)", () => {
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

    test("Payout and Reversal lifecycle", async () => {
      const payout = await prisma.$transaction(async (tx) => {
        return executeTipPayout(tx, {
          barbershopId,
          memberId: barberMemberId,
          method: PaymentMethod.PIX,
          createdById: cashierUserId,
        });
      });

      expect(payout.status).toBe("COMPLETED");
      expect(Number(payout.totalAmount)).toBe(15.0);

      const reversal = await prisma.$transaction(async (tx) => {
        return reverseTipPayout(tx, {
          barbershopId,
          payoutId: payout.id,
          reason: "Erro de digitação",
          createdById: cashierUserId,
        });
      });

      expect(reversal.payoutId).toBe(payout.id);

      const tip = await prisma.tipEntry.findFirst({ where: { barbershopId, memberId: barberMemberId } });
      expect(tip?.status).toBe("ACTIVE");
    });
  });

  describe("2. Checkout Allocation Engine Invariants (Fase 5D)", () => {
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
                receivedAmount: 70.0, // 50 sale + 20 unallocated non-CASH change -> invalid
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
              receivedAmount: 50.0, // 40 sale + 10 deposit
              creditDepositAmount: 10.0,
            },
            {
              method: PaymentMethod.PIX,
              receivedAmount: 20.0, // 10 sale + 10 tip
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

  describe("3. Full Atomic Rollback on Comanda Cancel (Fase 5E)", () => {
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
              receivedAmount: 60.0, // 40 sale + 10 tip + 10 deposit
              tipAmount: 10.0,
              tipMemberId: barberMemberId,
              creditDepositAmount: 10.0,
            },
            {
              method: PaymentMethod.PIX,
              receivedAmount: 10.0, // 10 sale
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

  describe("4. Advanced Business Scenarios & Hardening (Fase 5E)", () => {
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
              receivedAmount: 20.0, // $0 sale + $20 tip
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

    test("FIFO Tip Payout and TipPayoutReversalAllocation tracking", async () => {
      const fifoUser = await prisma.user.create({
        data: { name: "Barbeiro FIFO", phone: `119555${Date.now().toString().slice(-5)}` },
      });
      const fifoMember = await prisma.barbershopMember.create({
        data: { barbershopId, userId: fifoUser.id, role: "BARBER" },
      });

      const comanda = await prisma.comanda.create({
        data: {
          barbershopId,
          customerId,
          customerName: "Cliente Tip FIFO",
          subtotal: 50.0,
          total: 50.0,
          paidTotal: 50.0,
          remainingTotal: 0.0,
          status: "CLOSED",
        },
      });

      // 1. Create a tip for barber
      const createdTip = await prisma.$transaction(async (tx) => {
        return recordTip(tx, {
          barbershopId,
          comandaId: comanda.id,
          memberId: fifoMember.id,
          amount: 25.0,
          method: PaymentMethod.PIX,
          createdById: cashierUserId,
        });
      });
      expect(createdTip.status).toBe("ACTIVE");

      // 2. Execute Payout
      const payout = await prisma.$transaction(async (tx) => {
        return executeTipPayout(tx, {
          barbershopId,
          memberId: fifoMember.id,
          method: PaymentMethod.PIX,
          createdById: cashierUserId,
        });
      });

      expect(payout.status).toBe("COMPLETED");

      // 3. Reverse Payout and verify TipPayoutReversalAllocation
      const reversal = await prisma.$transaction(async (tx) => {
        return reverseTipPayout(tx, {
          barbershopId,
          payoutId: payout.id,
          reason: "Repasse indevido",
          createdById: cashierUserId,
        });
      });

      const reversalAllocations = await prisma.tipPayoutReversalAllocation.findMany({
        where: { reversalId: reversal.id },
      });
      expect(reversalAllocations.length).toBeGreaterThan(0);
      expect(Number(reversalAllocations[0].amountRestored)).toBe(25.0);
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
            barbershopId: foreignBarbershop.id, // Mismatched tenant
            comandaId: comanda.id,
            tenders: [{ method: PaymentMethod.CASH, receivedAmount: 50.0 }],
            createdById: cashierUserId,
          });
        })
      ).rejects.toThrow("Comanda nao encontrada.");
    });
  });
});
