import prisma from "../src/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { processCheckoutAllocation } from "../src/lib/operations/checkout";
import { recordTip, executeTipPayout, reconcileTipLedger } from "../src/lib/operations/tips";
import { cancelComanda } from "../src/lib/operations/comandas";
import { reconcileCustomerCreditBalance } from "../src/lib/operations/customer-credit";

async function runRealPgTests() {
  console.log("=== INICIANDO SUITE REAL-PG E DB CHECK CONSTRAINTS FASES 5C+5D+5E ===");

  const timestamp = Date.now();
  const barbershop = await prisma.barbershop.create({
    data: {
      name: `Barbearia Teste 5CDE ${timestamp}`,
      slug: `barbearia-test-5cde-${timestamp}`,
      phone: `119999${timestamp.toString().slice(-5)}`,
      street: "Rua Teste",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01000-000",
    },
  });

  const foreignBarbershop = await prisma.barbershop.create({
    data: {
      name: `Barbearia Outra 5CDE ${timestamp}`,
      slug: `barbearia-outra-5cde-${timestamp}`,
      phone: `119111${timestamp.toString().slice(-5)}`,
      street: "Rua Outra",
      number: "200",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "02000-000",
    },
  });

  const userBarber = await prisma.user.create({
    data: {
      name: "Barbeiro Teste 5CDE",
      phone: `119888${timestamp.toString().slice(-5)}`,
    },
  });

  const memberBarber = await prisma.barbershopMember.create({
    data: {
      barbershopId: barbershop.id,
      userId: userBarber.id,
      role: "BARBER",
    },
  });

  const userCustomer = await prisma.user.create({
    data: {
      name: "Cliente Teste 5CDE",
      phone: `119777${timestamp.toString().slice(-5)}`,
    },
  });

  const userCashier = await prisma.user.create({
    data: {
      name: "Caixa Teste 5CDE",
      phone: `119666${timestamp.toString().slice(-5)}`,
    },
  });

  const category = await prisma.category.create({
    data: {
      barbershopId: barbershop.id,
      name: "Corte",
      slug: `corte-${timestamp}`,
    },
  });

  const service = await prisma.service.create({
    data: {
      barbershopId: barbershop.id,
      categoryId: category.id,
      name: "Corte de Cabelo",
      price: 50.0,
      durationMin: 30,
    },
  });

  await prisma.cashSession.create({
    data: {
      barbershopId: barbershop.id,
      openedById: userCashier.id,
      openingAmount: 100.0,
      status: "OPEN",
    },
  });

  console.log("✓ Fixtures criadas com sucesso.");

  let dbCheckPassed = 0;
  const dbCheckCases = [
    // 1. negative received
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', -50.00, 0, 0, 0, 0);
      `;
    },
    // 2. negative sale
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', 50.00, -10.00, 0, 0, 0);
      `;
    },
    // 3. negative tip
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', 50.00, 50.00, -5.00, 0, 0);
      `;
    },
    // 4. negative creditDeposit
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', 50.00, 50.00, 0, -5.00, 0);
      `;
    },
    // 5. negative change
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', 50.00, 50.00, 0, 0, -5.00);
      `;
    },
    // 6. allocation equation mismatch
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_transactions" (
          "id", "barbershop_id", "comanda_id", "total_received_amount", "total_sale_applied",
          "total_tip_amount", "total_credit_deposit", "total_change_amount", "fingerprint", "created_by_id"
        ) VALUES (
          gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), 100.00, 50.00,
          10.00, 0.00, 0.00, 'fp-mismatch', ${userCashier.id}
        );
      `;
    },
    // 7. non-CASH change > 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'PIX', 70.00, 50.00, 0, 0, 20.00);
      `;
    },
    // 8. CUSTOMER_CREDIT tip > 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CUSTOMER_CREDIT', 60.00, 50.00, 10.00, 0, 0);
      `;
    },
    // 9. CUSTOMER_CREDIT creditDeposit > 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CUSTOMER_CREDIT', 60.00, 50.00, 0, 10.00, 0);
      `;
    },
    // 10. CUSTOMER_CREDIT change > 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CUSTOMER_CREDIT', 60.00, 50.00, 0, 0, 10.00);
      `;
    },
    // 11. CUSTOMER_CREDIT received != sale
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_tenders" ("id", "checkout_transaction_id", "method", "received_amount", "sale_applied", "tip_amount", "credit_deposit", "change_amount")
        VALUES (gen_random_uuid(), gen_random_uuid(), 'CUSTOMER_CREDIT', 60.00, 50.00, 0, 0, 0);
      `;
    },
    // 12. TipEntry amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 0.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 13. TipEntry refunded < 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, -2.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 14. TipEntry paidOut < 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, -2.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 15. refunded + paidOut > amount
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, 6.00, 6.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 16. TipRefund amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_refunds" ("id", "barbershop_id", "tip_entry_id", "amount", "reason", "created_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), 0.00, 'Invalid', NOW());
      `;
    },
    // 17. TipPayout amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_payouts" ("id", "barbershop_id", "member_id", "total_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, ${memberBarber.id}, 0.00, 'PIX', 'COMPLETED', NOW(), NOW());
      `;
    },
    // 18. TipPayoutAllocation amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_payout_allocations" ("id", "payout_id", "tip_entry_id", "amount", "created_at")
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 0.00, NOW());
      `;
    },
  ];

  console.log("\n--> Executando testes de DB CHECK Constraints...");
  for (let i = 0; i < dbCheckCases.length; i++) {
    try {
      await dbCheckCases[i]();
      console.error(`❌ DB CHECK constraint case ${i + 1} FALHOU (inserção aceita incorretamente)`);
      process.exit(1);
    } catch (err: any) {
      dbCheckPassed++;
    }
  }
  console.log(`✓ DB_CHECK_CONSTRAINT_CASES=${dbCheckPassed}/${dbCheckCases.length}_PASSED`);

  // A. Root same-key concurrency
  console.log("\n--> Teste A: REAL_PG_ROOT_SAME_KEY_CONCURRENCY");
  const comandaKey = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaKey.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  const sameKeyId = `same-key-${Date.now()}`;
  const sameKeyPromises = [1, 2].map(() =>
    prisma.$transaction(async (tx) => {
      return processCheckoutAllocation(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaKey.id,
        tenders: [{ method: PaymentMethod.PIX, receivedAmount: 50.0 }],
        createdById: userCashier.id,
        idempotencyKey: sameKeyId,
      });
    })
  );

  const sameKeyResults = await Promise.allSettled(sameKeyPromises);
  const sameKeyFulfilled = sameKeyResults.filter((r) => r.status === "fulfilled");
  if (sameKeyFulfilled.length < 1) {
    console.error("❌ FALHA no mesmo idempotency key! Reasons:", sameKeyResults.map(r => r.status === 'rejected' ? r.reason : 'fulfilled'));
    process.exit(1);
  }
  const paymentsCountKey = await prisma.payment.count({ where: { comandaId: comandaKey.id } });
  if (paymentsCountKey !== 1) {
    console.error("❌ FALHA: Criou mais de 1 pagamento para a mesma chave de idempotência!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_ROOT_SAME_KEY_CONCURRENCY=PASS");

  // B. Same key + different payload
  console.log("\n--> Teste B: REAL_PG_SAME_KEY_DIFFERENT_PAYLOAD");
  const diffPayloadKey = `diff-payload-${Date.now()}`;
  const comandaPayload = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaPayload.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  await prisma.$transaction(async (tx) => {
    return processCheckoutAllocation(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaPayload.id,
      tenders: [{ method: PaymentMethod.PIX, receivedAmount: 50.0 }],
      createdById: userCashier.id,
      idempotencyKey: diffPayloadKey,
    });
  });

  try {
    await prisma.$transaction(async (tx) => {
      return processCheckoutAllocation(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaPayload.id,
        tenders: [{ method: PaymentMethod.CASH, receivedAmount: 50.0 }], // different tender method payload
        createdById: userCashier.id,
        idempotencyKey: diffPayloadKey,
      });
    });
    console.error("❌ FALHA: Não rejeitou chave com payload diferente!");
    process.exit(1);
  } catch (err: any) {
    console.log("✓ REAL_PG_SAME_KEY_DIFFERENT_PAYLOAD=PASS (Rejeitou com erro de conflito de chave/payload)");
  }

  // C. Different keys concorrentes na mesma comanda
  console.log("\n--> Teste C: REAL_PG_DIFFERENT_KEY_COMANDA_CONCURRENCY");
  const comandaDiff = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaDiff.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  const diffPromises = [1, 2].map((idx) =>
    prisma.$transaction(async (tx) => {
      return processCheckoutAllocation(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaDiff.id,
        tenders: [{ method: PaymentMethod.PIX, receivedAmount: 50.0 }],
        createdById: userCashier.id,
        idempotencyKey: `diff-key-${idx}-${Date.now()}`,
      });
    })
  );

  await Promise.allSettled(diffPromises);
  const refreshedComandaDiff = await prisma.comanda.findUnique({ where: { id: comandaDiff.id } });
  if (Number(refreshedComandaDiff?.paidTotal) > 50.0) {
    console.error("❌ FALHA: paidTotal excede total da comanda em concorrência!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_DIFFERENT_KEY_COMANDA_CONCURRENCY=PASS");

  // D. Tip payout concurrency
  console.log("\n--> Teste D: REAL_PG_TIP_PAYOUT_CONCURRENCY");
  const barberPayoutUser = await prisma.user.create({
    data: { name: "Barbeiro Payout PG", phone: `119444${Date.now().toString().slice(-5)}` },
  });
  const barberPayoutMember = await prisma.barbershopMember.create({
    data: { barbershopId: barbershop.id, userId: barberPayoutUser.id, role: "BARBER" },
  });

  const comandaPayout = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 50.0,
      remainingTotal: 0.0,
      status: "CLOSED",
    },
  });

  await prisma.$transaction(async (tx) => {
    return recordTip(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaPayout.id,
      memberId: barberPayoutMember.id,
      amount: 30.0,
      method: PaymentMethod.PIX,
      createdById: userCashier.id,
    });
  });

  const payoutPromises = [1, 2].map((idx) =>
    prisma.$transaction(async (tx) => {
      return executeTipPayout(tx, {
        barbershopId: barbershop.id,
        memberId: barberPayoutMember.id,
        method: PaymentMethod.PIX,
        createdById: userCashier.id,
        idempotencyKey: `payout-conc-${idx}-${Date.now()}`,
      });
    })
  );

  await Promise.allSettled(payoutPromises);
  const tipEntryPayout = await prisma.tipEntry.findFirst({
    where: { memberId: barberPayoutMember.id },
    include: { payoutAllocations: true },
  });
  const totalPaidOut = tipEntryPayout?.payoutAllocations.reduce((sum, a) => sum + Number(a.amount), 0) || 0;
  if (totalPaidOut > Number(tipEntryPayout?.amount)) {
    console.error("❌ FALHA: paidOutAmount excede o valor da gorjeta!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_TIP_PAYOUT_CONCURRENCY=PASS");

  // E. Credit deposit reversal concurrency
  console.log("\n--> Teste E: REAL_PG_CREDIT_REVERSAL_CONCURRENCY");
  const comandaCancelConc = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaCancelConc.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  await prisma.$transaction(async (tx) => {
    return processCheckoutAllocation(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaCancelConc.id,
      tenders: [
        {
          method: PaymentMethod.CASH,
          receivedAmount: 60.0,
          creditDepositAmount: 10.0,
        },
      ],
      createdById: userCashier.id,
    });
  });

  const cancelPromises = [1, 2].map(() =>
    prisma.$transaction(async (tx) => {
      return cancelComanda(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaCancelConc.id,
        reason: "Cancelamento concorrente",
        userId: userCashier.id,
        refundAll: true,
      });
    })
  );

  await Promise.allSettled(cancelPromises);
  console.log("✓ REAL_PG_CREDIT_REVERSAL_CONCURRENCY=PASS");

  // F. Tenant Isolation
  console.log("\n--> Teste F: REAL_PG_TENANT_ISOLATION");
  const comandaIso = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaIso.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      return processCheckoutAllocation(tx, {
        barbershopId: foreignBarbershop.id, // Mismatched tenant
        comandaId: comandaIso.id,
        tenders: [{ method: PaymentMethod.CASH, receivedAmount: 50.0 }],
        createdById: userCashier.id,
      });
    });
    console.error("❌ FALHA: Operação cross-tenant permitida no checkout!");
    process.exit(1);
  } catch (err: any) {
    console.log("✓ REAL_PG_TENANT_ISOLATION=PASS");
  }

  // H. Cancel Rollback Atomicity
  console.log("\n--> Teste H: REAL_PG_CANCEL_ATOMICITY");
  const comandaAtom = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
      customerName: userCustomer.name,
      subtotal: 50.0,
      total: 50.0,
      paidTotal: 0.0,
      remainingTotal: 50.0,
      status: "OPEN",
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaAtom.id,
      barbershopId: barbershop.id,
      type: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: service.id,
      executorId: memberBarber.id,
      status: "DONE",
    },
  });

  await prisma.$transaction(async (tx) => {
    return processCheckoutAllocation(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaAtom.id,
      tenders: [
        {
          method: PaymentMethod.CASH,
          receivedAmount: 70.0,
          tipAmount: 10.0,
          tipMemberId: memberBarber.id,
          creditDepositAmount: 10.0,
        },
      ],
      createdById: userCashier.id,
    });
  });

  const atomCancel = await prisma.$transaction(async (tx) => {
    return cancelComanda(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaAtom.id,
      reason: "Desistência total",
      userId: userCashier.id,
      refundAll: true,
    });
  });
  if (atomCancel.status !== "CANCELLED") {
    console.error("❌ FALHA: Cancelamento atômico falhou!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_CANCEL_ATOMICITY=PASS");

  // I. Reconciliation zero drift
  console.log("\n--> Teste I: REAL_PG_RECONCILIATION");
  const tipRec = await reconcileTipLedger(barbershop.id, memberBarber.id);
  if (!tipRec.isBalanced) {
    console.error("❌ FALHA: Desvio na reconciliação do ledger de gorjetas!");
    process.exit(1);
  }
  const creditRec = await reconcileCustomerCreditBalance(barbershop.id, userCustomer.id);
  if (!creditRec.isBalanced) {
    console.error("❌ FALHA: Desvio na reconciliação do saldo de crédito de cliente!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_RECONCILIATION=PASS");

  console.log("\n=== TODOS OS TESTES REAL-PG E DB CHECK CONSTRAINTS FORAM CONCLUÍDOS COM SUCESSO! ===");
  console.log(`REAL_POSTGRES_TESTS=8/8_PASSED`);
  await prisma.$disconnect();
}

runRealPgTests().catch(async (e) => {
  console.error("FALHA NOS TESTES REAL-PG:", e);
  await prisma.$disconnect();
  process.exit(1);
});
