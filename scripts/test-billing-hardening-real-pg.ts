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

async function runBillingHardeningRealPgTests() {
  const { default: prisma } = await import("../src/lib/prisma");
  const {
    resolveCurrentBillableAsaasSubscription,
    resolveCurrentPaymentForContract,
  } = await import("../src/lib/billing/current-contract");

  console.log("=== INICIANDO SUITE REAL-PG BILLING HARDENING (ETAPA 1) ===");

  const timestamp = Date.now();
  const barbershop = await prisma.barbershop.create({
    data: {
      name: `Barbearia Billing Real PG ${timestamp}`,
      slug: `barbearia-billing-real-pg-${timestamp}`,
      phone: `119888${timestamp.toString().slice(-5)}`,
      street: "Rua Faturamento",
      number: "500",
      neighborhood: "Financeiro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310-100",
    },
  });

  const foreignBarbershop = await prisma.barbershop.create({
    data: {
      name: `Barbearia Outra Billing ${timestamp}`,
      slug: `barbearia-outra-billing-${timestamp}`,
      phone: `119777${timestamp.toString().slice(-5)}`,
      street: "Rua Outra",
      number: "600",
      neighborhood: "Financeiro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310-200",
    },
  });

  try {
    // -------------------------------------------------------------
    // TESTE 1: CANONICAL CONTRACT RESOLUTION (NONE -> FOUND -> RECONCILIATION_REQUIRED)
    // -------------------------------------------------------------
    console.log("--- TESTE 1: Canonical Contract Resolution Real PG ---");

    // 1.1: Sem contratos
    const resEmpty = await resolveCurrentBillableAsaasSubscription(prisma, barbershop.id);
    if (resEmpty.status !== "NONE" || resEmpty.subscription !== null) {
      throw new Error(`Esperado status NONE para barbearia sem contratos, recebido: ${resEmpty.status}`);
    }
    console.log("  ✓ 1.1 Status NONE confirmado para barbearia sem contratos");

    // 1.2: Cria primeiro contrato ACTIVE
    const sub1 = await prisma.asaasBillingSubscription.create({
      data: {
        barbershopId: barbershop.id,
        asaasSubscriptionId: `sub_real_1_${timestamp}`,
        asaasCustomerId: `cus_real_1_${timestamp}`,
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        externalReference: `tb_sub_${barbershop.id}_pro_monthly_1`,
      },
    });

    const resSingle = await resolveCurrentBillableAsaasSubscription(prisma, barbershop.id);
    if (resSingle.status !== "FOUND" || resSingle.subscription.id !== sub1.id) {
      throw new Error(`Esperado status FOUND com sub1, recebido: ${resSingle.status}`);
    }
    console.log("  ✓ 1.2 Status FOUND confirmado com contrato único ACTIVE");

    // 1.3: Cria segundo contrato ACTIVE -> deve exigir reconciliação
    const sub2 = await prisma.asaasBillingSubscription.create({
      data: {
        barbershopId: barbershop.id,
        asaasSubscriptionId: `sub_real_2_${timestamp}`,
        asaasCustomerId: `cus_real_1_${timestamp}`,
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "BOLETO",
        externalReference: `tb_sub_${barbershop.id}_pro_monthly_2`,
      },
    });

    const resConflict = await resolveCurrentBillableAsaasSubscription(prisma, barbershop.id);
    if (
      resConflict.status !== "RECONCILIATION_REQUIRED" ||
      resConflict.isReconciliationRequired !== true ||
      resConflict.count !== 2
    ) {
      throw new Error(`Esperado status RECONCILIATION_REQUIRED com 2 contratos, recebido: ${resConflict.status}`);
    }
    console.log("  ✓ 1.3 Status RECONCILIATION_REQUIRED confirmado para múltiplos contratos billable");

    // Remove o segundo para restaurar estado saudável
    await prisma.asaasBillingSubscription.delete({ where: { id: sub2.id } });

    // -------------------------------------------------------------
    // TESTE 2: RESOLUÇÃO DE CURRENT PAYMENT REAL PG COM ISOLAMENTO DE TENANT
    // -------------------------------------------------------------
    console.log("--- TESTE 2: Resolução de Current Payment Real PG ---");

    await prisma.asaasBillingPayment.create({
      data: {
        barbershopId: barbershop.id,
        asaasPaymentId: `pay_older_${timestamp}`,
        asaasSubscriptionId: sub1.asaasSubscriptionId,
        status: "PENDING",
        billingType: "PIX",
        value: 49.9,
        dueDate: new Date("2026-07-01"),
      },
    });

    const pmtNewer = await prisma.asaasBillingPayment.create({
      data: {
        barbershopId: barbershop.id,
        asaasPaymentId: `pay_newer_${timestamp}`,
        asaasSubscriptionId: sub1.asaasSubscriptionId,
        status: "PENDING",
        billingType: "PIX",
        value: 49.9,
        dueDate: new Date("2026-08-01"),
      },
    });

    // Cobrança de outro tenant com a mesma subscriptionId fictícia
    await prisma.asaasBillingPayment.create({
      data: {
        barbershopId: foreignBarbershop.id,
        asaasPaymentId: `pay_foreign_${timestamp}`,
        asaasSubscriptionId: sub1.asaasSubscriptionId,
        status: "PENDING",
        billingType: "PIX",
        value: 99.9,
        dueDate: new Date("2026-09-01"),
      },
    });

    const currentPmt = await resolveCurrentPaymentForContract(prisma, barbershop.id, {
      barbershopId: barbershop.id,
      asaasSubscriptionId: sub1.asaasSubscriptionId,
    });

    if (!currentPmt || currentPmt.asaasPaymentId !== pmtNewer.asaasPaymentId) {
      throw new Error(`Esperado pagamento mais recente pay_newer, recebido: ${currentPmt?.asaasPaymentId}`);
    }
    console.log("  ✓ 2.1 Current payment selecionado por dueDate DESC com isolamento de tenant estrito");

    // -------------------------------------------------------------
    // TESTE 3: SERIALIZAÇÃO DE ADVISORY LOCK CONCORRENTE
    // -------------------------------------------------------------
    console.log("--- TESTE 3: Serialização de Advisory Lock Concorrente ---");

    let lock1Acquired = false;
    let lock2Acquired = false;
    const executionOrder: string[] = [];

    const promise1 = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('asaas-billing-create:' || ${barbershop.id}))`;
      lock1Acquired = true;
      executionOrder.push("tx1_lock");
      // Simula latência de chamada de rede ou processamento dentro do lock
      await new Promise((r) => setTimeout(r, 200));
      executionOrder.push("tx1_done");
    });

    const promise2 = new Promise<void>((resolve, reject) => {
      // Pequeno delay para garantir que tx1 iniciou e pegou o lock primeiro
      setTimeout(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            executionOrder.push("tx2_waiting");
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('asaas-billing-create:' || ${barbershop.id}))`;
            lock2Acquired = true;
            executionOrder.push("tx2_lock");
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 50);
    });

    await Promise.all([promise1, promise2]);

    if (!lock1Acquired || !lock2Acquired) {
      throw new Error("Ambos os locks deveriam ter sido adquiridos sequencialmente");
    }

    // tx2 só pode adquirir o lock após tx1 terminar ('tx1_done' antes de 'tx2_lock')
    const idxTx1Done = executionOrder.indexOf("tx1_done");
    const idxTx2Lock = executionOrder.indexOf("tx2_lock");
    if (idxTx1Done === -1 || idxTx2Lock === -1 || idxTx1Done > idxTx2Lock) {
      throw new Error(`Ordem de execução inválida no advisory lock: ${executionOrder.join(" -> ")}`);
    }
    console.log("  ✓ 3.1 Advisory lock serializou transações concorrentes com sucesso:", executionOrder.join(" -> "));

    console.log("\n✅ TODOS OS GATES REAL-PG BILLING HARDENING FORAM APROVADOS!");
  } finally {
    console.log("--- Limpeza de Dados de Teste ---");
    await prisma.asaasBillingPayment.deleteMany({
      where: { barbershopId: { in: [barbershop.id, foreignBarbershop.id] } },
    });
    await prisma.asaasBillingSubscription.deleteMany({
      where: { barbershopId: { in: [barbershop.id, foreignBarbershop.id] } },
    });
    await prisma.barbershop.deleteMany({
      where: { id: { in: [barbershop.id, foreignBarbershop.id] } },
    });
    await prisma.$disconnect();
    console.log("  ✓ Dados de teste limpos com sucesso.");
  }
}

runBillingHardeningRealPgTests().catch((err) => {
  console.error("❌ FALHA NO TESTE REAL PG:", err);
  process.exit(1);
});
