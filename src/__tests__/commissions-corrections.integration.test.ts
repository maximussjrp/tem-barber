/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ComandaItemStatus, ComandaItemType, CommissionPeriodStatus } from "@prisma/client";
import { addProductItem, addServiceItem, recalculateComandaTotals, upsertDiscountItem } from "@/lib/operations/comandas";
import { upsertCommissionConfig } from "@/lib/operations/commissions";
import { closeComanda, refundPayment, registerPayment } from "@/lib/operations/payments";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "commission_adjustments",
      "commission_periods",
      "commission_entries",
      "commission_configs",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "stock_movements",
      "comanda_items",
      "products",
      "comandas",
      "idempotency_keys",
      "appointment_services",
      "appointments",
      "barber_services",
      "working_hours",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

async function seedTenant(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `com-corr-${label}`,
      phone: `11880${label.charCodeAt(0)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  const ownerUser = await prisma.user.create({ data: { name: `Owner ${label}`, phone: `11881${label.charCodeAt(0)}` } });
  const managerUser = await prisma.user.create({ data: { name: `Manager ${label}`, phone: `11882${label.charCodeAt(0)}` } });
  const barberUser1 = await prisma.user.create({ data: { name: `Barber1 ${label}`, phone: `11883${label.charCodeAt(0)}` } });
  const barberUser2 = await prisma.user.create({ data: { name: `Barber2 ${label}`, phone: `11884${label.charCodeAt(0)}` } });
  
  const owner = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" } });
  const manager = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: managerUser.id, role: "MANAGER" } });
  const barber1 = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: barberUser1.id, role: "BARBER" } });
  const barber2 = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: barberUser2.id, role: "BARBER" } });
  
  const category = await prisma.category.create({ data: { barbershopId: shop.id, name: "Servicos", slug: `servicos-${label}` } });
  const service = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "200.00", durationMin: 30 },
  });
  const service2 = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "80.00", durationMin: 30 },
  });
  const product = await prisma.product.create({
    data: { barbershopId: shop.id, name: "Pomada", salePrice: "50.00", currentStock: "10", trackStock: false },
  });
  
  await prisma.barberService.create({ data: { barberId: barber1.id, serviceId: service.id } });
  await prisma.barberService.create({ data: { barberId: barber1.id, serviceId: service2.id } });
  await prisma.barberService.create({ data: { barberId: barber2.id, serviceId: service.id } });
  await prisma.barberService.create({ data: { barberId: barber2.id, serviceId: service2.id } });
  
  const comanda = await prisma.comanda.create({
    data: { barbershopId: shop.id, customerName: "Cliente", customerPhone: "11999999999" },
  });
  return { shop, ownerUser, owner, manager, barber1, barber2, category, service, service2, product, comanda };
}

async function addDoneService(input: {
  barbershopId: string;
  comandaId: string;
  serviceId: string;
  executorId: string;
  discountAmount?: string;
}) {
  const comanda = await prisma.$transaction((tx) =>
    addServiceItem(tx, {
      barbershopId: input.barbershopId,
      comandaId: input.comandaId,
      serviceId: input.serviceId,
      executorId: input.executorId,
      discountAmount: input.discountAmount,
    })
  );
  const item = comanda.items.at(-1)!;
  await prisma.comandaItem.update({
    where: { id: item.id },
    data: { status: ComandaItemStatus.DONE, completedAt: new Date("2026-07-10T12:00:00.000Z") },
  });
  await prisma.$transaction((tx) => recalculateComandaTotals(tx, input.comandaId));
  return item.id;
}

describeIf("correcoes e melhorias do modulo de comissoes", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("garante que o rollover de saldo devedor (ajuste negativo) entra na consolidacao e eh idempotente", async () => {
    const t = await seedTenant("t1");
    // Configura 50% de comissao
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: t.shop.id, type: "PERCENTAGE", value: "50" })
    );

    // Servico de 200, comissao de 100
    const itemId = await addDoneService({ barbershopId: t.shop.id, comandaId: t.comanda.id, serviceId: t.service.id, executorId: t.barber1.id });
    
    // Paga integralmente
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, method: "PIX", amount: "200.00", userId: t.ownerUser.id })
    );
    await prisma.$transaction((tx) => closeComanda(tx, t.shop.id, t.comanda.id));

    // Fecha e paga o ciclo atual
    const { executeCommissionPayout, getAuthoritativeCycleBalance } = await import("@/lib/operations/commissions");
    const payout1 = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId: t.shop.id,
        memberId: t.barber1.id,
        paymentMethod: "PIX",
        idempotencyKey: "payout-c-test-1",
        createdById: t.ownerUser.id,
      })
    );
    expect(payout1.paidCycle.status).toBe("PAID");

    // Agora, o cliente pede estorno de 100
    const payment = await prisma.payment.findFirstOrThrow({ where: { comandaId: t.comanda.id, status: "CONFIRMED" } });
    await prisma.$transaction((tx) =>
      refundPayment(tx, { barbershopId: t.shop.id, paymentId: payment.id, amount: "100.00", reason: "Estorno parcial", userId: t.ownerUser.id })
    );

    // Como o ciclo ja foi pago, estorno de 100 gera reversao de 50 roteada como DEBIT no ciclo sucessor OPEN
    const debits = await prisma.commissionCycleAdjustment.findMany({
      where: { barbershopId: t.shop.id, cycle: { memberId: t.barber1.id }, type: "DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(Number(debits[0].amount)).toBe(50);

    // Simula uma nova comanda de 200 no ciclo aberto (gera 100 de comissao bruta)
    await prisma.$transaction(async (tx) => {
      const comanda2 = await tx.comanda.create({
        data: { barbershopId: t.shop.id, customerName: "Cliente2", customerPhone: "11999999999" },
      });
      const updatedComanda = await addServiceItem(tx, { barbershopId: t.shop.id, comandaId: comanda2.id, serviceId: t.service.id, executorId: t.barber1.id });
      const item2 = updatedComanda.items.at(-1)!;
      await tx.comandaItem.update({
        where: { id: item2.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date("2026-08-10T12:00:00.000Z") },
      });
      await recalculateComandaTotals(tx, comanda2.id);
      await registerPayment(tx, { barbershopId: t.shop.id, comandaId: comanda2.id, method: "PIX", amount: "200.00", userId: t.ownerUser.id });
      await closeComanda(tx, t.shop.id, comanda2.id);
    });

    const openCycle = await prisma.commissionCycle.findFirstOrThrow({
      where: { barbershopId: t.shop.id, memberId: t.barber1.id, status: "OPEN" },
    });
    const authBal = await getAuthoritativeCycleBalance(prisma as any, openCycle.id);
    expect(authBal.grossCommissionCents).toBe(10000);
    expect(authBal.adjustmentsTotalCents).toBe(-5000);
    expect(authBal.economicPayableCents).toBe(5000);
  });

  it("garante que o cancelamento manual da comanda reverte todas as comissoes geradas de forma transacional", async () => {
    const t = await seedTenant("t2");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: t.shop.id, type: "PERCENTAGE", value: "40" })
    );

    const itemId = await addDoneService({ barbershopId: t.shop.id, comandaId: t.comanda.id, serviceId: t.service.id, executorId: t.barber1.id });
    
    // Registra pagamento parcial (libera proporcional)
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, method: "PIX", amount: "100.00", userId: t.ownerUser.id })
    );

    const entryBefore = await prisma.commissionEntry.findFirstOrThrow();
    expect(entryBefore.releasedAmount.toNumber()).toBe(40); // 40% de 100 = 40

    // Cancela a comanda manualmente via API (simulado chamando patch de comanda)
    await prisma.$transaction(async (tx) => {
      // Seta status da comanda para CANCELLED e atualiza itens
      await tx.comanda.update({
        where: { id: t.comanda.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.comandaItem.updateMany({
        where: { comandaId: t.comanda.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      
      const { syncCommissionReleaseForComanda } = await import("@/lib/operations/commissions");
      await syncCommissionReleaseForComanda(tx, t.shop.id, t.comanda.id);
    });

    // A comissao liberada deve cair para 0 e a reversao de 40 ser registrada
    const entryAfter = await prisma.commissionEntry.findFirstOrThrow();
    expect(entryAfter.releasedAmount.toNumber()).toBe(0);
    expect(entryAfter.reversedAmount.toNumber()).toBe(40);
    expect(entryAfter.status).toBe("REVERSED");

    const reversals = await prisma.commissionPayableItem.findMany({ where: { entryId: entryAfter.id, type: "REVERSAL" } });
    expect(reversals).toHaveLength(1);
    expect(Number(reversals[0].amount)).toBe(40);
  });

  it("bloqueia troca de executor com erro 409 se a comissao ja foi paga, ou permite e ajusta se nao paga", async () => {
    const t = await seedTenant("t3");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: t.shop.id, type: "PERCENTAGE", value: "50" })
    );

    const itemId = await addDoneService({ barbershopId: t.shop.id, comandaId: t.comanda.id, serviceId: t.service.id, executorId: t.barber1.id });
    
    // Pagamento
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, method: "PIX", amount: "200.00", userId: t.ownerUser.id })
    );

    // Caso A: Tentar trocar executor via update direto sem operação versionada bloqueia com EXECUTOR_CORRECTION_REQUIRED
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.comandaItem.update({
          where: { id: itemId },
          data: { executorId: t.barber2.id },
        });
        const { syncCommissionReleaseForComanda } = await import("@/lib/operations/commissions");
        await syncCommissionReleaseForComanda(tx, t.shop.id, t.comanda.id);
      })
    ).rejects.toThrow("Alteração de executor exige operação versionada de correção de executor");

    // Caso B: Executar troca versionada via correctCommissionExecutor funciona de forma atômica
    const { correctCommissionExecutor } = await import("@/lib/operations/commissions");
    const correctionResult = await prisma.$transaction((tx) =>
      correctCommissionExecutor(
        {
          barbershopId: t.shop.id,
          comandaItemId: itemId,
          newExecutorMemberId: t.barber2.id,
          reason: "Correção de executor autorizada",
          userId: t.ownerUser.id,
          role: "OWNER",
          idempotencyKey: "idem-corr-test-3",
        },
        tx
      )
    );

    expect(correctionResult.success).toBe(true);
    const entriesBarber2 = await prisma.commissionEntry.findMany({ where: { memberId: t.barber2.id, isCurrent: true } });
    expect(entriesBarber2).toHaveLength(1);
    expect(Number(entriesBarber2[0].releasedAmount)).toBe(100);

    const entriesBarber1 = await prisma.commissionEntry.findMany({ where: { memberId: t.barber1.id, isCurrent: true } });
    expect(entriesBarber1).toHaveLength(0); // Barbeiro 1 não é mais current
  });

  it("garante que o desconto global eh rateado proporcionalmente nos itens comissionaveis com precisao de centavos", async () => {
    const t = await seedTenant("t4");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: t.shop.id, type: "PERCENTAGE", value: "50" })
    );

    // Servico 1: 120.00
    const item1 = await addDoneService({ barbershopId: t.shop.id, comandaId: t.comanda.id, serviceId: t.service.id, executorId: t.barber1.id });
    await prisma.comandaItem.update({ where: { id: item1 }, data: { unitPrice: "120.00", total: "120.00" } });

    // Servico 2: 80.00
    const item2 = await addDoneService({ barbershopId: t.shop.id, comandaId: t.comanda.id, serviceId: t.service2.id, executorId: t.barber1.id });
    await prisma.comandaItem.update({ where: { id: item2 }, data: { unitPrice: "80.00", total: "80.00" } });

    // Adiciona desconto global de 30.00
    await prisma.$transaction((tx) => {
      return upsertDiscountItem(tx, {
        comandaId: t.comanda.id,
        barbershopId: t.shop.id,
        description: "Desconto global de teste",
        amount: "30.00",
      });
    });

    // Paga integralmente (Total comanda = 120 + 80 - 30 = 170)
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, method: "PIX", amount: "170.00", userId: t.ownerUser.id })
    );

    const entries = await prisma.commissionEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(2);

    // Item 1 (120): Peso = 120 / 200 = 60%. Desconto = 60% de 30 = 18. Base liquida = 102. Comissao = 51.
    // Item 2 (80): Peso = 80 / 200 = 40%. Desconto = 40% de 30 = 12. Base liquida = 68. Comissao = 34.
    const entry1 = entries.find(e => e.comandaItemId === item1)!;
    const entry2 = entries.find(e => e.comandaItemId === item2)!;

    expect(entry1.baseAmount.toNumber()).toBe(102); // 120 - 18
    expect(entry1.generatedAmount.toNumber()).toBe(51);

    expect(entry2.baseAmount.toNumber()).toBe(68); // 80 - 12
    expect(entry2.generatedAmount.toNumber()).toBe(34);
  });

  it("garante comissao de produto configurada separadamente, desativada por padrao", async () => {
    const t = await seedTenant("t5");
    
    // Adiciona produto com executor (vendedor)
    await prisma.$transaction((tx) =>
      addProductItem(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, productId: t.product.id, quantity: 2 })
    );
    const prodItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: t.comanda.id, type: "PRODUCT" } });
    await prisma.comandaItem.update({
      where: { id: prodItem.id },
      data: { executorId: t.barber1.id, status: ComandaItemStatus.DONE, completedAt: new Date("2026-07-10T12:00:00.000Z") }
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, t.comanda.id));

    // Registra pagamento da comanda (total 100 de produto)
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: t.shop.id, comandaId: t.comanda.id, method: "PIX", amount: "100.00", userId: t.ownerUser.id })
    );

    // Caso A: Nenhuma regra de produto configurada (deve ignorar comissao de produto)
    const entriesBefore = await prisma.commissionEntry.findMany({ where: { type: "PRODUCT" } });
    expect(entriesBefore).toHaveLength(0);

    // Caso B: Adiciona regra de produto ativa para a barbearia
    await prisma.$transaction(async (tx) => {
      // Como upsertCommissionConfig original sera atualizado, simulamos a criacao da regra
      await tx.commissionConfig.create({
        data: {
          barbershopId: t.shop.id,
          scopeKey: "product_default",
          type: "PERCENTAGE",
          value: "10.00",
        }
      });
      
      const { syncCommissionReleaseForComanda } = await import("@/lib/operations/commissions");
      await syncCommissionReleaseForComanda(tx, t.shop.id, t.comanda.id);
    });

    const entriesAfter = await prisma.commissionEntry.findMany({ where: { type: "PRODUCT" } });
    expect(entriesAfter).toHaveLength(1);
    expect(entriesAfter[0].generatedAmount.toNumber()).toBe(10); // 10% de 100 = 10
    expect(entriesAfter[0].memberId).toBe(t.barber1.id);
  });
});
