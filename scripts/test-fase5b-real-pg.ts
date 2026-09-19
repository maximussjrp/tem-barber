/* eslint-disable @typescript-eslint/no-explicit-any */
export function validateTestDatabaseUrl(rawUrl: string): { isValid: boolean; reason?: string } {
  if (!rawUrl) {
    return { isValid: false, reason: "URL vazia ou não informada." };
  }

  const lower = rawUrl.toLowerCase();
  if (lower.includes("prod") || lower.includes("production") || lower.includes("app.tembarber.com.br")) {
    return { isValid: false, reason: "URL contém termo de produção (prod, production, ou app.tembarber.com.br)." };
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname;
    const port = parsed.port;
    const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];

    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return { isValid: false, reason: `Hostname '${hostname}' não é localhost nem 127.0.0.1.` };
    }

    if (port !== "55439") {
      return { isValid: false, reason: `Porta '${port}' não é a porta de teste 55439.` };
    }

    if (dbName !== "match_barber_test") {
      return { isValid: false, reason: `Banco de dados '${dbName}' não é match_barber_test.` };
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, reason: `Falha ao fazer parse da URL: ${err?.message || err}` };
  }
}

export function assertTestDatabaseOrThrow(url: string = process.env.DATABASE_URL || ""): void {
  const result = validateTestDatabaseUrl(url);
  if (!result.isValid) {
    throw new Error(`[GUARD] ABORTADO: A URL '${url}' não é um banco de teste local seguro! Motivo: ${result.reason}`);
  }
}

export function runUrlValidationSelfTests(): void {
  console.log("--- RUNNING URL VALIDATION SELF-TESTS ---");
  const validLocalhost = "postgresql://user:pass@localhost:55439/match_barber_test?schema=public";
  const valid127 = "postgresql://user:pass@127.0.0.1:55439/match_barber_test?schema=public";
  const invalidDb = "postgresql://user:pass@localhost:55439/other_db?schema=public";
  const invalidPort = "postgresql://user:pass@localhost:5432/match_barber_test?schema=public";
  const invalidHost = "postgresql://user:pass@remotehost:55439/match_barber_test?schema=public";
  const invalidProd = "postgresql://user:pass@app.tembarber.com.br:55439/match_barber_test?schema=public";
  const invalidProdWord = "postgresql://user:pass@localhost:55439/match_barber_test_prod?schema=public";

  if (!validateTestDatabaseUrl(validLocalhost).isValid) throw new Error("Self-test failed: validLocalhost should be accepted");
  if (!validateTestDatabaseUrl(valid127).isValid) throw new Error("Self-test failed: valid127 should be accepted");
  if (validateTestDatabaseUrl(invalidDb).isValid) throw new Error("Self-test failed: invalidDb should be accepted");
  if (validateTestDatabaseUrl(invalidPort).isValid) throw new Error("Self-test failed: invalidPort should be accepted");
  if (validateTestDatabaseUrl(invalidHost).isValid) throw new Error("Self-test failed: invalidHost should be accepted");
  if (validateTestDatabaseUrl(invalidProd).isValid) throw new Error("Self-test failed: invalidProd should be accepted");
  if (validateTestDatabaseUrl(invalidProdWord).isValid) throw new Error("Self-test failed: invalidProdWord should be accepted");

  console.log("URL VALIDATION SELF-TESTS PASSED SUCCESSFULLY.");
}

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

