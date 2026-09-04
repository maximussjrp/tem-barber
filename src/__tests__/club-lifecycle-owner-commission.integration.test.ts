/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, ClubPaymentStatus, ClubSubscriptionStatus, PaymentMethod } from "@prisma/client";

const { getAdminSessionMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
  requireOperationalSession: async () => {
    const res = await getAdminSessionMock();
    if (res.error) return { error: res.error, data: null };
    const data = res.data;
    if (!data || !data.barbershopId) {
      return {
        error: Response.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
        data: null,
      };
    }
    return { error: null, data };
  },
}));

vi.mock("@/lib/operations/permissions", () => ({
  requireOperationalSession: async () => {
    const res = await getAdminSessionMock();
    if (res.error) return { error: res.error, data: null };
    const data = res.data;
    if (!data || !data.barbershopId) {
      return {
        error: Response.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
        data: null,
      };
    }
    return { error: null, data };
  },
  canManageComandas: () => true,
  forbidden: () => false,
}));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber|localhost|127\.0\.0\.1|5434/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let clubOps: typeof import("@/lib/operations/club");
let commissionOps: typeof import("@/lib/operations/commissions");

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "club_settlement_members",
      "club_settlements",
      "club_point_entries",
      "club_benefit_usages",
      "club_subscription_payments",
      "customer_club_subscriptions",
      "club_plan_benefits",
      "club_plans",
      "commission_entries",
      "commission_periods",
      "barbershop_members",
      "users",
      "barbershops"
    CASCADE;
  `);
}

describeIf("Lote Clube 1.0 — Ciclo, Cobrança, Rateio e Comissão do Dono", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import("@/lib/prisma")).default as unknown as PrismaClient;
    await prisma.$connect();
    clubOps = await import("@/lib/operations/club");
    commissionOps = await import("@/lib/operations/commissions");
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    await truncateDatabase();
    vi.clearAllMocks();
  }, 30000);

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createTestFixtures() {
    const shop = await prisma.barbershop.create({
      data: {
        name: "Barbearia Teste Clube",
        slug: `clube-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        phone: "11999999999",
        zipCode: "00000-000",
        street: "Rua Teste",
        number: "123",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });

    const ownerUser = await prisma.user.create({
      data: { name: "Dono Barbeiro", phone: "11911111111" },
    });
    const ownerMember = await prisma.barbershopMember.create({
      data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
    });

    const barberUser = await prisma.user.create({
      data: { name: "Barbeiro Auxiliar", phone: "11922222222" },
    });
    const barberMember = await prisma.barbershopMember.create({
      data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
    });

    const customer = await prisma.user.create({
      data: { name: "Cliente Assinante", phone: "11933333333" },
    });

    const category = await prisma.category.create({
      data: { barbershopId: shop.id, name: "Serviços", slug: `cat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` },
    });

    const service = await prisma.service.create({
      data: { barbershopId: shop.id, categoryId: category.id, name: "Corte Clube", price: 50.0, durationMin: 30 },
    });

    const clubPlan = await prisma.clubPlan.create({
      data: {
        barbershopId: shop.id,
        name: "Plano Premium R$ 100",
        monthlyPrice: 100.0,
        shopSharePercent: 50.0,
        barberPoolPercent: 50.0,
        isActive: true,
      },
    });

    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: clubPlan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: service.id,
        includedQty: 2,
        pointWeight: 10.0,
      },
    });

    return { shop, ownerUser, ownerMember, barberUser, barberMember, customer, service, clubPlan, benefit };
  }

  describe("1. Status efetivo e vigência da assinatura", () => {
    it("retorna ATIVO se now < currentPeriodEnd", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() + 26 * 24 * 60 * 60 * 1000),
        },
      });

      const eff = clubOps.getEffectiveSubscriptionStatus(sub, now);
      expect(eff).toBe("ACTIVE");
    });

    it("retorna EM CARÊNCIA se now >= currentPeriodEnd e now < gracePeriodEnd", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() - 12 * 60 * 60 * 1000), // ended 12h ago
          gracePeriodEnd: new Date(now.getTime() + 12 * 60 * 60 * 1000), // grace ends in 12h
        },
      });

      const eff = clubOps.getEffectiveSubscriptionStatus(sub, now);
      expect(eff).toBe("GRACE_PERIOD");
    });

    it("retorna VENCIDO (EXPIRED) se now >= gracePeriodEnd", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        },
      });

      const eff = clubOps.getEffectiveSubscriptionStatus(sub, now);
      expect(eff).toBe("EXPIRED");
    });

    it("retorna CANCELED ou SUSPENDED determinísticamente se salvo assim no banco", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();
      const subCanceled = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.CANCELED,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
        },
      });

      expect(clubOps.getEffectiveSubscriptionStatus(subCanceled, now)).toBe("CANCELED");
    });

    it("libera benefício para ATIVO e GRACE_PERIOD, mas bloqueia para EXPIRED", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();

      // Expired subscription
      await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        },
      });

      const activeSearch = await clubOps.getActiveCustomerClubSubscription({
        barbershopId: shop.id,
        customerId: customer.id,
        atDate: now,
      });

      expect(activeSearch).toBeNull();
    });

    it("sincroniza assinaturas expiradas (syncExpiredCustomerClubSubscriptions)", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();

      const sub1 = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() + 12 * 60 * 60 * 1000), // in grace
        },
      });

      const sub2 = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // past grace
        },
      });

      const syncRes = await clubOps.syncExpiredCustomerClubSubscriptions({
        barbershopId: shop.id,
        atDate: now,
      });

      expect(syncRes.movedToGracePeriod).toBe(1);
      expect(syncRes.movedToPastDue).toBe(1);

      const db1 = await prisma.customerClubSubscription.findUnique({ where: { id: sub1.id } });
      const db2 = await prisma.customerClubSubscription.findUnique({ where: { id: sub2.id } });
      expect(db1?.status).toBe(ClubSubscriptionStatus.GRACE_PERIOD);
      expect(db2?.status).toBe(ClubSubscriptionStatus.PAST_DUE);
    });
  });

  describe("2. Pagamento manual do Clube", () => {
    it("usa obrigatoriamente o preço mensal do plano (R$ 100) e rejeita amount divergente", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date();
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          gracePeriodEnd: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
        },
      });

      await expect(
        clubOps.registerManualClubSubscriptionPayment({
          barbershopId: shop.id,
          subscriptionId: sub.id,
          paymentMethod: PaymentMethod.PIX,
          amount: 50.0, // divergent!
        })
      ).rejects.toThrow(/valor do pagamento/i);
    });

    it("calcula competência e renova antecipadamente sem perder dias vigentes", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const now = new Date("2026-07-01T10:00:00Z");
      const currentEnd = new Date("2026-07-20T10:00:00Z");
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date("2026-06-20T10:00:00Z"),
          currentPeriodEnd: currentEnd,
          gracePeriodEnd: new Date("2026-07-21T10:00:00Z"),
        },
      });
      await prisma.clubSubscriptionPayment.create({
        data: {
          barbershopId: shop.id,
          subscriptionId: sub.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          amount: clubPlan.monthlyPrice,
          paymentMethod: PaymentMethod.PIX,
          status: ClubPaymentStatus.PAID,
          competence: "2026-06",
          shopSharePercentSnapshot: clubPlan.shopSharePercent,
          barberPoolPercentSnapshot: clubPlan.barberPoolPercent,
          paidAt: new Date("2026-06-20T10:00:00Z"),
        },
      });

      const res = await clubOps.registerManualClubSubscriptionPayment({
        barbershopId: shop.id,
        subscriptionId: sub.id,
        paymentMethod: PaymentMethod.CREDIT,
        paidAt: now,
      });

      expect(res.payment.competence).toBe("2026-07");
      expect(res.subscription.status).toBe(ClubSubscriptionStatus.ACTIVE);
      // Preserved cycle: cycleStart = 2026-07-20
      expect(res.subscription.currentPeriodStart.toISOString()).toBe(currentEnd.toISOString());
      const expectedEnd = new Date(currentEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(res.subscription.currentPeriodEnd.toISOString()).toBe(expectedEnd.toISOString());
      const expectedGrace = new Date(expectedEnd.getTime() + 1 * 24 * 60 * 60 * 1000);
      expect(res.subscription.gracePeriodEnd.toISOString()).toBe(expectedGrace.toISOString());
    });
  });

  describe("3. Rateio do Clube", () => {
    it("distribui pool proporcionalmente entre barbeiros e ajusta arredondamento", async () => {
      const { shop, ownerMember, barberMember, customer, clubPlan, service } = await createTestFixtures();
      const competence = "2026-07";

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date("2026-07-01"),
          currentPeriodEnd: new Date("2026-07-31"),
          gracePeriodEnd: new Date("2026-08-01"),
        },
      });

      const comanda = await prisma.comanda.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          customerName: customer.name,
          status: "CLOSED",
          total: 0,
          remainingTotal: 0,
        },
      });
      const item1 = await prisma.comandaItem.create({
        data: { barbershopId: shop.id, comandaId: comanda.id, serviceId: service.id, unitPrice: 50.0, total: 50.0, executorId: ownerMember.id, type: "SERVICE", description: "Corte Clube" },
      });
      const item2 = await prisma.comandaItem.create({
        data: { barbershopId: shop.id, comandaId: comanda.id, serviceId: service.id, unitPrice: 50.0, total: 50.0, executorId: barberMember.id, type: "SERVICE", description: "Corte Clube" },
      });

      // Register payment of R$ 100 (50% shop, 50% pool = R$ 50 pool)
      await prisma.clubSubscriptionPayment.create({
        data: {
          barbershopId: shop.id,
          subscriptionId: sub.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          amount: 100.0,
          paymentMethod: PaymentMethod.PIX,
          competence,
          shopSharePercentSnapshot: 50.0,
          barberPoolPercentSnapshot: 50.0,
          paidAt: new Date("2026-07-01"),
        },
      });

      // Barbeiro 1 (ownerMember) = 100 pts, Barbeiro 2 (barberMember) = 50 pts (total 150 pts)
      await prisma.clubPointEntry.create({
        data: {
          barbershopId: shop.id,
          subscriptionId: sub.id,
          comandaItemId: item1.id,
          memberId: ownerMember.id,
          points: 100.0,
          competence,
        },
      });

      await prisma.clubPointEntry.create({
        data: {
          barbershopId: shop.id,
          subscriptionId: sub.id,
          comandaItemId: item2.id,
          memberId: barberMember.id,
          points: 50.0,
          competence,
        },
      });

      const settlement = await clubOps.calculateClubSettlement({
        barbershopId: shop.id,
        competence,
      });

      expect(settlement).not.toBeNull();
      expect(Number(settlement!.totalRevenue)).toBe(100.0);
      expect(Number(settlement!.shopAmount)).toBe(50.0);
      expect(Number(settlement!.barberPoolAmount)).toBe(50.0);

      // Members share: Total pool R$ 50.
      const sumMembers = settlement!.members.reduce((acc, m) => acc + Number(m.amount), 0);
      expect(sumMembers).toBe(50.0);
    });

    it("envia pool para carryOutAmount se totalPoints = 0 sem divisão por zero", async () => {
      const { shop, customer, clubPlan } = await createTestFixtures();
      const competence = "2026-07";

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: ClubSubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date("2026-07-01"),
          currentPeriodEnd: new Date("2026-07-31"),
          gracePeriodEnd: new Date("2026-08-01"),
        },
      });

      await prisma.clubSubscriptionPayment.create({
        data: {
          barbershopId: shop.id,
          subscriptionId: sub.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          amount: 100.0,
          paymentMethod: PaymentMethod.PIX,
          competence,
          shopSharePercentSnapshot: 50.0,
          barberPoolPercentSnapshot: 50.0,
          paidAt: new Date("2026-07-01"),
        },
      });

      const settlement = await clubOps.calculateClubSettlement({
        barbershopId: shop.id,
        competence,
      });

      expect(settlement).not.toBeNull();
      expect(Number(settlement!.totalPoints)).toBe(0);
      expect(Number(settlement!.carryOutAmount)).toBe(50.0);
      expect(settlement!.members.length).toBe(0);
    });
  });

  describe("4. Comissão do Dono (OWNER self-payment)", () => {
    it("permite que OWNER pague sua própria comissão auditando paidById", async () => {
      const { shop, ownerUser, ownerMember, service } = await createTestFixtures();
      const competence = "2026-07";

      const comanda = await prisma.comanda.create({
        data: {
          barbershopId: shop.id,
          customerId: ownerUser.id,
          customerName: ownerUser.name,
          status: "CLOSED",
          total: 150.0,
          remainingTotal: 0,
        },
      });

      const comandaItem = await prisma.comandaItem.create({
        data: {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: service.id,
          unitPrice: 150.0,
          total: 150.0,
          executorId: ownerMember.id,
          type: "SERVICE",
          description: "Corte Clube",
        },
      });

      const cycle = await prisma.commissionCycle.create({
        data: {
          barbershopId: shop.id,
          memberId: ownerMember.id,
          cycleNumber: 1,
          status: "OPEN",
          grossCommission: 150.0,
          adjustmentsTotal: 0,
          advancesTotal: 0,
          finalPayoutAmount: 0,
          remainingBalance: 150.0,
          openedAt: new Date("2026-07-01"),
        },
      });

      const entry = await prisma.commissionEntry.create({
        data: {
          barbershopId: shop.id,
          comandaItemId: comandaItem.id,
          memberId: ownerMember.id,
          competence,
          baseAmount: 150.0,
          generatedAmount: 150.0,
          releasedAmount: 150.0,
          paidAmount: 0,
          status: "RELEASED",
          configSnapshot: { rate: 0.5 },
        },
      });

      await prisma.commissionPayableItem.create({
        data: {
          barbershopId: shop.id,
          cycleId: cycle.id,
          memberId: ownerMember.id,
          entryId: entry.id,
          type: "RELEASE" as any,
          sourceKind: "PAYMENT" as any,
          amount: 150.0,
          eventKey: "club-test-owner-pay",
        },
      });

      const payoutRes = await prisma.$transaction((tx) =>
        commissionOps.executeCommissionPayout(tx, {
          barbershopId: shop.id,
          memberId: ownerMember.id,
          idempotencyKey: "payout-owner-self-test",
          createdById: ownerUser.id,
          paymentMethod: "PIX",
        })
      );

      expect(payoutRes.paidCycle.status).toBe("PAID");
      expect(payoutRes.payout.createdById).toBe(ownerUser.id);
      expect(Number(payoutRes.paidCycle.remainingBalance)).toBe(0);
    });

    it("bloqueia se BARBER tentar pagar a própria comissão (SELF_PAYMENT_FORBIDDEN)", async () => {
      const { shop, barberUser, barberMember } = await createTestFixtures();

      await expect(
        prisma.$transaction((tx) =>
          commissionOps.payCommissionPeriod(tx, {
            barbershopId: shop.id,
            periodId: "any-period",
            paidByMemberId: barberMember.id,
            userId: barberUser.id,
            role: "BARBER",
          })
        )
      ).rejects.toThrow(/descontinuada|LEGACY_ENDPOINT_DEPRECATED|propria comissao/i);
    });
  });

  describe("LOTE B — Entrada Financeira e Caixa do Clube (FT1-FT9, FT14-FT15)", () => {
    it("FT1-FT4, FT9, FT14: Pagamento PIX cria exatamente 1 FinancialEntry CLUB_REVENUE com valor, data e id corretos sem CashMovement ou Payout", async () => {
      const { shop, clubPlan, customer } = await createTestFixtures();

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-07-31T23:59:59Z"),
          gracePeriodEnd: new Date("2026-08-01T23:59:59Z"),
        },
      });

      const paidAt = new Date("2026-07-15T14:30:00Z");

      const result = await clubOps.registerManualClubSubscriptionPayment({
        barbershopId: shop.id,
        subscriptionId: sub.id,
        paymentMethod: PaymentMethod.PIX,
        paidAt,
      });

      expect(result.payment).toBeDefined();
      expect(result.payment.paymentMethod).toBe("PIX");

      // FT1: exatamente 1 FinancialEntry
      const entries = await prisma.financialEntry.findMany({
        where: { barbershopId: shop.id },
      });
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      // FT1: type = CLUB_REVENUE
      expect(entry.type).toBe("CLUB_REVENUE");
      // FT2: Valor da FinancialEntry = valor bruto pago (R$ 100.00)
      expect(Number(entry.amount)).toBe(100.0);
      // FT3: entryDate = paidAt
      expect(entry.entryDate.getTime()).toBe(paidAt.getTime());
      // FT4: clubSubscriptionPaymentId preenchido
      expect(entry.clubSubscriptionPaymentId).toBe(result.payment.id);
      expect(entry.category).toBe("PIX");

      // FT9: PIX não cria CashMovement
      const movements = await prisma.cashMovement.findMany({
        where: { barbershopId: shop.id },
      });
      expect(movements).toHaveLength(0);

      // FT14: nenhum CLUB_BARBER_PAYOUT criado no LOTE B
      const payouts = await prisma.financialEntry.findMany({
        where: { type: "CLUB_BARBER_PAYOUT" },
      });
      expect(payouts).toHaveLength(0);
    });

    it("FT5 & FT6: unique clubSubscriptionPaymentId impede criação de FinancialEntry duplicada", async () => {
      const { shop, clubPlan, customer } = await createTestFixtures();

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-07-31T23:59:59Z"),
          gracePeriodEnd: new Date("2026-08-01T23:59:59Z"),
        },
      });

      const result = await clubOps.registerManualClubSubscriptionPayment({
        barbershopId: shop.id,
        subscriptionId: sub.id,
        paymentMethod: PaymentMethod.PIX,
      });

      // Tentativa de duplicar FinancialEntry com o mesmo clubSubscriptionPaymentId lança erro de chave única
      await expect(
        prisma.financialEntry.create({
          data: {
            barbershopId: shop.id,
            type: "CLUB_REVENUE",
            category: "PIX",
            amount: 100.0,
            description: "Duplicado",
            clubSubscriptionPaymentId: result.payment.id,
          },
        })
      ).rejects.toThrow();
    });

    it("FT7: CASH sem caixa aberto falha com CASH_SESSION_REQUIRED e não cria nada no banco", async () => {
      const { shop, clubPlan, customer } = await createTestFixtures();

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-07-31T23:59:59Z"),
          gracePeriodEnd: new Date("2026-08-01T23:59:59Z"),
        },
      });

      await expect(
        clubOps.registerManualClubSubscriptionPayment({
          barbershopId: shop.id,
          subscriptionId: sub.id,
          paymentMethod: PaymentMethod.CASH,
        })
      ).rejects.toThrow(/caixa aberto/i);

      // Aborda a transação inteira: 0 pagamentos, 0 lançamentos financeiros, 0 movimentos de caixa
      expect(await prisma.clubSubscriptionPayment.count()).toBe(0);
      expect(await prisma.financialEntry.count()).toBe(0);
      expect(await prisma.cashMovement.count()).toBe(0);
    });

    it("FT8: CASH com caixa aberto cria ClubSubscriptionPayment, FinancialEntry CLUB_REVENUE e CashMovement positivo", async () => {
      const { shop, clubPlan, customer, ownerUser } = await createTestFixtures();

      const cashSession = await prisma.cashSession.create({
        data: {
          barbershopId: shop.id,
          openedById: ownerUser.id,
          openingAmount: 50.0,
          expectedAmount: 50.0,
          status: "OPEN",
        },
      });

      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: shop.id,
          customerId: customer.id,
          clubPlanId: clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-07-31T23:59:59Z"),
          gracePeriodEnd: new Date("2026-08-01T23:59:59Z"),
        },
      });

      const result = await clubOps.registerManualClubSubscriptionPayment({
        barbershopId: shop.id,
        subscriptionId: sub.id,
        paymentMethod: PaymentMethod.CASH,
      });

      expect(result.payment).toBeDefined();

      const entries = await prisma.financialEntry.findMany({ where: { barbershopId: shop.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("CLUB_REVENUE");

      const movements = await prisma.cashMovement.findMany({ where: { cashSessionId: cashSession.id } });
      expect(movements).toHaveLength(1);
      expect(Number(movements[0].amount)).toBe(100.0);

      const updatedSession = await prisma.cashSession.findUnique({ where: { id: cashSession.id } });
      expect(Number(updatedSession?.expectedAmount)).toBe(150.0); // 50 + 100
    });
  });
});
