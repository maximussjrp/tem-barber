/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  ComandaItemStatus,
  ComandaItemType,
  CommissionConfigType,
  PaymentMethod,
  CommissionEntryStatus,
} from "@prisma/client";
import { addServiceItem, recalculateComandaTotals } from "@/lib/operations/comandas";
import {
  generateCommissionsForComanda,
  upsertCommissionConfig,
  validateCommissionConfigId,
} from "@/lib/operations/commissions";
import { closeComanda, registerPayment } from "@/lib/operations/payments";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import {
  operationErrorResponse,
  SANITIZED_OPERATION_ERROR_MESSAGE,
} from "@/lib/operations/responses";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration = (() => {
  if (!testDatabaseUrl) return false;
  try {
    const url = new URL(testDatabaseUrl);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^(match_barber_test|tem_barber_test)(?:_[a-z0-9_]+)?$/i.test(url.pathname.slice(1)) &&
      !/prod/i.test(url.pathname)
    );
  } catch {
    return false;
  }
})();

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "commission_advance_audits",
      "commission_advance_reversals",
      "commission_payouts",
      "commission_cycle_adjustments",
      "commission_advances",
      "commission_payable_items",
      "commission_cycles",
      "commission_entries",
      "commission_adjustments",
      "commission_periods",
      "commission_configs",
      "service_commission_rules",
      "career_levels",
      "financial_entry_allocations",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "stock_movements",
      "comanda_items",
      "comandas",
      "appointment_services",
      "appointments",
      "barber_services",
      "products",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

