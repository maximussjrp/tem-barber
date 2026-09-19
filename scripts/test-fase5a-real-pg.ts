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
  if (validateTestDatabaseUrl(invalidDb).isValid) throw new Error("Self-test failed: invalidDb should be rejected");
  if (validateTestDatabaseUrl(invalidPort).isValid) throw new Error("Self-test failed: invalidPort should be rejected");
  if (validateTestDatabaseUrl(invalidHost).isValid) throw new Error("Self-test failed: invalidHost should be rejected");
  if (validateTestDatabaseUrl(invalidProd).isValid) throw new Error("Self-test failed: invalidProd should be rejected");
  if (validateTestDatabaseUrl(invalidProdWord).isValid) throw new Error("Self-test failed: invalidProdWord should be rejected");

  console.log("URL VALIDATION SELF-TESTS PASSED SUCCESSFULLY.");
}

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

async function main() {
  console.log("=========================================");
  console.log("REAL POSTGRESQL CONCURRENCY TEST SUITE");
  console.log("=========================================");

  // 1. Run self-tests for safety guards
  runUrlValidationSelfTests();

  // 2. Obtain & validate test database URL before loading Prisma
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  assertTestDatabaseOrThrow(testDatabaseUrl);
  process.env.DATABASE_URL = testDatabaseUrl;

  // 3. Dynamically import Prisma & operations after setting validated DATABASE_URL
  const { default: prisma } = await import("../src/lib/prisma");
  const { refundPayment, registerPayment, closeComanda } = await import("../src/lib/operations/payments");
  const { fromCents, toCents } = await import("../src/lib/operations/money");

  async function setupFixtures() {
    // Second explicit safety guard before executing TRUNCATE
    assertTestDatabaseOrThrow(process.env.DATABASE_URL);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "financial_entries",
        "cash_movements",
        "cash_sessions",
        "command_payments",
        "comanda_items",
        "comandas",
        "idempotency_keys",
        "barbershops",
        "users"
      CASCADE;
    `);

    await prisma.user.create({
      data: { id: "user-a", name: "User A", email: "usera@test.com", passwordHash: "hash", phone: "11999999991" },
    });
    await prisma.user.create({
      data: { id: "user-b", name: "User B", email: "userb@test.com", passwordHash: "hash", phone: "11999999992" },
    });

    await prisma.barbershop.create({
      data: {
        id: "shop-a",
        name: "Shop A",
        slug: "shop-a",
        phone: "11999999991",
        zipCode: "00000000",
        street: "Rua A",
        number: "1",
        neighborhood: "Bairro A",
        city: "Cidade A",
        state: "SP",
      },
    });
    await prisma.barbershop.create({
      data: {
        id: "shop-b",
        name: "Shop B",
        slug: "shop-b",
        phone: "11999999992",
        zipCode: "00000000",
        street: "Rua B",
        number: "2",
        neighborhood: "Bairro B",
        city: "Cidade B",
        state: "SP",
      },
    });

    // Create comanda 1 in shop-a (R$ 100,00 total)
    await prisma.comanda.create({
      data: {
        id: "cmd-1",
        barbershopId: "shop-a",
        customerName: "Cliente Teste 1",
        status: "OPEN",
        subtotal: fromCents(10000),
        total: fromCents(10000),
        paidTotal: fromCents(0),
        remainingTotal: fromCents(10000),
      },
    });

    await prisma.comandaItem.create({
      data: {
        id: "item-1",
        comandaId: "cmd-1",
        barbershopId: "shop-a",
        type: "SERVICE",
        description: "Corte",
        quantity: fromCents(100),
        unitPrice: fromCents(10000),
        total: fromCents(10000),
      },
    });

    // Register payment of R$ 100,00
    await prisma.$transaction(async (tx) => {
      return registerPayment(tx, {
        barbershopId: "shop-a",
        comandaId: "cmd-1",
        method: "PIX",
        amount: "100.00",
        userId: "user-a",
      });
    });

    // Close comanda
    await prisma.$transaction(async (tx) => {
      return closeComanda(tx, "shop-a", "cmd-1");
    });

    // Create comanda in shop-b for tenant isolation test
    await prisma.comanda.create({
      data: {
        id: "cmd-b",
        barbershopId: "shop-b",
        customerName: "Cliente Teste B",
        status: "OPEN",
        subtotal: fromCents(5000),
        total: fromCents(5000),
        paidTotal: fromCents(0),
        remainingTotal: fromCents(5000),
      },
    });

    await prisma.comandaItem.create({
      data: {
        id: "item-b",
        comandaId: "cmd-b",
        barbershopId: "shop-b",
        type: "SERVICE",
        description: "Barba",
        quantity: fromCents(100),
        unitPrice: fromCents(5000),
        total: fromCents(5000),
      },
    });
  }

  // TEST 1: Concurrent Refunds with DIFFERENT Keys (R$ 60 vs R$ 60 on R$ 100 payment)
  console.log("\n--- TEST 1: Concurrent Refunds (Different Keys: diff-key-A vs diff-key-B) ---");
  await setupFixtures();
  const payment1 = await prisma.payment.findFirstOrThrow({ where: { comandaId: "cmd-1", refundOfId: null } });

  const results1 = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      return refundPayment(tx, {
        barbershopId: "shop-a",
        comandaId: "cmd-1",
        paymentId: payment1.id,
        amount: "60.00",
        reason: "Estorno Concorrente A",
        userId: "user-a",
        idempotencyKey: "diff-key-A",
      });
    }),
    prisma.$transaction(async (tx) => {
      return refundPayment(tx, {
        barbershopId: "shop-a",
        comandaId: "cmd-1",
        paymentId: payment1.id,
        amount: "60.00",
        reason: "Estorno Concorrente B",
        userId: "user-a",
        idempotencyKey: "diff-key-B",
      });
    }),
  ]);

  const fulfilled1 = results1.filter((r) => r.status === "fulfilled");
  const rejected1 = results1.filter((r) => r.status === "rejected");
  const errMessage1 = rejected1.length > 0 ? (rejected1[0] as PromiseRejectedResult).reason?.code || (rejected1[0] as PromiseRejectedResult).reason?.message : null;

  const freshPayment1 = await prisma.payment.findUniqueOrThrow({ where: { id: payment1.id } });
  const refundPayments1 = await prisma.payment.findMany({ where: { refundOfId: payment1.id } });
  const financialEntries1 = await prisma.financialEntry.findMany({ where: { barbershopId: "shop-a", type: "REFUND" } });

  console.log("DIFFERENT_KEYS_FULFILLED_COUNT:", fulfilled1.length);
  console.log("DIFFERENT_KEYS_REJECTED_COUNT:", rejected1.length);
  console.log("DIFFERENT_KEYS_REJECTED_ERROR:", errMessage1);
  console.log("DIFFERENT_KEYS_EFFECTIVE_REFUND_COUNT:", refundPayments1.length);
  console.log("DIFFERENT_KEYS_TOTAL_REFUND:", refundPayments1.reduce((sum, p) => sum + Math.abs(toCents(p.amount)), 0) / 100);
  console.log("DIFFERENT_KEYS_TOTAL_FINANCIAL_ENTRY:", financialEntries1.reduce((sum, e) => sum + toCents(e.amount), 0) / 100);
  console.log("DIFFERENT_KEYS_FINAL_REFUNDED_AMOUNT:", toCents(freshPayment1.refundedAmount) / 100);
  console.log("DIFFERENT_KEYS_OVER_REFUND_OCCURRED:", toCents(freshPayment1.refundedAmount) > 10000 ? "YES" : "NO");

  // TEST 2: Concurrent Refunds with SAME Key (R$ 20 vs R$ 20 with same-key-PG)
  console.log("\n--- TEST 2: Concurrent Refunds (Same Key: same-key-PG) ---");
  await setupFixtures();
  const payment2 = await prisma.payment.findFirstOrThrow({ where: { comandaId: "cmd-1", refundOfId: null } });

  const results2 = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      return refundPayment(tx, {
        barbershopId: "shop-a",
        comandaId: "cmd-1",
        paymentId: payment2.id,
        amount: "20.00",
        reason: "Estorno Idempotente A",
        userId: "user-a",
        idempotencyKey: "same-key-PG",
      });
    }),
    prisma.$transaction(async (tx) => {
      return refundPayment(tx, {
        barbershopId: "shop-a",
        comandaId: "cmd-1",
        paymentId: payment2.id,
        amount: "20.00",
        reason: "Estorno Idempotente B",
        userId: "user-a",
        idempotencyKey: "same-key-PG",
      });
    }),
  ]);

  const fulfilled2 = results2.filter((r) => r.status === "fulfilled");
  const rejected2 = results2.filter((r) => r.status === "rejected");
  const errMessage2 = rejected2.length > 0 ? (rejected2[0] as PromiseRejectedResult).reason?.message : null;

  const freshPayment2 = await prisma.payment.findUniqueOrThrow({ where: { id: payment2.id } });
  const refundPayments2 = await prisma.payment.findMany({ where: { refundOfId: payment2.id } });
  const financialEntries2 = await prisma.financialEntry.findMany({ where: { barbershopId: "shop-a", type: "REFUND" } });

  console.log("SAME_KEY_FULFILLED_COUNT:", fulfilled2.length);
  console.log("SAME_KEY_REJECTED_COUNT:", rejected2.length);
  if (rejected2.length > 0) console.log("SAME_KEY_REJECTED_ERROR:", errMessage2);
  console.log("SAME_KEY_EFFECTIVE_REFUND_COUNT:", refundPayments2.length);
  console.log("SAME_KEY_EFFECTIVE_FINANCIAL_ENTRY_COUNT:", financialEntries2.length);
  console.log("SAME_KEY_TOTAL_REFUND:", refundPayments2.reduce((sum, p) => sum + Math.abs(toCents(p.amount)), 0) / 100);
  console.log("SAME_KEY_FINAL_REFUNDED_AMOUNT:", toCents(freshPayment2.refundedAmount) / 100);
  console.log("SAME_KEY_REPLAY_CONFIRMED:", fulfilled2.length === 2 && refundPayments2.length === 1 ? "YES" : "NO");

  // TEST 3: Real PG Tenant Isolation
  console.log("\n--- TEST 3: Real PG Tenant Isolation ---");
  await setupFixtures();
  const payment3 = await prisma.payment.findFirstOrThrow({ where: { comandaId: "cmd-1", refundOfId: null } });
  let tenantError = false;
  try {
    await prisma.$transaction(async (tx) => {
      return refundPayment(tx, {
        barbershopId: "shop-b", // Shop B trying to refund Shop A payment
        comandaId: "cmd-1",
        paymentId: payment3.id,
        amount: "20.00",
        reason: "Cross tenant attempt",
        userId: "user-b",
      });
    });
  } catch (err: any) {
    tenantError = err.code === "PAYMENT_NOT_FOUND" || err.code === "COMANDA_NOT_FOUND";
    console.log("TENANT_ISOLATION_REJECTION_CODE:", err.code);
  }
  console.log("REAL_PG_TENANT_ISOLATION_TEST:", tenantError ? "PASS" : "FAIL");

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("FATAL_TEST_ERROR:", e);
    process.exit(1);
  });
}
