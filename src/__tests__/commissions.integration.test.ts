import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ComandaItemStatus } from "@prisma/client";
import { addProductItem, addServiceItem, recalculateComandaTotals } from "@/lib/operations/comandas";
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
      slug: `commission-${label}`,
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
  const barberUser = await prisma.user.create({ data: { name: `Barber ${label}`, phone: `11883${label.charCodeAt(0)}` } });
  const owner = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" } });
  const manager = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: managerUser.id, role: "MANAGER" } });
  const barber = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" } });
  const category = await prisma.category.create({ data: { barbershopId: shop.id, name: "Servicos", slug: `servicos-${label}` } });
  const service = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "200.00", durationMin: 30 },
  });
  const beard = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "80.00", durationMin: 30 },
  });
  const product = await prisma.product.create({
    data: { barbershopId: shop.id, name: "Pomada", salePrice: "50.00", currentStock: "10", trackStock: false },
  });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: service.id } });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: beard.id } });
  const comanda = await prisma.comanda.create({
    data: { barbershopId: shop.id, customerName: "Cliente", customerPhone: "11999999999" },
  });
  return { shop, ownerUser, owner, manager, barber, category, service, beard, product, comanda };
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

describeIf("release operacional 1B - comissoes", () => {
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

  it("aplica a primeira regra valida na hierarquia e salva snapshot", async () => {
    const tenant = await seedTenant("a");
    await prisma.$transaction(async (tx) => {
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, type: "PERCENTAGE", value: "5" });
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, categoryId: tenant.category.id, type: "PERCENTAGE", value: "10" });
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, serviceId: tenant.service.id, type: "PERCENTAGE", value: "15" });
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, memberId: tenant.barber.id, type: "PERCENTAGE", value: "20" });
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, memberId: tenant.barber.id, categoryId: tenant.category.id, type: "PERCENTAGE", value: "25" });
      await upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, memberId: tenant.barber.id, serviceId: tenant.service.id, type: "PERCENTAGE", value: "30" });
    });
    await addDoneService({ barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, serviceId: tenant.service.id, executorId: tenant.barber.id });

    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "200.00", userId: tenant.ownerUser.id })
    );

    const entry = await prisma.commissionEntry.findFirstOrThrow();
    expect(entry.generatedAmount.toString()).toBe("60");
    expect(entry.configSnapshot).toMatchObject({ type: "PERCENTAGE", value: "30" });
  });

  it("calcula desconto, ignora produto e item sem profissional, e gera de forma idempotente", async () => {
    const tenant = await seedTenant("b");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, type: "PERCENTAGE", value: "50" })
    );
    await addDoneService({
      barbershopId: tenant.shop.id,
      comandaId: tenant.comanda.id,
      serviceId: tenant.service.id,
      executorId: tenant.barber.id,
      discountAmount: "20.00",
    });
    await prisma.$transaction((tx) => addProductItem(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, productId: tenant.product.id }));
    await prisma.comandaItem.create({
      data: {
        barbershopId: tenant.shop.id,
        comandaId: tenant.comanda.id,
        type: "SERVICE",
        status: "DONE",
        description: "Servico sem executor",
        quantity: 1,
        unitPrice: "10.00",
        total: "10.00",
        serviceId: tenant.beard.id,
      },
    });
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "240.00", userId: tenant.ownerUser.id, idempotencyKey: "pay-all" })
    );
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "240.00", userId: tenant.ownerUser.id, idempotencyKey: "pay-all" })
    );

    const entries = await prisma.commissionEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].baseAmount.toString()).toBe("180");
    expect(entries[0].generatedAmount.toString()).toBe("90");
  });

  it("libera comissao proporcional em pagamentos parciais sem ultrapassar o gerado", async () => {
    const tenant = await seedTenant("c");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, type: "PERCENTAGE", value: "20" })
    );
    await addDoneService({ barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, serviceId: tenant.service.id, executorId: tenant.barber.id });

    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "100.00", userId: tenant.ownerUser.id })
    );
    expect((await prisma.commissionEntry.findFirstOrThrow()).releasedAmount.toString()).toBe("20");

    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "CREDIT", amount: "100.00", userId: tenant.ownerUser.id })
    );
    const entry = await prisma.commissionEntry.findFirstOrThrow();
    expect(entry.generatedAmount.toString()).toBe("40");
    expect(entry.releasedAmount.toString()).toBe("40");
    expect(entry.status).toBe("RELEASED");
  });

  it("estorno reduz liberado, registra reversao e preserva historico", async () => {
    const tenant = await seedTenant("d");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, type: "PERCENTAGE", value: "20" })
    );
    await addDoneService({ barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, serviceId: tenant.service.id, executorId: tenant.barber.id });
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "200.00", userId: tenant.ownerUser.id })
    );
    const payment = await prisma.payment.findFirstOrThrow({ where: { comandaId: tenant.comanda.id, status: "CONFIRMED" } });

    await prisma.$transaction((tx) =>
      refundPayment(tx, { barbershopId: tenant.shop.id, paymentId: payment.id, amount: "100.00", reason: "Estorno parcial", userId: tenant.ownerUser.id })
    );

    const entry = await prisma.commissionEntry.findFirstOrThrow();
    const reversal = await prisma.commissionAdjustment.findFirstOrThrow({ where: { type: "REVERSAL" } });
    expect(entry.generatedAmount.toString()).toBe("40");
    expect(entry.releasedAmount.toString()).toBe("20");
    expect(entry.reversedAmount.toString()).toBe("20");
    expect(reversal.amount.toString()).toBe("-20");
  });

  it("fecha periodo, marca como pago e impede pagamento pelo proprio profissional", async () => {
    const tenant = await seedTenant("e");
    await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, { barbershopId: tenant.shop.id, type: "FIXED_VALUE", value: "30.00" })
    );
    await addDoneService({ barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, serviceId: tenant.service.id, executorId: tenant.barber.id });
    await prisma.$transaction((tx) =>
      registerPayment(tx, { barbershopId: tenant.shop.id, comandaId: tenant.comanda.id, method: "PIX", amount: "200.00", userId: tenant.ownerUser.id })
    );
    await prisma.$transaction((tx) => closeComanda(tx, tenant.shop.id, tenant.comanda.id));

    let period = await prisma.commissionPeriod.findFirstOrThrow();
    await prisma.$transaction(async (tx) => {
      const { closeCommissionPeriod } = await import("@/lib/operations/commissions");
      await closeCommissionPeriod(tx, { barbershopId: tenant.shop.id, memberId: tenant.barber.id, competence: period.competence, userId: tenant.ownerUser.id });
    });
    period = await prisma.commissionPeriod.findFirstOrThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        const { payCommissionPeriod } = await import("@/lib/operations/commissions");
        await payCommissionPeriod(tx, { barbershopId: tenant.shop.id, periodId: period.id, paidByMemberId: tenant.barber.id, userId: tenant.ownerUser.id });
      })
    ).rejects.toThrow("propria comissao");

    await prisma.$transaction(async (tx) => {
      const { payCommissionPeriod } = await import("@/lib/operations/commissions");
      await payCommissionPeriod(tx, { barbershopId: tenant.shop.id, periodId: period.id, paidByMemberId: tenant.manager.id, userId: tenant.ownerUser.id });
    });
    const paid = await prisma.commissionPeriod.findFirstOrThrow();
    expect(paid.status).toBe("PAID");
    expect(paid.balanceAmount.toString()).toBe("0");
  });
});
