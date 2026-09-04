/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  ComandaItemStatus,
  ComandaItemType,
  CommissionCycleAdjustmentType,
  CommissionCycleStatus,
  CommissionDisbursementMethod,
  CommissionEntryStatus,
  CommissionPayableType,
  Prisma,
  UserRole,
} from "@prisma/client";
import { NextRequest } from "next/server";
import prismaDefault from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";
import { GET as getFinancialSummary } from "@/app/api/admin/financial/summary/route";
import { addServiceItem, recalculateComandaTotals } from "@/lib/operations/comandas";
import { closeComanda, refundPayment, registerPayment } from "@/lib/operations/payments";
import {
  CommissionError,
  createCommissionAdvance,
  executeCommissionPayout,
  generateCommissionsForComanda,
  getAuthoritativeCycleBalance,
  syncCommissionReleaseForComanda,
  upsertCommissionConfig,
} from "@/lib/operations/commissions";
import { toCents } from "@/lib/operations/money";

vi.mock("@/lib/api-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-auth")>("@/lib/api-auth");
  return {
    ...actual,
    requireOperationalSession: vi.fn(),
  };
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439|5434/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
const mockedRequireOperationalSession = vi.mocked(requireOperationalSession);

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
      "club_benefit_usages",
      "club_point_entries",
      "customer_club_subscriptions",
      "club_subscription_payments",
      "club_settlement_members",
      "club_settlements",
      "club_plan_benefits",
      "club_plans",
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
  const barbershop = await prisma.barbershop.create({
    data: {
      name: `C12.2 Shop ${label}`,
      slug: `c12-2-${label}-${Date.now()}`,
      phone: `11988${label.padStart(6, "0").slice(-6)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  const ownerUser = await prisma.user.create({
    data: {
      name: `Owner ${label}`,
      email: `owner-${label}-${Date.now()}@test.local`,
      phone: `11977${label.padStart(6, "0").slice(-6)}`,
      role: UserRole.USER,
    },
  });
  const barberUser = await prisma.user.create({
    data: {
      name: `Barber ${label}`,
      email: `barber-${label}-${Date.now()}@test.local`,
      phone: `11966${label.padStart(6, "0").slice(-6)}`,
      role: UserRole.USER,
    },
  });
  const secondBarberUser = await prisma.user.create({
    data: {
      name: `Second Barber ${label}`,
      email: `second-barber-${label}-${Date.now()}@test.local`,
      phone: `11955${label.padStart(6, "0").slice(-6)}`,
      role: UserRole.USER,
    },
  });
  const customer = await prisma.user.create({
    data: {
      name: `Customer ${label}`,
      email: `customer-${label}-${Date.now()}@test.local`,
      phone: `11944${label.padStart(6, "0").slice(-6)}`,
      role: UserRole.USER,
    },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: barbershop.id, userId: ownerUser.id, role: "OWNER", isActive: true },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: barbershop.id, userId: barberUser.id, role: "BARBER", isActive: true },
  });
  const secondBarber = await prisma.barbershopMember.create({
    data: { barbershopId: barbershop.id, userId: secondBarberUser.id, role: "BARBER", isActive: true },
  });
  await prisma.cashSession.create({
    data: {
      barbershopId: barbershop.id,
      openedById: ownerUser.id,
      openingAmount: "0.00",
      status: "OPEN",
    },
  });
  const category = await prisma.category.create({
    data: { barbershopId: barbershop.id, name: `Servicos ${label}`, slug: `servicos-${label}-${Date.now()}` },
  });
  const service = await prisma.service.create({
    data: { barbershopId: barbershop.id, categoryId: category.id, name: `Corte ${label}`, price: "100.00", durationMin: 30 },
  });
  await prisma.barberService.createMany({
    data: [
      { barberId: barber.id, serviceId: service.id },
      { barberId: secondBarber.id, serviceId: service.id },
    ],
  });
  await prisma.$transaction((tx) =>
    upsertCommissionConfig(tx, {
      barbershopId: barbershop.id,
      type: "PERCENTAGE",
      value: "100",
    })
  );
  return { barbershop, ownerUser, owner, barber, secondBarber, customer, service };
}

function summaryRequest(date: string) {
  return new NextRequest(`http://localhost/api/admin/financial/summary?startDate=${date}&endDate=${date}`);
}

async function readCommissionExpense(barbershopId: string, userId: string) {
  mockedRequireOperationalSession.mockResolvedValue({
    error: null,
    data: { userId, role: "OWNER", memberId: "owner-member", barbershopId },
  } as any);
  const today = new Date().toISOString().slice(0, 10);
  const response = await getFinancialSummary(summaryRequest(today));
  expect(response.status).toBe(200);
  const body = await response.json();
  return Number(body.totals.releasedCommissions);
}

async function createDoneServiceComanda(input: {
  barbershopId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  serviceId: string;
  executorId: string;
}) {
  const comanda = await prisma.comanda.create({
    data: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      customerName: input.customerName ?? "Cliente C12.2",
      customerPhone: input.customerPhone ?? "11999999999",
      status: "OPEN",
    },
  });
  const updated = await prisma.$transaction((tx) =>
    addServiceItem(tx, {
      barbershopId: input.barbershopId,
      comandaId: comanda.id,
      serviceId: input.serviceId,
      executorId: input.executorId,
    })
  );
  const item = updated.items[0];
  await prisma.comandaItem.update({
    where: { id: item.id },
    data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
  });
  await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));
  return { comanda, itemId: item.id };
}