async function main() {
  console.log("=========================================");
  console.log("FASE 5B - REAL POSTGRESQL CONCURRENCY SUITE");
  console.log("=========================================");

  // 1. Run self-tests for safety guards
  runUrlValidationSelfTests();

  // 2. Obtain & validate test database URL before loading Prisma
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  assertTestDatabaseOrThrow(testDatabaseUrl);
  process.env.DATABASE_URL = testDatabaseUrl;

  // 3. Dynamically import Prisma & operations after setting validated DATABASE_URL
  const { default: prisma } = await import("../src/lib/prisma");
  const {
    getCustomerCreditAccount,
    grantCustomerCredit,
    adjustCustomerCredit,
    consumeCustomerCredit,
    reconcileCustomerCreditBalance,
  } = await import("../src/lib/operations/customer-credit");
  const { payComandaWithCustomerCredit } = await import("../src/lib/operations/payments");

  async function setupFixtures() {
    assertTestDatabaseOrThrow(process.env.DATABASE_URL);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "customer_credit_entries",
        "customer_credit_accounts",
        "customer_barbershop_links",
        "command_payments",
        "financial_entries",
        "comanda_items",
        "comandas",
        "barbershops",
        "users"
      CASCADE;
    `);

    const barbershop = await prisma.barbershop.create({
      data: {
        id: "shop-5b-test",
        name: "Barbearia Real PG Test 5B",
        slug: "shop-5b-real-pg",
        phone: "11988888888",
        street: "Rua Teste",
        number: "123",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        zipCode: "01000-000",
      },
    });

    const barbershop2 = await prisma.barbershop.create({
      data: {
        id: "shop-5b-test-2",
        name: "Barbearia Real PG Test 5B Two",
        slug: "shop-5b-real-pg-2",
        phone: "11977777777",
        street: "Rua Outra",
        number: "456",
        neighborhood: "Bairro",
        city: "São Paulo",
        state: "SP",
        zipCode: "02000-000",
      },
    });

    const userOwner = await prisma.user.create({
      data: {
        id: "user-owner-5b",
        name: "Dono Teste 5B",
        phone: "11977777777",
        email: "owner5b@test.com",
      },
    });

    const customerUser = await prisma.user.create({
      data: {
        id: "user-cust-5b",
        name: "Cliente Concorrência 5B",
        phone: "11966666666",
        email: "cust5b@test.com",
      },
    });

    await prisma.customerBarbershopLink.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
      },
    });

    await prisma.customerBarbershopLink.create({
      data: {
        barbershopId: barbershop2.id,
        customerId: customerUser.id,
      },
    });

    return { barbershop, barbershop2, userOwner, customerUser };
  }

  // TEST 1: Pessimistic locking under concurrent debit requests
  console.log("\n[TEST 1] Real Postgres Pessimistic Locking (FOR UPDATE)...");
  const { barbershop, barbershop2, userOwner, customerUser } = await setupFixtures();

  // Initial grant of R$ 40.00 credit
  await prisma.$transaction(async (tx) => {
    await grantCustomerCredit(tx, {
      barbershopId: barbershop.id,
      customerId: customerUser.id,
      amount: "40.00",
      description: "Crédito inicial para teste de concorrência",
      createdByUserId: userOwner.id,
    });
  });

  const accountAfterGrant = await getCustomerCreditAccount(barbershop.id, customerUser.id);
  console.log(`Initial balance: R$ ${accountAfterGrant.balance}`);
  if (Number(accountAfterGrant.balance) !== 40) {
    throw new Error(`Expected initial balance 40, got ${accountAfterGrant.balance}`);
  }

  // Create two comandas for customer
  const cmdA = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: customerUser.id,
      customerName: customerUser.name,
      subtotal: 30,
      total: 30,
      remainingTotal: 30,
      items: {
        create: {
          barbershopId: barbershop.id,
          type: "SERVICE",
          description: "Serviço A",
          quantity: 1,
          unitPrice: 30,
          total: 30,
          status: "DONE",
        },
      },
    },
  });

  const cmdB = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: customerUser.id,
      customerName: customerUser.name,
      subtotal: 30,
      total: 30,
      remainingTotal: 30,
      items: {
        create: {
          barbershopId: barbershop.id,
          type: "SERVICE",
          description: "Serviço B",
          quantity: 1,
          unitPrice: 30,
          total: 30,
          status: "DONE",
        },
      },
    },
  });

  // Launch Req A (R$ 30.00) and Req B (R$ 30.00) simultaneously
  console.log("Launching simultaneous concurrent debit requests (Req A: R$ 30, Req B: R$ 30)...");
  const results = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      return payComandaWithCustomerCredit(tx, {
        barbershopId: barbershop.id,
        comandaId: cmdA.id,
        amount: "30.00",
        userId: userOwner.id,
      });
    }),
    prisma.$transaction(async (tx) => {
      return payComandaWithCustomerCredit(tx, {
        barbershopId: barbershop.id,
        comandaId: cmdB.id,
        amount: "30.00",
        userId: userOwner.id,
      });
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  console.log(`Fulfilled requests: ${fulfilled.length}`);
  console.log(`Rejected requests: ${rejected.length}`);

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Expected exactly 1 fulfilled and 1 rejected request, got ${fulfilled.length} fulfilled, ${rejected.length} rejected`);
  }

  const rejError: any = (rejected[0] as PromiseRejectedResult).reason;
  console.log(`Rejection error code: ${rejError?.code || rejError?.message}`);
  if (!rejError?.message?.includes("INSUFFICIENT_CREDIT_BALANCE") && rejError?.code !== "INSUFFICIENT_CREDIT_BALANCE") {
    throw new Error(`Expected INSUFFICIENT_CREDIT_BALANCE error, got: ${rejError?.message || rejError}`);
  }

  const finalAccount = await getCustomerCreditAccount(barbershop.id, customerUser.id);
  console.log(`Final credit account balance: R$ ${finalAccount.balance}`);
  if (Number(finalAccount.balance) !== 10) {
    throw new Error(`Expected final balance 10.00, got ${finalAccount.balance}`);
  }
  console.log("[PASS] Test 1: Pessimistic locking prevented negative balance.");

  // TEST 2: Concurrent Idempotency Replay
  console.log("\n[TEST 2] Concurrent Idempotency Key Replay...");
  const cmdC = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: customerUser.id,
      customerName: customerUser.name,
      subtotal: 10,
      total: 10,
      remainingTotal: 10,
      items: {
        create: {
          barbershopId: barbershop.id,
          type: "SERVICE",
          description: "Serviço C",
          quantity: 1,
          unitPrice: 10,
          total: 10,
          status: "DONE",
        },
      },
    },
  });

  const idemKey = `idem-pg-5b-${Date.now()}`;
  const idemResults = await Promise.all([
    prisma.$transaction(async (tx) => {
      return consumeCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        amount: "10.00",
        comandaId: cmdC.id,
        paymentId: "pay-fake-1",
        createdByUserId: userOwner.id,
        idempotencyKey: idemKey,
      });
    }),
    prisma.$transaction(async (tx) => {
      return consumeCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        amount: "10.00",
        comandaId: cmdC.id,
        paymentId: "pay-fake-1",
        createdByUserId: userOwner.id,
        idempotencyKey: idemKey,
      });
    }),
  ]);

  if (idemResults[0]?.id !== idemResults[1]?.id) {
    throw new Error("Concurrent idempotency replay did not return identical account result!");
  }

  const accountAfterIdem = await getCustomerCreditAccount(barbershop.id, customerUser.id);
  console.log(`Balance after idempotency test: R$ ${accountAfterIdem.balance}`);
  if (Number(accountAfterIdem.balance) !== 0) {
    throw new Error(`Expected balance 0.00 after idempotency test, got ${accountAfterIdem.balance}`);
  }
  console.log("[PASS] Test 2: Concurrent idempotency key replay handled cleanly.");

  // TEST 3: Same key conflict (different payload)
  console.log("\n[TEST 3] Idempotency Key Conflict (Same key, different payload)...");
  const conflictKey = `idem-conflict-${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await grantCustomerCredit(tx, {
      barbershopId: barbershop.id,
      customerId: customerUser.id,
      amount: "50.00",
      description: "Grant for conflict test",
      createdByUserId: userOwner.id,
      idempotencyKey: conflictKey,
    });
  });

  let conflictCaught = false;
  try {
    await prisma.$transaction(async (tx) => {
      await grantCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        amount: "100.00", // Different amount!
        description: "Grant for conflict test",
        createdByUserId: userOwner.id,
        idempotencyKey: conflictKey,
      });
    });
  } catch (err: any) {
    if (err?.code === "IDEMPOTENCY_KEY_CONFLICT" || err?.message?.includes("IDEMPOTENCY_KEY_CONFLICT")) {
      conflictCaught = true;
    }
  }

  if (!conflictCaught) {
    throw new Error("Expected IDEMPOTENCY_KEY_CONFLICT error when reusing key with different amount!");
  }
  console.log("[PASS] Test 3: Idempotency key conflict detected correctly.");

  // TEST 4: Different keys concurrency
  console.log("\n[TEST 4] Concurrency with Different Idempotency Keys...");
  const keyA = `diff-key-A-${Date.now()}`;
  const keyB = `diff-key-B-${Date.now()}`;

  // Current balance after Test 3 grant is R$ 50.00. Requesting R$ 30.00 twice (total R$ 60.00).
  const diffResults = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      return consumeCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        amount: "30.00",
        comandaId: cmdC.id,
        paymentId: "pay-fake-diff-A",
        createdByUserId: userOwner.id,
        idempotencyKey: keyA,
      });
    }),
    prisma.$transaction(async (tx) => {
      return consumeCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        amount: "30.00",
        comandaId: cmdC.id,
        paymentId: "pay-fake-diff-B",
        createdByUserId: userOwner.id,
        idempotencyKey: keyB,
      });
    }),
  ]);

  const diffFulfilled = diffResults.filter((r) => r.status === "fulfilled");
  const diffRejected = diffResults.filter((r) => r.status === "rejected");

  if (diffFulfilled.length !== 1 || diffRejected.length !== 1) {
    throw new Error(`Expected 1 fulfilled and 1 rejected for different keys when balance insufficient, got ${diffFulfilled.length} fulfilled, ${diffRejected.length} rejected`);
  }
  console.log("[PASS] Test 4: Different keys concurrency locked and evaluated correctly.");

  // TEST 5: Tenant Isolation
  console.log("\n[TEST 5] Tenant Isolation (Shop A vs Shop B)...");
  await prisma.$transaction(async (tx) => {
    await grantCustomerCredit(tx, {
      barbershopId: barbershop2.id,
      customerId: customerUser.id,
      amount: "100.00",
      description: "Crédito na Barbearia 2",
      createdByUserId: userOwner.id,
    });
  });

  const accountShop1 = await getCustomerCreditAccount(barbershop.id, customerUser.id);
  const accountShop2 = await getCustomerCreditAccount(barbershop2.id, customerUser.id);

  console.log(`Shop 1 Balance: R$ ${accountShop1.balance} | Shop 2 Balance: R$ ${accountShop2.balance}`);
  if (Number(accountShop1.balance) === Number(accountShop2.balance)) {
    throw new Error("Tenant isolation failure: Shop 1 and Shop 2 shares balance!");
  }
  if (Number(accountShop2.balance) !== 100) {
    throw new Error(`Expected Shop 2 balance 100.00, got ${accountShop2.balance}`);
  }
  console.log("[PASS] Test 5: Tenant isolation confirmed.");

  // TEST 6: First-account creation concurrency
  console.log("\n[TEST 6] First-account Creation Concurrency...");
  const newCustomer = await prisma.user.create({
    data: {
      id: "user-new-5b",
      name: "Cliente Novo Concorrente",
      phone: "11955555555",
      email: "new5b@test.com",
    },
  });

  const createAccResults = await Promise.all([
    getCustomerCreditAccount(barbershop.id, newCustomer.id),
    getCustomerCreditAccount(barbershop.id, newCustomer.id),
  ]);

  if (createAccResults[0].id !== createAccResults[1].id) {
    throw new Error("First-account creation concurrency created duplicate accounts!");
  }
  console.log("[PASS] Test 6: First-account creation concurrency safe.");

  // TEST 7: Reconciliation Check
  console.log("\n[TEST 7] Reconciliation & Anti-drift Check...");
  const reconciliation = await reconcileCustomerCreditBalance(barbershop.id, customerUser.id);
  console.log("Reconciliation result:", reconciliation);
  if (!reconciliation.isBalanced || reconciliation.drift !== 0) {
    throw new Error(`Reconciliation failed! Drift: ${reconciliation.drift}`);
  }
  console.log("[PASS] Test 7: Reconciliation check confirmed zero drift.");

  // TEST 8: Negative balance protection
  console.log("\n[TEST 8] Negative Balance Protection...");
  let negativeCaught = false;
  try {
    await prisma.$transaction(async (tx) => {
      await adjustCustomerCredit(tx, {
        barbershopId: barbershop.id,
        customerId: customerUser.id,
        type: "DEBIT",
        amount: "9999.00",
        description: "Tentativa de saldo negativo",
        createdByUserId: userOwner.id,
      });
    });
  } catch (err: any) {
    if (err?.code === "INSUFFICIENT_CREDIT_BALANCE" || err?.message?.includes("INSUFFICIENT_CREDIT_BALANCE")) {
      negativeCaught = true;
    }
  }

  if (!negativeCaught) {
    throw new Error("Expected INSUFFICIENT_CREDIT_BALANCE error on excessive debit!");
  }
  console.log("[PASS] Test 8: Negative balance protection confirmed.");

  console.log("\n=========================================");
  console.log("FASE 5B REAL PG CONCURRENCY SUITE PASSED SUCCESSFULLY!");
  console.log("=========================================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FASE 5B REAL PG SUITE FAILED:", err);
    process.exit(1);
  });
