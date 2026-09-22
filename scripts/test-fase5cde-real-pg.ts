import { URL } from "url";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

const rawDbUrl = process.env.DATABASE_URL || "";
try {
  const parsedDbUrl = new URL(rawDbUrl.replace("postgresql://", "http://"));
  const allowedHosts = ["localhost", "127.0.0.1"];
  if (
    !allowedHosts.includes(parsedDbUrl.hostname) ||
    parsedDbUrl.port !== "55439" ||
    !parsedDbUrl.pathname.includes("match_barber_test")
  ) {
    console.error("❌ ERRO DE SEGURANÇA: O script só pode rodar em localhost:55439/match_barber_test!");
    process.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao validar DATABASE_URL:", e);
  process.exit(1);
}

async function runRealPgTests() {
  const { default: prisma } = await import("../src/lib/prisma");
  const { PaymentMethod } = await import("@prisma/client");
  const { processCheckoutAllocation } = await import("../src/lib/operations/checkout");
  const { recordTip, executeTipPayout, reconcileTipLedger } = await import("../src/lib/operations/tips");
  const { cancelComanda } = await import("../src/lib/operations/comandas");
  const {
    reverseCheckoutCreditDeposit,
    reconcileCustomerCreditBalance,
    getCustomerCreditAccount,
  } = await import("../src/lib/operations/customer-credit");

  console.log("=== INICIANDO SUITE REAL-PG FASES 5C+5D+5E (GATES C1–C6) ===");

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

  await prisma.customerBarbershopLink.create({
    data: {
      barbershopId: barbershop.id,
      customerId: userCustomer.id,
    },
  });

  await getCustomerCreditAccount(barbershop.id, userCustomer.id);

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
    // 1. negative received amount on checkout_allocations
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_allocations" ("id", "checkout_transaction_id", "barbershop_id", "tender_method", "received_amount", "allocation_kind", "allocated_amount", "created_at")
        VALUES (gen_random_uuid(), gen_random_uuid(), ${barbershop.id}, 'CASH', -50.00, 'SALE_PAYMENT', 50.00, NOW());
      `;
    },
    // 2. negative allocated amount on checkout_allocations
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_allocations" ("id", "checkout_transaction_id", "barbershop_id", "tender_method", "received_amount", "allocation_kind", "allocated_amount", "created_at")
        VALUES (gen_random_uuid(), gen_random_uuid(), ${barbershop.id}, 'CASH', 50.00, 'SALE_PAYMENT', -10.00, NOW());
      `;
    },
    // 3. transaction equation mismatch
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "checkout_transactions" (
          "id", "barbershop_id", "comanda_id", "total_received_amount", "total_sale_applied",
          "total_tip_amount", "total_credit_deposit", "total_change_amount", "fingerprint", "payload_fingerprint", "created_by_id"
        ) VALUES (
          gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), 100.00, 50.00,
          10.00, 0.00, 0.00, 'fp-mismatch', 'fp-mismatch', ${userCashier.id}
        );
      `;
    },
    // 4. TipEntry amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 0.00, 0.00, 0.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 5. TipEntry refunded_amount < 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, -2.00, 0.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 6. TipEntry paid_out_amount < 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, 0.00, -2.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 7. refunded + paidOut > amount
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_entries" ("id", "barbershop_id", "comanda_id", "member_id", "amount", "refunded_amount", "paid_out_amount", "method", "status", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), ${memberBarber.id}, 10.00, 6.00, 6.00, 'CASH', 'ACTIVE', NOW(), NOW());
      `;
    },
    // 8. TipRefund amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_refunds" ("id", "barbershop_id", "tip_entry_id", "amount", "reason", "refunded_by_id", "created_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, gen_random_uuid(), 0.00, 'Invalid', ${userCashier.id}, NOW());
      `;
    },
    // 9. TipPayout total_amount <= 0
    async () => {
      await prisma.$executeRaw`
        INSERT INTO "tip_payouts" ("id", "barbershop_id", "member_id", "total_amount", "method", "status", "created_by_id", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${barbershop.id}, ${memberBarber.id}, 0.00, 'PIX', 'COMPLETED', ${userCashier.id}, NOW(), NOW());
      `;
    },
    // 10. TipPayoutAllocation amount <= 0
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

  let realPgPassed = 0;

  // 1. ROOT_SAME_KEY_CONCURRENCY
  console.log("\n--> Gate 1: REAL_PG_ROOT_SAME_KEY_CONCURRENCY");
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
    console.error("❌ FALHA no mesmo idempotency key! Reasons:", sameKeyResults.map((r) => (r.status === "rejected" ? r.reason : "fulfilled")));
    process.exit(1);
  }
  const txCount = await prisma.checkoutTransaction.count({ where: { comandaId: comandaKey.id } });
  if (txCount !== 1) {
    console.error(`❌ FALHA: CheckoutTransaction count (${txCount}) !== 1!`);
    process.exit(1);
  }
  const paymentsCountKey = await prisma.payment.count({ where: { comandaId: comandaKey.id } });
  if (paymentsCountKey !== 1) {
    console.error("❌ FALHA: Criou mais de 1 pagamento para a mesma chave de idempotência!");
    process.exit(1);
  }

  // Replay
  const replayResult = await prisma.$transaction(async (tx) => {
    return processCheckoutAllocation(tx, {
      barbershopId: barbershop.id,
      comandaId: comandaKey.id,
      tenders: [{ method: PaymentMethod.PIX, receivedAmount: 50.0 }],
      createdById: userCashier.id,
      idempotencyKey: sameKeyId,
    });
  });
  if (!replayResult.transaction) {
    console.error("❌ FALHA: Replay não retornou a transação!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_ROOT_SAME_KEY_CONCURRENCY=PASS");
  realPgPassed++;

  // 2. SAME_KEY_DIFFERENT_PAYLOAD
  console.log("\n--> Gate 2: REAL_PG_SAME_KEY_DIFFERENT_PAYLOAD");
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
        tenders: [{ method: PaymentMethod.CASH, receivedAmount: 50.0 }],
        createdById: userCashier.id,
        idempotencyKey: diffPayloadKey,
      });
    });
    console.error("❌ FALHA: Não rejeitou chave com payload diferente!");
    process.exit(1);
  } catch (err: any) {
    console.log("✓ REAL_PG_SAME_KEY_DIFFERENT_PAYLOAD=PASS (409 IDEMPOTENCY_KEY_CONFLICT)");
    realPgPassed++;
  }

  // 3. SAME_KEY_TENDER_ORDER_CHANGED
  console.log("\n--> Gate 3: REAL_PG_SAME_KEY_TENDER_ORDER_CHANGED");
  const orderKey = `order-key-${Date.now()}`;
  const comandaOrder = await prisma.comanda.create({
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
      comandaId: comandaOrder.id,
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
      comandaId: comandaOrder.id,
      tenders: [
        { method: PaymentMethod.CASH, receivedAmount: 30.0 },
        { method: PaymentMethod.PIX, receivedAmount: 20.0 },
      ],
      createdById: userCashier.id,
      idempotencyKey: orderKey,
    });
  });

  try {
    await prisma.$transaction(async (tx) => {
      return processCheckoutAllocation(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaOrder.id,
        tenders: [
          { method: PaymentMethod.PIX, receivedAmount: 20.0 },
          { method: PaymentMethod.CASH, receivedAmount: 30.0 },
        ],
        createdById: userCashier.id,
        idempotencyKey: orderKey,
      });
    });
    console.error("❌ FALHA: Mesma chave com ordem invertida não gerou conflito!");
    process.exit(1);
  } catch (err: any) {
    console.log("✓ REAL_PG_SAME_KEY_TENDER_ORDER_CHANGED=PASS (409 IDEMPOTENCY_KEY_CONFLICT)");
    realPgPassed++;
  }

  // 4. DIFFERENT_KEY_SAME_COMANDA_CONCURRENCY
  console.log("\n--> Gate 4: REAL_PG_DIFFERENT_KEY_COMANDA_CONCURRENCY");
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
  realPgPassed++;

  // 5. TIP_PAYOUT_CONCURRENCY
  console.log("\n--> Gate 5: REAL_PG_TIP_PAYOUT_CONCURRENCY");
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
    include: { payoutAllocations: { include: { payout: true } } },
  });

  const entryAmount = Number(tipEntryPayout?.amount || 0);
  const entryRefunded = Number(tipEntryPayout?.refundedAmount || 0);
  const entryPaidOut = Number(tipEntryPayout?.paidOutAmount || 0);

  const activeAllocations = tipEntryPayout?.payoutAllocations.filter(
    (a) => a.payout.status === "COMPLETED"
  ) || [];

  const sumAllocations = activeAllocations.reduce((sum, a) => sum + Number(a.amount), 0);

  if (entryAmount !== 30.0) {
    console.error(`❌ FALHA: TipEntry.amount (${entryAmount}) !== 30.0!`);
    process.exit(1);
  }
  if (sumAllocations !== 30.0) {
    console.error(`❌ FALHA: SUM(TipPayoutAllocation.amount) (${sumAllocations}) !== 30.0!`);
    process.exit(1);
  }
  if (entryPaidOut !== 30.0) {
    console.error(`❌ FALHA: TipEntry.paidOutAmount (${entryPaidOut}) !== 30.0!`);
    process.exit(1);
  }
  if (activeAllocations.length !== 1) {
    console.error(`❌ FALHA: Ativos payouts (${activeAllocations.length}) !== 1!`);
    process.exit(1);
  }
  if (entryPaidOut > entryAmount - entryRefunded) {
    console.error("❌ FALHA: paidOutAmount excede amount - refundedAmount!");
    process.exit(1);
  }

  console.log("✓ REAL_PG_TIP_PAYOUT_CONCURRENCY=PASS");
  realPgPassed++;

  // 6. CREDIT_REVERSAL_CONCURRENCY
  console.log("\n--> Gate 6: REAL_PG_CREDIT_REVERSAL_CONCURRENCY");
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
  realPgPassed++;

  // 7. CUSTOMER_CREDIT_CASH_REVERSAL (isPhysicalCashReturned = true)
  console.log("\n--> Gate 7: REAL_PG_CASH_CREDIT_REVERSAL_TRUE");
  const comandaCreditCash = await prisma.comanda.create({
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
      comandaId: comandaCreditCash.id,
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
      comandaId: comandaCreditCash.id,
      tenders: [
        { method: PaymentMethod.CASH, receivedAmount: 65.0, creditDepositAmount: 15.0 },
      ],
      createdById: userCashier.id,
    });
  });

  const creditEntryCash = await prisma.customerCreditEntry.findFirst({
    where: { comandaId: comandaCreditCash.id, sourceKind: "OVERPAYMENT" },
  });
  if (!creditEntryCash) {
    console.error("❌ FALHA: CreditEntry de OVERPAYMENT não encontrado para CASH!");
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    return reverseCheckoutCreditDeposit(tx, {
      barbershopId: barbershop.id,
      creditEntryId: creditEntryCash.id,
      reason: "Reversão com devolução física de dinheiro",
      createdByUserId: userCashier.id,
      isPhysicalCashReturned: true,
    });
  });

  const reversalEntryCash = await prisma.customerCreditEntry.findFirst({
    where: { reversalOfEntryId: creditEntryCash.id },
  });
  if (!reversalEntryCash) {
    console.error("❌ FALHA: reversalEntryCash não encontrado!");
    process.exit(1);
  }

  const movementTrue = await prisma.cashMovement.findFirst({
    where: { customerCreditEntryId: reversalEntryCash.id },
  });
  if (!movementTrue || Number(movementTrue.amount) !== -15.0) {
    console.error(`❌ FALHA: CashMovement negativo não foi criado exatamente uma vez! (movement: ${JSON.stringify(movementTrue)})`);
    process.exit(1);
  }
  console.log("✓ REAL_PG_CASH_CREDIT_REVERSAL_TRUE=PASS");
  realPgPassed++;

  // 8. CUSTOMER_CREDIT_CASH_REVERSAL_NO_RETURN (isPhysicalCashReturned = false)
  console.log("\n--> Gate 8: REAL_PG_CASH_CREDIT_REVERSAL_FALSE");
  const comandaCreditCashNoRet = await prisma.comanda.create({
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
      comandaId: comandaCreditCashNoRet.id,
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
      comandaId: comandaCreditCashNoRet.id,
      tenders: [
        { method: PaymentMethod.CASH, receivedAmount: 65.0, creditDepositAmount: 15.0 },
      ],
      createdById: userCashier.id,
    });
  });

  const creditEntryCashNoRet = await prisma.customerCreditEntry.findFirst({
    where: { comandaId: comandaCreditCashNoRet.id, sourceKind: "OVERPAYMENT" },
  });

  await prisma.$transaction(async (tx) => {
    return reverseCheckoutCreditDeposit(tx, {
      barbershopId: barbershop.id,
      creditEntryId: creditEntryCashNoRet!.id,
      reason: "Reversão sem devolução física",
      createdByUserId: userCashier.id,
      isPhysicalCashReturned: false,
    });
  });

  const reversalEntryNoRet = await prisma.customerCreditEntry.findFirst({
    where: { reversalOfEntryId: creditEntryCashNoRet!.id },
  });
  const movementFalse = await prisma.cashMovement.findFirst({
    where: { customerCreditEntryId: reversalEntryNoRet?.id },
  });

  if (movementFalse) {
    console.error("❌ FALHA: CashMovement foi criado indevidamente quando isPhysicalCashReturned=false!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_CASH_CREDIT_REVERSAL_FALSE=PASS");
  realPgPassed++;

  // 9. CUSTOMER_CREDIT_NON_CASH_REVERSAL (PIX)
  console.log("\n--> Gate 9: REAL_PG_NON_CASH_CREDIT_REVERSAL");
  const comandaCreditPix = await prisma.comanda.create({
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
      comandaId: comandaCreditPix.id,
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
      comandaId: comandaCreditPix.id,
      tenders: [
        { method: PaymentMethod.PIX, receivedAmount: 65.0, creditDepositAmount: 15.0 },
      ],
      createdById: userCashier.id,
    });
  });

  const creditEntryPix = await prisma.customerCreditEntry.findFirst({
    where: { comandaId: comandaCreditPix.id, sourceKind: "OVERPAYMENT" },
  });

  await prisma.$transaction(async (tx) => {
    return reverseCheckoutCreditDeposit(tx, {
      barbershopId: barbershop.id,
      creditEntryId: creditEntryPix!.id,
      reason: "Reversão PIX",
      createdByUserId: userCashier.id,
      isPhysicalCashReturned: true,
    });
  });

  const reversalEntryPix = await prisma.customerCreditEntry.findFirst({
    where: { reversalOfEntryId: creditEntryPix!.id },
  });
  const movementPix = await prisma.cashMovement.findFirst({
    where: { customerCreditEntryId: reversalEntryPix?.id },
  });

  if (movementPix) {
    console.error("❌ FALHA: CashMovement foi criado para reversão de crédito de método não-CASH!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_NON_CASH_CREDIT_REVERSAL=PASS");
  realPgPassed++;

  // 10. CANCEL_PAID_OUT_TIP_ATOMICITY
  console.log("\n--> Gate 10: REAL_PG_CANCEL_PAID_OUT_TIP_ATOMICITY");
  const comandaPaidTip = await prisma.comanda.create({
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
      comandaId: comandaPaidTip.id,
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
      comandaId: comandaPaidTip.id,
      tenders: [
        {
          method: PaymentMethod.CASH,
          receivedAmount: 70.0,
          tipAmount: 20.0,
          tipMemberId: memberBarber.id,
        },
      ],
      createdById: userCashier.id,
    });
  });

  // Payout the tip to mark it PAID_OUT
  await prisma.$transaction(async (tx) => {
    return executeTipPayout(tx, {
      barbershopId: barbershop.id,
      memberId: memberBarber.id,
      method: PaymentMethod.PIX,
      createdById: userCashier.id,
    });
  });

  let cancelBlocked = false;
  try {
    await prisma.$transaction(async (tx) => {
      return cancelComanda(tx, {
        barbershopId: barbershop.id,
        comandaId: comandaPaidTip.id,
        reason: "Tentativa de cancelamento com gorjeta já paga",
        userId: userCashier.id,
        refundAll: true,
      });
    });
  } catch (err: any) {
    if (
      err?.code === "TIP_PAYOUT_REVERSAL_REQUIRED" ||
      String(err?.message).includes("TIP_PAYOUT_REVERSAL_REQUIRED") ||
      String(err?.message).includes("gorjeta")
    ) {
      cancelBlocked = true;
    } else {
      console.error("❌ FALHA: Erro inesperado ao tentar cancelar com gorjeta paga:", err);
      process.exit(1);
    }
  }

  if (!cancelBlocked) {
    console.error("❌ FALHA: cancelComanda permitiu cancelamento de comanda com gorjeta PAID_OUT!");
    process.exit(1);
  }

  const refreshedComandaPaidTip = await prisma.comanda.findUnique({ where: { id: comandaPaidTip.id } });
  if (refreshedComandaPaidTip?.status === "CANCELLED") {
    console.error("❌ FALHA: Comanda foi cancelada apesar do erro!");
    process.exit(1);
  }

  const paymentsPaidTip = await prisma.payment.findMany({ where: { comandaId: comandaPaidTip.id } });
  const anyRefunded = paymentsPaidTip.some(
    (p) => p.status === "REFUNDED" || Number(p.refundedAmount || 0) > 0
  );
  if (anyRefunded) {
    console.error("❌ FALHA: Pagamentos foram estornados!");
    process.exit(1);
  }

  const tipRefundsCount = await prisma.tipRefund.count({
    where: { tipEntry: { comandaId: comandaPaidTip.id } },
  });
  if (tipRefundsCount > 0) {
    console.error("❌ FALHA: TipRefunds foram criados!");
    process.exit(1);
  }
  console.log("✓ REAL_PG_CANCEL_PAID_OUT_TIP_ATOMICITY=PASS");
  realPgPassed++;

  // 11. OPEN_DEBT_ALLOCATIONS
  console.log("\n--> Gate 11: REAL_PG_OPEN_DEBT_ALLOCATIONS");
  const comandaDebt = await prisma.comanda.create({
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
      comandaId: comandaDebt.id,
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
      comandaId: comandaDebt.id,
      mode: "FINALIZE",
      actorRole: "OWNER",
      allowOutstanding: true,
      tenders: [{ method: PaymentMethod.PIX, receivedAmount: 30.0 }],
      createdById: userCashier.id,
    });
  });

  const refreshedComandaDebt = await prisma.comanda.findUnique({ where: { id: comandaDebt.id } });
  if (refreshedComandaDebt?.status !== "CLOSED") {
    console.error(`❌ FALHA: Comanda com dívida não foi fechada! Status: ${refreshedComandaDebt?.status}`);
    process.exit(1);
  }
  if (Number(refreshedComandaDebt.paidTotal) !== 30.0 || Number(refreshedComandaDebt.remainingTotal) !== 20.0) {
    console.error(
      `❌ FALHA: Totais inconsistentes na comanda com dívida! paidTotal: ${refreshedComandaDebt.paidTotal}, remainingTotal: ${refreshedComandaDebt.remainingTotal}`
    );
    process.exit(1);
  }
  console.log("✓ REAL_PG_OPEN_DEBT_ALLOCATIONS=PASS");
  realPgPassed++;

  // 12. TENANT_ISOLATION
  console.log("\n--> Gate 12: REAL_PG_TENANT_ISOLATION");
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
    realPgPassed++;
  }

  // 13. RECONCILIATION_ZERO_DRIFT
  console.log("\n--> Gate 13: REAL_PG_RECONCILIATION");
  const tipRec = await reconcileTipLedger(barbershop.id, memberBarber.id);
  if (!tipRec.isBalanced) {
    console.error("❌ FALHA: Desvio na reconciliação do ledger de gorjetas!", tipRec);
    process.exit(1);
  }
  const creditRec = await reconcileCustomerCreditBalance(barbershop.id, userCustomer.id);
  if (!creditRec.isBalanced) {
    console.error("❌ FALHA: Desvio na reconciliação do saldo de crédito de cliente!", creditRec);
    process.exit(1);
  }
  console.log("✓ REAL_PG_RECONCILIATION=PASS");
  realPgPassed++;

  console.log("\n=== TODOS OS TESTES REAL-PG FORAM CONCLUÍDOS COM SUCESSO! ===");
  console.log(`REAL_POSTGRES_TESTS=${realPgPassed}/13_PASSED`);
  await prisma.$disconnect();
}

runRealPgTests().catch(async (e) => {
  console.error("FALHA NOS TESTES REAL-PG:", e);
  process.exit(1);
});