async function cancelItemAndSync(barbershopId: string, comandaId: string, itemId: string) {
  await prisma.comandaItem.update({
    where: { id: itemId },
    data: { status: ComandaItemStatus.CANCELLED, cancelledAt: new Date() },
  });
  await prisma.comanda.update({
    where: { id: comandaId },
    data: { commissionRevision: { increment: 1 } },
  });
  await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaId));
  await prisma.$transaction((tx) => syncCommissionReleaseForComanda(tx, barbershopId, comandaId, "C12.2 cancel item proof"));
}

describeIf("C12.2 final gate accounting and cancellation proofs", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = prismaDefault as PrismaClient;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("proves payout and advance payouts do not double operating commission expense through financial summary", async () => {
    const tenant = await seedTenant("pnl001");
    const { comanda } = await createDoneServiceComanda({
      barbershopId: tenant.barbershop.id,
      serviceId: tenant.service.id,
      executorId: tenant.barber.id,
    });
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: tenant.barbershop.id,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId: tenant.ownerUser.id,
      })
    );

    const pnlBefore = await readCommissionExpense(tenant.barbershop.id, tenant.ownerUser.id);
    expect(pnlBefore).toBe(100);

    const payout = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId: tenant.barbershop.id,
        memberId: tenant.barber.id,
        paymentMethod: CommissionDisbursementMethod.CASH,
        idempotencyKey: "c12-2-payout-100",
        createdById: tenant.ownerUser.id,
      })
    );
    expect(toCents(payout.payout.amount)).toBe(10000);
    expect(await prisma.financialEntry.count({ where: { commissionPayoutId: payout.payout.id, type: "COMMISSION_PAYOUT" } })).toBe(1);
    expect(toCents((await prisma.cashMovement.findFirstOrThrow({ where: { commissionPayoutId: payout.payout.id } })).amount)).toBe(-10000);

    const pnlAfter = await readCommissionExpense(tenant.barbershop.id, tenant.ownerUser.id);
    expect(pnlAfter).toBe(100);

    await truncateDatabase();
    const tenantAdvance = await seedTenant("pnl002");
    const { comanda: comandaAdvance } = await createDoneServiceComanda({
      barbershopId: tenantAdvance.barbershop.id,
      serviceId: tenantAdvance.service.id,
      executorId: tenantAdvance.barber.id,
    });
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: tenantAdvance.barbershop.id,
        comandaId: comandaAdvance.id,
        method: "PIX",
        amount: "100.00",
        userId: tenantAdvance.ownerUser.id,
      })
    );
    await prisma.$transaction((tx) =>
      createCommissionAdvance(tx, {
        barbershopId: tenantAdvance.barbershop.id,
        memberId: tenantAdvance.barber.id,
        amount: "40.00",
        paymentMethod: CommissionDisbursementMethod.CASH,
        idempotencyKey: "c12-2-advance-40",
        createdById: tenantAdvance.ownerUser.id,
      })
    );
    const payoutAfterAdvance = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId: tenantAdvance.barbershop.id,
        memberId: tenantAdvance.barber.id,
        paymentMethod: CommissionDisbursementMethod.CASH,
        idempotencyKey: "c12-2-payout-60",
        createdById: tenantAdvance.ownerUser.id,
      })
    );
    expect(toCents(payoutAfterAdvance.payout.amount)).toBe(6000);
    expect(await readCommissionExpense(tenantAdvance.barbershop.id, tenantAdvance.ownerUser.id)).toBe(100);
  });

  it("classifies covered Club INCLUDED_SERVICE as not creating normal CommissionEntry", async () => {
    const tenant = await seedTenant("club01");
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: tenant.barbershop.id,
        name: "Plano C12.2",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
        isActive: true,
      },
    });
    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: tenant.service.id,
        includedQty: 1,
      },
    });
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: tenant.barbershop.id,
        customerId: tenant.customer.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
        gracePeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: tenant.barbershop.id,
        customerId: tenant.customer.id,
        customerName: tenant.customer.name,
        customerPhone: tenant.customer.phone,
        status: "OPEN",
      },
    });
    const updated = await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: tenant.barbershop.id,
        comandaId: comanda.id,
        serviceId: tenant.service.id,
        executorId: tenant.barber.id,
        clubBenefitRequested: true,
        requestedClubPlanBenefitId: benefit.id,
      })
    );
    const itemId = updated.items[0].id;
    await prisma.comandaItem.update({ where: { id: itemId }, data: { status: "DONE", completedAt: new Date() } });
    await prisma.$transaction((tx) => closeComanda(tx, tenant.barbershop.id, comanda.id));

    expect(await prisma.clubBenefitUsage.count({ where: { comandaItemId: itemId, status: "APPLIED" } })).toBe(1);
    expect(await prisma.commissionEntry.count({ where: { comandaItemId: itemId } })).toBe(0);
  });

  it("proves preserve-entry cancellation economics for unreleased, released, partial, post-paid, rerun, and executor guard", async () => {
    const unreleasedTenant = await seedTenant("can001");
    const unreleased = await createDoneServiceComanda({
      barbershopId: unreleasedTenant.barbershop.id,
      serviceId: unreleasedTenant.service.id,
      executorId: unreleasedTenant.barber.id,
    });
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, unreleasedTenant.barbershop.id, unreleased.comanda.id));
    await cancelItemAndSync(unreleasedTenant.barbershop.id, unreleased.comanda.id, unreleased.itemId);
    expect(await prisma.commissionPayableItem.count({ where: { sourceComandaId: unreleased.comanda.id, type: CommissionPayableType.REVERSAL } })).toBe(0);
    expect(await prisma.commissionPayableItem.count({ where: { sourceComandaId: unreleased.comanda.id } })).toBe(0);

    await truncateDatabase();
    const releasedTenant = await seedTenant("can002");
    const released = await createDoneServiceComanda({
      barbershopId: releasedTenant.barbershop.id,
      serviceId: releasedTenant.service.id,
      executorId: releasedTenant.barber.id,
    });
    const releasedPaymentResult = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: releasedTenant.barbershop.id,
        comandaId: released.comanda.id,
        method: "PIX",
        amount: "40.00",
        userId: releasedTenant.ownerUser.id,
      })
    );
    await prisma.$transaction((tx) =>
      refundPayment(tx, {
        barbershopId: releasedTenant.barbershop.id,
        comandaId: released.comanda.id,
        paymentId: releasedPaymentResult.payments[0].id,
        amount: "40.00",
        reason: "C12.2 full release refund",
        userId: releasedTenant.ownerUser.id,
      })
    );
    await cancelItemAndSync(releasedTenant.barbershop.id, released.comanda.id, released.itemId);
    const fullReversals = await prisma.commissionPayableItem.findMany({
      where: { sourceComandaId: released.comanda.id, type: CommissionPayableType.REVERSAL },
    });
    expect(fullReversals).toHaveLength(1);
    expect(toCents(fullReversals[0].amount)).toBe(4000);
    const fullEntry = await prisma.commissionEntry.findFirstOrThrow({ where: { comandaItemId: released.itemId } });
    expect(fullEntry.status).toBe(CommissionEntryStatus.REVERSED);
    const fullCycleBalance = await getAuthoritativeCycleBalance(prisma, fullReversals[0].cycleId);
    expect(fullCycleBalance.remainingBalanceCents).toBe(0);
    const reversalCountBeforeRerun = await prisma.commissionPayableItem.count({ where: { sourceComandaId: released.comanda.id, type: CommissionPayableType.REVERSAL } });
    await prisma.$transaction((tx) => syncCommissionReleaseForComanda(tx, releasedTenant.barbershop.id, released.comanda.id, "C12.2 rerun"));
    const reversalCountAfterRerun = await prisma.commissionPayableItem.count({ where: { sourceComandaId: released.comanda.id, type: CommissionPayableType.REVERSAL } });
    expect(reversalCountAfterRerun - reversalCountBeforeRerun).toBe(0);

    await truncateDatabase();
    const partialTenant = await seedTenant("can003");
    const partial = await createDoneServiceComanda({
      barbershopId: partialTenant.barbershop.id,
      serviceId: partialTenant.service.id,
      executorId: partialTenant.barber.id,
    });
    const partialPaymentResult = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: partialTenant.barbershop.id,
        comandaId: partial.comanda.id,
        method: "PIX",
        amount: "20.00",
        userId: partialTenant.ownerUser.id,
      })
    );
    await prisma.$transaction((tx) =>
      refundPayment(tx, {
        barbershopId: partialTenant.barbershop.id,
        comandaId: partial.comanda.id,
        paymentId: partialPaymentResult.payments[0].id,
        amount: "20.00",
        reason: "C12.2 partial release refund",
        userId: partialTenant.ownerUser.id,
      })
    );
    await cancelItemAndSync(partialTenant.barbershop.id, partial.comanda.id, partial.itemId);
    const partialReversal = await prisma.commissionPayableItem.findFirstOrThrow({
      where: { sourceComandaId: partial.comanda.id, type: CommissionPayableType.REVERSAL },
    });
    expect(toCents(partialReversal.amount)).toBe(2000);

    await truncateDatabase();
    const paidTenant = await seedTenant("can004");
    const paid = await createDoneServiceComanda({
      barbershopId: paidTenant.barbershop.id,
      serviceId: paidTenant.service.id,
      executorId: paidTenant.barber.id,
    });
    const paidComanda = await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: paidTenant.barbershop.id,
        comandaId: paid.comanda.id,
        method: "PIX",
        amount: "40.00",
        userId: paidTenant.ownerUser.id,
      })
    );
    const payout = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId: paidTenant.barbershop.id,
        memberId: paidTenant.barber.id,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "c12-2-paid-payout",
        createdById: paidTenant.ownerUser.id,
      })
    );
    await prisma.$transaction((tx) =>
      refundPayment(tx, {
        barbershopId: paidTenant.barbershop.id,
        comandaId: paid.comanda.id,
        paymentId: paidComanda.payments[0].id,
        amount: "40.00",
        reason: "C12.2 post-paid refund",
        userId: paidTenant.ownerUser.id,
      })
    );
    const paidCycleAfter = await prisma.commissionCycle.findUniqueOrThrow({ where: { id: payout.paidCycle.id } });
    expect(paidCycleAfter.status).toBe(CommissionCycleStatus.PAID);
    expect(toCents(paidCycleAfter.finalPayoutAmount)).toBe(4000);
    expect(toCents(paidCycleAfter.remainingBalance)).toBe(0);
    const historicalReversals = await prisma.commissionPayableItem.findMany({
      where: { sourceComandaId: paid.comanda.id, type: CommissionPayableType.REVERSAL, isHistoricalCorrection: true },
    });
    expect(historicalReversals).toHaveLength(1);
    expect(toCents(historicalReversals[0].amount)).toBe(4000);
    const routingDebits = await prisma.commissionCycleAdjustment.findMany({
      where: { sourcePayableItemId: historicalReversals[0].id, type: CommissionCycleAdjustmentType.DEBIT },
    });
    expect(routingDebits).toHaveLength(1);
    expect(toCents(routingDebits[0].amount)).toBe(4000);

    await truncateDatabase();
    const guardTenant = await seedTenant("can005");
    const guard = await createDoneServiceComanda({
      barbershopId: guardTenant.barbershop.id,
      serviceId: guardTenant.service.id,
      executorId: guardTenant.barber.id,
    });
    await prisma.$transaction((tx) => generateCommissionsForComanda(tx, guardTenant.barbershop.id, guard.comanda.id));
    await prisma.comandaItem.update({ where: { id: guard.itemId }, data: { executorId: guardTenant.secondBarber.id } });
    await expect(prisma.$transaction((tx) => generateCommissionsForComanda(tx, guardTenant.barbershop.id, guard.comanda.id))).rejects.toMatchObject({
      code: "EXECUTOR_CORRECTION_REQUIRED",
    } satisfies Partial<CommissionError>);
  });
});