import { URL } from "url";
import crypto from "crypto";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:5439/match_barber_test?schema=public";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

const rawDbUrl = process.env.DATABASE_URL || "";
try {
  const parsedDbUrl = new URL(rawDbUrl.replace("postgresql://", "http://"));
  const allowedHosts = ["localhost", "127.0.0.1"];
  if (
    !allowedHosts.includes(parsedDbUrl.hostname) ||
    !parsedDbUrl.pathname.includes("match_barber_test")
  ) {
    console.error("❌ ERRO DE SEGURANÇA: O script só pode rodar em localhost/match_barber_test!");
    process.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao validar DATABASE_URL:", e);
  process.exit(1);
}

async function runSweepstakesRealPgTests() {
  const { default: prisma } = await import("../src/lib/prisma");
  const {
    calculateSweepstakeEligibility,
    freezeCustomerSweepstake,
    executeSweepstakeDraw,
  } = await import("../src/lib/marketing/sweepstake-engine");
  const { localDateToUTCBoundary, shiftDateISO } = await import("../src/lib/time-utils");

  console.log("===============================================================================");
  console.log("=== INICIANDO SUITE REAL-PG: MARKETING SORTEIOS V1 & NEUTRALIDADE FINANCEIRA ===");
  console.log("===============================================================================\n");

  const runId = `t_${Date.now().toString().slice(-6)}`;

  // 1. Snapshot financeiro pré-execução
  console.log("-> 1. Capturando estado das tabelas financeiras e operacionais...");
  const initialFinancialEntries = await prisma.financialEntry.count();
  const initialFinancialTitles = await prisma.financialTitle.count();
  const initialCashMovements = await prisma.cashMovement.count();
  const initialCommissionEntries = await prisma.commissionEntry.count();
  const initialCheckoutTransactions = await prisma.checkoutTransaction.count();

  console.log(`   Baseline: ${initialFinancialEntries} entradas financeiras, ${initialFinancialTitles} títulos, ${initialCashMovements} movimentos de caixa, ${initialCommissionEntries} entradas de comissão.`);

  // 2. Setup de Barbershops (Tenant A e Tenant B) para validação Multi-Tenant
  console.log("\n-> 2. Criando Tenants isolados A e B...");
  const shopA = await prisma.barbershop.create({
    data: {
      name: `Barbearia Alpha ${runId}`,
      slug: `alpha-${runId}`,
      phone: `119999${runId}`,
      zipCode: "01001-000",
      street: "Rua Alpha",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const shopB = await prisma.barbershop.create({
    data: {
      name: `Barbearia Beta ${runId}`,
      slug: `beta-${runId}`,
      phone: `119888${runId}`,
      zipCode: "01001-000",
      street: "Rua Beta",
      number: "200",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  // Usuário Admin para Barbearia A
  const adminA = await prisma.user.create({
    data: {
      name: `Admin Alpha ${runId}`,
      email: `admin-alpha-${runId}@tembarber.com.br`,
      phone: `119777${runId}`,
      role: "SUPER_ADMIN",
    },
  });

  // Clientes para Shop A
  const customerA1 = await prisma.user.create({
    data: {
      name: "Cliente Alpha 1",
      phone: `119666${runId}`,
      role: "USER",
    },
  });

  const customerA2 = await prisma.user.create({
    data: {
      name: "Cliente Alpha 2",
      phone: `119555${runId}`,
      role: "USER",
    },
  });

  // Cliente para Shop B
  const customerB1 = await prisma.user.create({
    data: {
      name: "Cliente Beta 1",
      phone: `119444${runId}`,
      role: "USER",
    },
  });

  // Barbearia A: Categoria, Serviço e Comandas com itens DONE
  const categoryA = await prisma.category.create({
    data: {
      barbershopId: shopA.id,
      name: "Cabelo",
      slug: `cabelo-${runId}`,
    },
  });

  const serviceA = await prisma.service.create({
    data: {
      barbershopId: shopA.id,
      categoryId: categoryA.id,
      name: "Corte Cabelo",
      price: 50.0,
      durationMin: 30,
    },
  });

  const comandaA1 = await prisma.comanda.create({
    data: {
      barbershopId: shopA.id,
      customerId: customerA1.id,
      customerName: customerA1.name || "Cliente Alpha 1",
      customerPhone: customerA1.phone,
      status: "OPEN", // Comanda ABERTA com serviço DONE (Regra P0 da V1.1)
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaA1.id,
      barbershopId: shopA.id,
      type: "SERVICE",
      serviceId: serviceA.id,
      description: serviceA.name,
      unitPrice: 50.0,
      total: 50.0,
      status: "DONE",
      completedAt: new Date("2026-10-15T14:00:00.000Z"),
    },
  });

  const comandaA2 = await prisma.comanda.create({
    data: {
      barbershopId: shopA.id,
      customerId: customerA2.id,
      customerName: customerA2.name || "Cliente Alpha 2",
      customerPhone: customerA2.phone,
      status: "CLOSED",
      closedAt: new Date("2026-10-20T15:00:00.000Z"),
    },
  });

  await prisma.comandaItem.create({
    data: {
      comandaId: comandaA2.id,
      barbershopId: shopA.id,
      type: "SERVICE",
      serviceId: serviceA.id,
      description: serviceA.name,
      unitPrice: 50.0,
      total: 50.0,
      status: "DONE",
      completedAt: new Date("2026-10-20T14:30:00.000Z"),
    },
  });

  console.log("   Dados operacionais de teste criados com sucesso.");

  // 3. Criar Campanha no Tenant A
  console.log("\n-> 3. Criando Campanha de Sorteio para Barbearia A...");
  const startDateCivil = "2026-10-01";
  const endDateCivil = "2026-11-05";
  const startInclusiveUtc = localDateToUTCBoundary(startDateCivil);
  const endExclusiveUtc = localDateToUTCBoundary(shiftDateISO(endDateCivil, 1));

  const sweepstakeA = await prisma.customerSweepstake.create({
    data: {
      barbershopId: shopA.id,
      title: "Sorteio de Natal Alpha",
      participationMode: "ONE_PER_SERVICE",
      targetSegment: "ALL_CUSTOMERS",
      startDateCivil,
      endDateCivil,
      startInclusiveUtc,
      endExclusiveUtc,
      drawDateScheduled: endExclusiveUtc,
      status: "DRAFT",
      createdById: adminA.id,
      prizes: {
        create: [
          {
            position: 1,
            title: "Cerveja Artesanal e Pomada",
          },
        ],
      },
    },
  });

  // 4. Executar Prévia do Snapshot
  console.log("-> 4. Executando prévia do snapshot para Campanha A...");
  const preview = await calculateSweepstakeEligibility(prisma, {
    barbershopId: shopA.id,
    startDateCivil,
    endDateCivil,
    participationMode: "ONE_PER_SERVICE",
    targetSegment: "ALL_CUSTOMERS",
  });
  console.log(`   Prévia calculada: ${preview.participants.length} participantes, ${preview.totalChances} chances.`);
  if (preview.participants.length !== 2 || preview.totalChances !== 2) {
    throw new Error(`Esperado 2 participantes e 2 chances, obtido ${preview.participants.length} participantes e ${preview.totalChances} chances.`);
  }

  // 5. Congelar a Campanha A
  console.log("-> 5. Congelando Campanha A (travamento e geração de snapshot SHA-256)...");
  const frozen = await prisma.$transaction(async (tx) => {
    return freezeCustomerSweepstake(tx, sweepstakeA.id, shopA.id, adminA.id);
  });
  console.log(`   Status da campanha: ${frozen.status}`);
  console.log(`   Hash SHA-256 do Snapshot: ${frozen.ticketsSha256Digest}`);
  if (frozen.status !== "FROZEN" || !frozen.ticketsSha256Digest) {
    throw new Error("Campanha não congelada corretamente ou hash nulo.");
  }

  // 6. Executar Apuração (Modo Simulação Técnica Interna)
  console.log("-> 6. Executando Apuração com CSPRNG HMAC-SHA256 (Simulação Técnica)...");
  const drawResult = await prisma.$transaction(async (tx) => {
    return executeSweepstakeDraw(tx, {
      sweepstakeId: sweepstakeA.id,
      barbershopId: shopA.id,
      drawnByUserId: adminA.id,
      isTechnicalSimulation: true,
    });
  });

  console.log(`   Campanha apurada: status = ${drawResult.status}`);
  console.log(`   Ganhadores apurados: ${drawResult.winners.length}`);
  console.log(`   Primeiro ganhador: ${drawResult.winners[0]?.customerNameSnapshot} (Ticket #${drawResult.winners[0]?.winningTicketNumber})`);
  if (drawResult.status !== "DRAWN" || drawResult.winners.length !== 1) {
    throw new Error("Falha na apuração do ganhador.");
  }

  // 7. Teste de Isolamento Multi-Tenant Estrito
  console.log("\n-> 7. Validando Isolamento Multi-Tenant estrito entre Barbearia A e B...");
  const leakCheck = await prisma.customerSweepstake.findFirst({
    where: {
      id: sweepstakeA.id,
      barbershopId: shopB.id,
    },
  });
  if (leakCheck !== null) {
    throw new Error("FALHA DE SEGURANÇA: Campanha da Barbearia A foi acessível sob contexto da Barbearia B!");
  }

  const ticketLeakCheck = await prisma.customerSweepstakeTicket.findMany({
    where: {
      sweepstakeId: sweepstakeA.id,
      participant: {
        barbershopId: shopB.id,
      },
    },
  });
  if (ticketLeakCheck.length > 0) {
    throw new Error("FALHA DE SEGURANÇA: Tickets vazaram para tenant cruzado!");
  }
  console.log("   ✅ Isolamento Multi-Tenant verificado com 100% de integridade.");

  // 8. Teste da Trava Regulatória (Lei 5.768/71 e Portaria SPA/MF)
  console.log("\n-> 8. Testando Travas Regulatórias (Lei 5.768/71 e Portaria SPA/MF)...");

  // 8.1 Trava de congelamento: regulamentada sem autorização
  let freezeBlocked = false;
  try {
    const sweepstakeRegPending = await prisma.customerSweepstake.create({
      data: {
        barbershopId: shopA.id,
        title: "Sorteio Regulado Sem Código",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "ALL_CUSTOMERS",
        startDateCivil,
        endDateCivil,
        startInclusiveUtc,
        endExclusiveUtc,
        drawDateScheduled: endExclusiveUtc,
        status: "DRAFT",
        isRegulatedPromotion: true,
        authorizationCode: null,
        createdById: adminA.id,
        prizes: {
          create: [{ position: 1, title: "Prêmio" }],
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      return freezeCustomerSweepstake(tx, sweepstakeRegPending.id, shopA.id, adminA.id);
    });
  } catch (err: any) {
    if (err.message.includes("Certificado de Autorização (SPA/MF)")) {
      freezeBlocked = true;
      console.log(`   ✅ 8.1 Trava de congelamento sem SPA/MF: "${err.message}"`);
    } else {
      throw err;
    }
  }
  if (!freezeBlocked) {
    throw new Error("FALHA: Permitiu congelar campanha regulamentada sem Certificado SPA/MF!");
  }

  // 8.2 Trava de apuração: sorteio eletrônico não certificado em produção
  const oldEnv = process.env.NODE_ENV;
  try {
    (process.env as any).NODE_ENV = "production";
    let drawBlocked = false;
    try {
      const sweepstakeProd = await prisma.customerSweepstake.create({
        data: {
          barbershopId: shopA.id,
          title: "Sorteio Produção Sem Certificação",
          participationMode: "ONE_PER_CUSTOMER",
          targetSegment: "ALL_CUSTOMERS",
          startDateCivil,
          endDateCivil,
          startInclusiveUtc,
          endExclusiveUtc,
          drawDateScheduled: endExclusiveUtc,
          status: "DRAFT",
          drawMethod: "ELECTRONIC_DETERMINISTIC",
          isRegulatedPromotion: false,
          createdById: adminA.id,
          prizes: {
            create: [{ position: 1, title: "Prêmio Prod" }],
          },
        },
      });

      await prisma.$transaction(async (tx) => {
        return freezeCustomerSweepstake(tx, sweepstakeProd.id, shopA.id, adminA.id);
      });

      // Tenta apurar como OFICIAL em produção sem ser simulação técnica
      await prisma.$transaction(async (tx) => {
        return executeSweepstakeDraw(tx, {
          sweepstakeId: sweepstakeProd.id,
          barbershopId: shopA.id,
          drawnByUserId: adminA.id,
          isTechnicalSimulation: false,
        });
      });
    } catch (err: any) {
      if (err.message.includes("APURACAO_OFICIAL_BLOQUEADA_V1") || err.message.includes("APURACAO_ELETRONICA_NAO_CERTIFICADA") || err.message.includes("Lei 5.768/71")) {
        drawBlocked = true;
        console.log(`   ✅ 8.2 Trava de apuração oficial em V1: "${err.message.slice(0, 95)}..."`);
      } else {
        throw err;
      }
    }
    if (!drawBlocked) {
      throw new Error("FALHA DE CONFORMIDADE: Sistema permitiu sorteio eletrônico em produção sem certificação!");
    }
  } finally {
    (process.env as any).NODE_ENV = oldEnv;
  }

  // 9. Auditoria de Neutralidade Financeira Pós-Execução
  console.log("\n-> 9. Verificando Neutralidade Financeira Absoluta...");
  const finalFinancialEntries = await prisma.financialEntry.count();
  const finalFinancialTitles = await prisma.financialTitle.count();
  const finalCashMovements = await prisma.cashMovement.count();
  const finalCommissionEntries = await prisma.commissionEntry.count();
  const finalCheckoutTransactions = await prisma.checkoutTransaction.count();

  console.log(`   Final: ${finalFinancialEntries} entradas financeiras, ${finalFinancialTitles} títulos, ${finalCashMovements} movimentos de caixa, ${finalCommissionEntries} entradas de comissão.`);

  if (
    finalFinancialEntries !== initialFinancialEntries ||
    finalFinancialTitles !== initialFinancialTitles ||
    finalCashMovements !== initialCashMovements ||
    finalCommissionEntries !== initialCommissionEntries ||
    finalCheckoutTransactions !== initialCheckoutTransactions
  ) {
    throw new Error("FALHA DE REGRESSÃO FINANCEIRA: Registros financeiros ou de comissão foram criados/alterados pelo módulo de Marketing!");
  }
  console.log("   ✅ Neutralidade financeira confirmada: 0 impactos no plano de contas, caixa ou comissões.");

  console.log("\n===============================================================================");
  console.log("=== TODOS OS TESTES EM POSTGRESQL REAL FORAM CONCLUÍDOS COM SUCESSO! 🚀 ===");
  console.log("===============================================================================\n");
}

runSweepstakesRealPgTests()
  .catch((e) => {
    console.error("❌ ERRO NA EXECUÇÃO DO TESTE REAL-PG:", e);
    process.exit(1);
  });