async function seedTenant(label: string) {
  const rand = Math.floor(Math.random() * 899999 + 100000);
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `fk-test-${label.toLowerCase()}-${rand}-${Date.now()}`,
      phone: `119${rand}01`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });

  await bootstrapFinancialPlan(prisma, shop.id);

  const ownerUser = await prisma.user.create({
    data: { name: `Owner ${label}`, phone: `119${rand}02` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barber ${label}`, phone: `119${rand}03` },
  });

  const owner = await prisma.barbershopMember.create({
    data: {
      barbershopId: shop.id,
      userId: ownerUser.id,
      role: "OWNER",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const barber = await prisma.barbershopMember.create({
    data: {
      barbershopId: shop.id,
      userId: barberUser.id,
      role: "BARBER",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Cabelo", slug: `cabelo-${label.toLowerCase()}-${rand}` },
  });

  const service = await prisma.service.create({
    data: {
      barbershopId: shop.id,
      categoryId: category.id,
      name: "Corte Cabelo",
      price: "35.00",
      durationMin: 30,
    },
  });

  await prisma.barberService.create({
    data: { barberId: barber.id, serviceId: service.id },
  });

  return { shop, owner, barber, category, service };
}

describeIf("Commission Config FK Incident & Integrity - Real PostgreSQL Tests", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Scenario 1: Commission from valid CommissionConfig populates configId matching commission_configs(id)", async () => {
    const { shop, barber, service } = await seedTenant("S1");

    // Create a 50% commission config on member level
    const cfg = await upsertCommissionConfig(prisma, {
      barbershopId: shop.id,
      memberId: barber.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 50,
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 1" },
    });

    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    // Mark done
    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Generate commission
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));

    const entry = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });

    expect(entry).not.toBeNull();
    expect(entry!.configId).toBe(cfg.id);
    expect(Number(entry!.generatedAmount)).toBe(17.5); // 50% of 35.00
  });

  it("Scenario 2: Commission from ServiceCommissionRule (SERVICE_CAREER_LEVEL) assigns configId = null and avoids FK violation", async () => {
    const { shop, barber, service } = await seedTenant("S2");

    // Create career level and matrix rule
    const careerLevel = await prisma.careerLevel.create({
      data: {
        barbershopId: shop.id,
        name: "Senior",
        sortOrder: 1,
        active: true,
      },
    });

    await prisma.barbershopMember.update({
      where: { id: barber.id },
      data: { careerLevelId: careerLevel.id },
    });

    const matrixRule = await prisma.serviceCommissionRule.create({
      data: {
        barbershopId: shop.id,
        serviceId: service.id,
        careerLevelId: careerLevel.id,
        type: CommissionConfigType.PERCENTAGE,
        commissionRate: "45.00",
        active: true,
      },
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 2" },
    });

    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Generate commissions - should resolve SERVICE_CAREER_LEVEL
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));

    const entry = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });

    expect(entry).not.toBeNull();
    // Must be NULL because matrixRule.id is from service_commission_rules, NOT commission_configs
    expect(entry!.configId).toBeNull();
    const snap = entry!.configSnapshot as any;
    expect(snap.origin).toBe("SERVICE_CAREER_LEVEL");
    expect(snap.serviceCommissionRuleId).toBe(matrixRule.id);
    expect(Number(entry!.generatedAmount)).toBe(15.75); // 45% of 35.00
  });

  it("Scenario 3: Commission from CareerLevel default assigns configId = null", async () => {
    const { shop, barber, service } = await seedTenant("S3");

    const careerLevel = await prisma.careerLevel.create({
      data: {
        barbershopId: shop.id,
        name: "Pleno",
        sortOrder: 1,
        defaultCommissionRate: "30.00",
        active: true,
      },
    });

    await prisma.barbershopMember.update({
      where: { id: barber.id },
      data: { careerLevelId: careerLevel.id },
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 3" },
    });

    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));

    const entry = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });

    expect(entry).not.toBeNull();
    expect(entry!.configId).toBeNull();
    const snap = entry!.configSnapshot as any;
    expect(snap.origin).toBe("CAREER_LEVEL_DEFAULT");
    expect(snap.careerLevelId).toBe(careerLevel.id);
    expect(Number(entry!.generatedAmount)).toBe(10.5); // 30% of 35.00
  });

  it("Scenario 4: Reproduction of Production Incident - R$ 35 comanda with frozen non-existent configSnapshot ID succeeds and finalizes comanda cleanly", async () => {
    const { shop, barber, service, owner } = await seedTenant("PROD-INCIDENT");

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shop.id,
        customerName: "Cliente Producao",
      },
    });

    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date("2026-10-09T22:10:25.191Z") },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // In production, an existing commission entry had config_id: null and a snapshot with an id that is NOT in commission_configs
    const incidentNonExistentConfigId = "e8540155-470e-4b8c-ae3e-7a277dad2a6f";
    const existingEntry = await prisma.commissionEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item.id,
        memberId: barber.id,
        configId: null, // As observed in production
        configSnapshot: {
          id: incidentNonExistentConfigId,
          configId: incidentNonExistentConfigId,
          origin: "MEMBER_SERVICE",
          type: "PERCENTAGE",
          value: "40",
          scopeKey: `member:${barber.id}:service:${service.id}`,
        },
        baseAmount: "35.00",
        generatedAmount: "14.00",
        competence: "2026-10",
        type: "SERVICE",
        status: CommissionEntryStatus.GENERATED,
      },
    });

    // Verify that e854... does NOT exist in commission_configs table
    const countConfigs = await prisma.commissionConfig.count({
      where: { id: incidentNonExistentConfigId },
    });
    expect(countConfigs).toBe(0);

    // Operator registers Pix payment of R$ 35.00 to finalize
    const paymentResult = await prisma.$transaction(async (tx) => {
      const payResult = await registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
      });

      const closed = await closeComanda(tx, shop.id, comanda.id);
      return { payResult, closed };
    });

    expect(paymentResult.closed.status).toBe("CLOSED");
    expect(Number(paymentResult.closed.paidTotal)).toBe(35.0);
    expect(Number(paymentResult.closed.remainingTotal)).toBe(0.0);

    // Verify the commission entry was updated without throwing FK violation!
    const updatedEntry = await prisma.commissionEntry.findUnique({
      where: { id: existingEntry.id },
    });

    expect(updatedEntry).not.toBeNull();
    // configId MUST remain null because incidentNonExistentConfigId is not in commission_configs
    expect(updatedEntry!.configId).toBeNull();
    // Frozen snapshot must be preserved
    const snap = updatedEntry!.configSnapshot as any;
    expect(snap.value).toBe("40");
    // Generated amount must be 14.00 (40% of 35.00)
    expect(Number(updatedEntry!.generatedAmount)).toBe(14.0);
    // Since comanda was closed, release sync marked it RELEASED
    expect(updatedEntry!.status).toBe(CommissionEntryStatus.RELEASED);
    expect(Number(updatedEntry!.releasedAmount)).toBe(14.0);
  });

  it("Scenario 5: Historical CommissionConfig deleted from DB recalculates with configId = null and preserves rate", async () => {
    const { shop, barber, service, owner } = await seedTenant("S5");

    // Create a config
    const cfg = await upsertCommissionConfig(prisma, {
      barbershopId: shop.id,
      memberId: barber.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 60,
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 5" },
    });
    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));

    // Entry has configId = cfg.id
    const entryBefore = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });
    expect(entryBefore!.configId).toBe(cfg.id);

    // Now delete the CommissionConfig row from the database
    await prisma.commissionConfig.delete({
      where: { id: cfg.id },
    });

    // Finalize comanda with Pix payment
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
      });
      await closeComanda(tx, shop.id, comanda.id);
    });

    // After recalculation/release, entry must not have broken FK; configId is null, 60% preserved!
    const entryAfter = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });
    expect(entryAfter!.configId).toBeNull();
    expect(Number(entryAfter!.generatedAmount)).toBe(21.0); // 60% of 35.00 preserved!
  });

  it("Scenario 6: Reprocessing comanda multiple times does not corrupt configId or trigger FK issues", async () => {
    const { shop, barber, service } = await seedTenant("S6");

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 6" },
    });
    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Create entry with non-existent config id
    await prisma.commissionEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item.id,
        memberId: barber.id,
        configId: null,
        configSnapshot: {
          id: "fake-legacy-id-12345",
          configId: "fake-legacy-id-12345",
          origin: "MEMBER_SERVICE",
          type: "PERCENTAGE",
          value: "50",
        },
        baseAmount: "35.00",
        generatedAmount: "17.50",
        competence: "2026-10",
        type: "SERVICE",
        status: CommissionEntryStatus.GENERATED,
      },
    });

    // Run generateCommissionsForComanda multiple times
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));
    }

    const entry = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });
    expect(entry!.configId).toBeNull();
    expect(Number(entry!.generatedAmount)).toBe(17.5);
  });

  it("Scenario 7: Atomic rollback when unexpected error occurs prevents partial payments or entries", async () => {
    const { shop, barber, service, owner } = await seedTenant("S7");

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 7" },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Simulate an atomic transaction failure
    await expect(
      prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: PaymentMethod.PIX,
          amount: "35.00",
          userId: owner.userId,
        });

        // Forced failure
        throw new Error("Simulation failure during checkout");
      })
    ).rejects.toThrow("Simulation failure during checkout");

    // Assert that payment was rolled back completely
    const paymentsCount = await prisma.payment.count({
      where: { comandaId: comanda.id },
    });
    expect(paymentsCount).toBe(0);

    const comandaAfter = await prisma.comanda.findUnique({
      where: { id: comanda.id },
    });
    expect(Number(comandaAfter!.paidTotal)).toBe(0);
    expect(comandaAfter!.status).toBe("OPEN");
  });

  it("Scenario 8: Idempotent replay with same idempotency key succeeds cleanly", async () => {
    const { shop, barber, service, owner } = await seedTenant("S8");

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 8" },
    });
    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    const idempotencyKey = "test-idempotency-key-s8";

    // First call
    const res1 = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
        idempotencyKey,
      })
    );

    // Second call with same idempotency key
    const res2 = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
        idempotencyKey,
      })
    );

    expect(res1.id).toBe(res2.id);

    const payments = await prisma.payment.findMany({
      where: { comandaId: comanda.id },
    });
    expect(payments.length).toBe(1);
  });

  it("Scenario 9: Multi-tenant boundary - candidate config from another shop is rejected", async () => {
    const tenantA = await seedTenant("TenantA");
    const tenantB = await seedTenant("TenantB");

    // Create config in tenant B
    const cfgB = await upsertCommissionConfig(prisma, {
      barbershopId: tenantB.shop.id,
      memberId: tenantB.barber.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 70,
    });

    // Check with tenant A
    const validated = await prisma.$transaction((tx) =>
      validateCommissionConfigId(tx, tenantA.shop.id, cfgB.id)
    );
    expect(validated).toBeNull();
  });

  it("Scenario 10: Preservation of paid/released commission entries and financial entries", async () => {
    const { shop, barber, service, owner } = await seedTenant("S10");

    await upsertCommissionConfig(prisma, {
      barbershopId: shop.id,
      memberId: barber.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 50,
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 10" },
    });
    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Pay and close comanda
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
      });
      await closeComanda(tx, shop.id, comanda.id);
    });

    const finEntries = await prisma.financialEntry.findMany({
      where: { barbershopId: shop.id },
    });
    expect(finEntries.length).toBeGreaterThan(0);

    const commEntries = await prisma.commissionEntry.findMany({
      where: { barbershopId: shop.id },
    });
    expect(commEntries.length).toBe(1);
    expect(commEntries[0].status).toBe(CommissionEntryStatus.RELEASED);
  });

  it("Scenario 11: UX1.1 & UX1.2 Regressions - Backdated payment with commission generation operates seamlessly", async () => {
    const { shop, barber, service, owner } = await seedTenant("S11");

    await upsertCommissionConfig(prisma, {
      barbershopId: shop.id,
      memberId: barber.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 50,
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: shop.id, customerName: "Cliente 11" },
    });
    const comandaWithItem = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        serviceId: service.id,
        executorId: barber.id,
      })
    );
    const item = comandaWithItem.items[0];

    await prisma.comandaItem.update({
      where: { id: item.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date("2026-10-10T15:00:00Z") },
    });
    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, shop.id, comanda.id));

    // Register backdated payment (UX1.2 feature)
    const backdatedPaidAt = "2026-10-10T15:00:00.000Z";
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: PaymentMethod.PIX,
        amount: "35.00",
        userId: owner.userId,
        paidAt: backdatedPaidAt,
      });
      await closeComanda(tx, shop.id, comanda.id);
    });

    const payment = await prisma.payment.findFirst({
      where: { comandaId: comanda.id },
    });
    expect(payment!.paidAt.toISOString()).toBe(backdatedPaidAt);

    const entry = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item.id },
    });
    expect(entry!.status).toBe(CommissionEntryStatus.RELEASED);
  });

  it("Scenario 12: Error response sanitization integration - raw Prisma error masked with HTTP 500", async () => {
    await seedTenant("S12");

    // Intentionally trigger a Prisma error by executing invalid raw SQL
    let caughtError: unknown;
    try {
      await prisma.$executeRawUnsafe("SELECT * FROM non_existent_table_triggering_error");
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const resp = operationErrorResponse(caughtError);
    expect(resp.status).toBe(500);

    const body = await resp.json();
    expect(body.error).toBe("INTERNAL_SERVER_ERROR");
    expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
    expect(body.message).not.toContain("non_existent_table");
  });
});
