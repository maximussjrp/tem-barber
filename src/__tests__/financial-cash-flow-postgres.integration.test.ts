import { describe, expect, it, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { getCashFlowReport } from "@/lib/financial/cash-flow";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { toCents } from "@/lib/operations/money";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

function isIsolatedLocalTestDb(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isTestPort = parsed.port === "55439";
    const isTestDb = parsed.pathname === "/match_barber_test";
    return isLocalhost && isTestPort && isTestDb;
  } catch {
    return false;
  }
}

const isSafe = isIsolatedLocalTestDb(TEST_DB_URL);

describe("Financial Cash Flow — PostgreSQL Real Integration Test Suite", () => {
  const shopAId = "fa800000-0000-4000-a000-000000000001";
  const shopBId = "fa800000-0000-4000-a000-000000000002";
  const userId = "fa800000-0000-4000-a000-000000000009";

  beforeEach(async () => {
    if (!isSafe) return;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "financial_entry_allocations",
        "financial_entries",
        "financial_settlement_reversals",
        "financial_settlements",
        "financial_title_events",
        "financial_titles",
        "financial_routines",
        "financial_category_system_mappings",
        "financial_categories",
        "command_payments",
        "comanda_items",
        "comandas",
        "tip_payout_allocations",
        "tip_payout_reversals",
        "tip_payouts",
        "tip_refunds",
        "tip_entries",
        "commission_cycle_adjustments",
        "commission_cycles",
        "club_settlement_members",
        "club_settlements",
        "barbershop_members",
        "users",
        "barbershops"
      CASCADE;
    `);

    // Setup initial shops and users
    await prisma.barbershop.create({
      data: {
        id: shopAId,
        name: "Barbearia Alpha",
        slug: `shop-cf-a-${Date.now()}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua A",
        number: "1",
        neighborhood: "Bairro A",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.barbershop.create({
      data: {
        id: shopBId,
        name: "Barbearia Beta",
        slug: `shop-cf-b-${Date.now()}`,
        phone: "11988888888",
        zipCode: "00000000",
        street: "Rua B",
        number: "2",
        neighborhood: "Bairro B",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        name: "Admin User",
        email: "admin@test.com",
        phone: "11999999999",
      },
    });

    await bootstrapFinancialPlan(prisma, shopAId);
    await bootstrapFinancialPlan(prisma, shopBId);
  });

  it("A. Valida isolamento estrito entre Tenant A e Tenant B", async () => {
    if (!isSafe) return;

    const servCatA = await prisma.financialCategory.findFirstOrThrow({
      where: { barbershopId: shopAId, code: "01.01" },
    });
    const servCatB = await prisma.financialCategory.findFirstOrThrow({
      where: { barbershopId: shopBId, code: "01.01" },
    });

    // Cria título em Shop A
    await prisma.financialTitle.create({
      data: {
        barbershopId: shopAId,
        categoryId: servCatA.id,
        kind: "RECEIVABLE",
        title: "Recebível Alpha",
        originalAmount: 500,
        dueOn: new Date("2026-06-15T00:00:00.000Z"),
        issuedOn: new Date("2026-06-01T00:00:00.000Z"),
        createdById: userId,
      },
    });

    // Cria título em Shop B
    await prisma.financialTitle.create({
      data: {
        barbershopId: shopBId,
        categoryId: servCatB.id,
        kind: "RECEIVABLE",
        title: "Recebível Beta",
        originalAmount: 900,
        dueOn: new Date("2026-06-15T00:00:00.000Z"),
        issuedOn: new Date("2026-06-01T00:00:00.000Z"),
        createdById: userId,
      },
    });

    const reportA = await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    const reportB = await getCashFlowReport({
      barbershopId: shopBId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(reportA.projected.receivable).toBe("500.00");
    expect(reportB.projected.receivable).toBe("900.00");
  });

  it("B. Payment real + FinancialEntry correspondente não duplicam caixa realizado", async () => {
    if (!isSafe) return;

    const servCat = await prisma.financialCategory.findFirstOrThrow({
      where: { barbershopId: shopAId, code: "01.01" },
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        customerName: "Cliente Teste",
        total: 100,
        paidTotal: 100,
        remainingTotal: 0,
        status: "CLOSED",
      },
    });

    const payment = await prisma.payment.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        amount: 100,
        method: "PIX",
        paidAt: new Date("2026-06-10T14:00:00.000Z"),
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        type: "COMMAND_REVENUE",
        amount: 100,
        category: "RECEITA_SERVICO",
        entryDate: new Date("2026-06-10T14:00:00.000Z"),
        description: "Comanda 100",
        paymentId: payment.id,
        comandaId: comanda.id,
      },
    });

    await prisma.financialEntryAllocation.create({
      data: {
        barbershopId: shopAId,
        financialEntryId: entry.id,
        financialCategoryId: servCat.id,
        allocatedAmount: 100,
      },
    });

    const report = await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("100.00");
    expect(report.realized.net).toBe("100.00");
  });

  it("C. CUSTOMER_CREDIT não entra como external cash", async () => {
    if (!isSafe) return;

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        customerName: "Cliente Teste",
        total: 80,
        paidTotal: 80,
        remainingTotal: 0,
        status: "CLOSED",
      },
    });

    await prisma.payment.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        amount: 80,
        method: "CUSTOMER_CREDIT",
        paidAt: new Date("2026-06-10T14:00:00.000Z"),
      },
    });

    const report = await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("0.00");
    expect(report.realized.net).toBe("0.00");
  });

  it("D. FinancialTitle com settlement parcial projeta apenas outstanding", async () => {
    if (!isSafe) return;

    const catAluguel = await prisma.financialCategory.findFirstOrThrow({
      where: { barbershopId: shopAId, code: "03.01" },
    });

    const title = await prisma.financialTitle.create({
      data: {
        barbershopId: shopAId,
        categoryId: catAluguel.id,
        kind: "PAYABLE",
        title: "Aluguel Junho",
        originalAmount: 1000,
        dueOn: new Date("2026-06-25T00:00:00.000Z"),
        issuedOn: new Date("2026-06-01T00:00:00.000Z"),
        createdById: userId,
      },
    });

    await prisma.financialSettlement.create({
      data: {
        barbershopId: shopAId,
        titleId: title.id,
        principalAmount: 400,
        discountAmount: 0,
        interestAmount: 0,
        fineAmount: 0,
        settledAt: new Date("2026-06-10T10:00:00.000Z"),
        createdById: userId,
        idempotencyKey: "test-settle-1",
      },
    });

    const report = await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.projected.payable).toBe("600.00");
    expect(report.projected.net).toBe("-600.00");
  });

  it("E. FinancialRoutine futura virtual não cria registro FinancialTitle no banco", async () => {
    if (!isSafe) return;

    const catInternet = await prisma.financialCategory.findFirstOrThrow({
      where: { barbershopId: shopAId, code: "03.02" },
    });

    const initialTitleCount = await prisma.financialTitle.count();

    await prisma.financialRoutine.create({
      data: {
        barbershopId: shopAId,
        categoryId: catInternet.id,
        kind: "PAYABLE",
        title: "Internet Fibra",
        amountMode: "FIXED",
        baseAmount: 120,
        dueDay: 15,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        isActive: true,
        createdById: userId,
      },
    });

    const report = await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2027-05-01",
      endDate: "2027-05-31",
    });

    expect(report.projected.payable).toBe("120.00");
    expect(report.forecastMeta.virtualRoutineCount).toBe(1);

    const postTitleCount = await prisma.financialTitle.count();
    expect(postTitleCount).toBe(initialTitleCount); // ZERO writes!
  });

  it("F. getCashFlowReport é 100% READ-ONLY e não altera counts do banco", async () => {
    if (!isSafe) return;

    const beforeCounts = {
      entries: await prisma.financialEntry.count(),
      titles: await prisma.financialTitle.count(),
      allocs: await prisma.financialEntryAllocation.count(),
      settlements: await prisma.financialSettlement.count(),
    };

    await getCashFlowReport({
      barbershopId: shopAId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    const afterCounts = {
      entries: await prisma.financialEntry.count(),
      titles: await prisma.financialTitle.count(),
      allocs: await prisma.financialEntryAllocation.count(),
      settlements: await prisma.financialSettlement.count(),
    };

    expect(afterCounts).toEqual(beforeCounts);
  });
});
