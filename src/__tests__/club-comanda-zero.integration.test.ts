import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";

/**
 * P0 — Clube: comanda coberta não pode cobrar; ACTIVE sem pagamento é impossível;
 * peso/pontuação por serviço no rateio. Reproduz o print do tenant e trava as regras.
 */

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: null as null | { userId: string; role: string; memberId: string; barbershopId: string } },
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: async () => ({ error: null, data: sessionRef.current }),
  requireOperationalSession: async () => {
    if (!sessionRef.current) {
      return { error: Response.json({ error: "Sem sessão." }, { status: 401 }), data: null };
    }
    return { error: null, data: sessionRef.current };
  },
}));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  !!testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let ops: {
  ensureComandaForAppointment: typeof import("@/lib/operations/comandas").ensureComandaForAppointment;
  recalculateComandaTotals: typeof import("@/lib/operations/comandas").recalculateComandaTotals;
};
let payments: typeof import("@/lib/operations/payments");
let club: typeof import("@/lib/operations/club");
let cycle: typeof import("@/lib/operations/club-current-cycle");
let subsRoute: typeof import("@/app/api/admin/clube/subscriptions/route");
let customerBalanceRoute: typeof import("@/app/api/admin/clube/subscriptions/customer/[customerId]/balance/route");

async function truncateDatabase() {
  if (!testDatabaseUrl || !testDatabaseUrl.includes("match_barber_test")) {
    throw new Error("TRUNCATE_FAILED: URL must contain match_barber_test.");
  }
  if (!/localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl)) {
    throw new Error("TRUNCATE_FAILED: Host must be localhost or 127.0.0.1.");
  }
  if (process.env.ALLOW_TEST_DB_TRUNCATE !== "YES") {
    throw new Error("TRUNCATE_FAILED: ALLOW_TEST_DB_TRUNCATE=YES env var is required.");
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "club_settlement_members",
      "club_settlements",
      "club_point_entries",
      "club_benefit_usages",
      "club_subscription_payments",
      "customer_club_subscriptions",
      "club_plan_benefits",
      "club_plans",
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

let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return "119" + String(10000000 + phoneSeq).slice(0, 8);
}

const DAY = 24 * 60 * 60 * 1000;

async function seedBarbershop(label: string) {
  return prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `czero-${label}-${Math.random().toString(36).slice(2, 8)}`,
      phone: uniquePhone(),
      zipCode: "00000-000",
      street: "Rua Clube",
      number: "1",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });
}

async function seedTenant(label: string, opts?: { servicePrice?: string; serviceName?: string }) {
  const shop = await seedBarbershop(label);
  const barberUser = await prisma.user.create({ data: { name: `Barber ${label}`, phone: uniquePhone() } });
  const customerUser = await prisma.user.create({ data: { name: `Cliente ${label}`, phone: uniquePhone() } });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });
  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Serviços", slug: `svcs-${label}-${Math.random().toString(36).slice(2, 6)}` },
  });
  const service = await prisma.service.create({
    data: {
      barbershopId: shop.id,
      categoryId: category.id,
      name: opts?.serviceName ?? "Barba",
      price: opts?.servicePrice ?? "35.00",
      durationMin: 30,
    },
  });
  return { shop, barberUser, customerUser, barber, category, service };
}

async function seedPlan(shopId: string, opts?: { shopSharePercent?: string; barberPoolPercent?: string; monthlyPrice?: string }) {
  return prisma.clubPlan.create({
    data: {
      barbershopId: shopId,
      name: "Barba Clube",
      monthlyPrice: opts?.monthlyPrice ?? "100.00",
      shopSharePercent: opts?.shopSharePercent ?? "0.00",
      barberPoolPercent: opts?.barberPoolPercent ?? "100.00",
      isActive: true,
    },
  });
}

async function seedBenefitIncluded(planId: string, serviceId: string, opts?: { unlimited?: boolean; includedQty?: number; pointWeight?: string }) {
  return prisma.clubPlanBenefit.create({
    data: {
      clubPlanId: planId,
      benefitType: "INCLUDED_SERVICE",
      benefitLimitMode: opts?.unlimited ? "UNLIMITED" : "MONTHLY_LIMIT",
      serviceId,
      includedQty: opts?.unlimited ? null : (opts?.includedQty ?? 4),
      pointWeight: opts?.pointWeight ?? "10.0000",
    },
  });
}

async function seedSubscription(shopId: string, customerId: string, planId: string, opts: { status: string; startOffsetMs: number; endOffsetMs: number }) {
  const start = new Date(Date.now() + opts.startOffsetMs);
  const end = new Date(Date.now() + opts.endOffsetMs);
  return prisma.customerClubSubscription.create({
    data: {
      barbershopId: shopId,
      customerId,
      clubPlanId: planId,
      status: opts.status as never,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      gracePeriodEnd: new Date(end.getTime() + DAY),
    },
  });
}

async function createAppointment(shopId: string, customerId: string, memberId: string, serviceId: string, price: string, dateTime: Date) {
  return prisma.appointment.create({
    data: {
      barbershopId: shopId,
      customerId,
      memberId,
      dateTime,
      durationMin: 30,
      status: "CONFIRMED",
      totalPrice: price,
      services: { create: [{ serviceId, priceApplied: price }] },
    },
  });
}

async function ensureComanda(shopId: string, appointmentId: string) {
  return prisma.$transaction((tx) => ops.ensureComandaForAppointment(tx, { barbershopId: shopId, appointmentId }));
}

async function recalc(comandaId: string) {
  return prisma.$transaction((tx) => ops.recalculateComandaTotals(tx, comandaId));
}

async function setItemClub(itemId: string, benefitId: string) {
  await prisma.comandaItem.update({
    where: { id: itemId },
    data: { clubBenefitRequested: true, requestedClubPlanBenefitId: benefitId },
  });
}

async function finalize(shopId: string, comandaId: string) {
  return prisma.$transaction((tx) => payments.closeComanda(tx, shopId, comandaId));
}

function n(v: unknown) {
  return Number(v as never);
}

beforeAll(async () => {
  if (!canRunIntegration) return;
  process.env.DATABASE_URL = testDatabaseUrl;
  vi.resetModules();
  prisma = (await import("@/lib/prisma")).default as PrismaClient;
  const comandas = await import("@/lib/operations/comandas");
  ops = { ensureComandaForAppointment: comandas.ensureComandaForAppointment, recalculateComandaTotals: comandas.recalculateComandaTotals };
  payments = await import("@/lib/operations/payments");
  club = await import("@/lib/operations/club");
  cycle = await import("@/lib/operations/club-current-cycle");
  subsRoute = await import("@/app/api/admin/clube/subscriptions/route");
  customerBalanceRoute = await import("@/app/api/admin/clube/subscriptions/customer/[customerId]/balance/route");
}, 60000);

beforeEach(async () => {
  if (!canRunIntegration) return;
  await truncateDatabase();
  sessionRef.current = null;
}, 30000);

describeIf("P0 Clube — Comanda Zero + Status Pagamento + Pesos", () => {
  // ---- Parte A: comanda coberta não pode cobrar ----

  it("T1 — item coberto (incluso) zera comanda.total", async () => {
    const t = await seedTenant("t1");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });

    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);

    expect(comanda.items[0].clubBenefitRequested).toBe(true);
    expect(n(comanda.total)).toBe(0);
  });

  it("T2 — item coberto zera comanda.remainingTotal", async () => {
    const t = await seedTenant("t2");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    expect(n(comanda.remainingTotal)).toBe(0);
  });

  it("T3 — resumo não cobra R$ 35 quando benefício é incluso (subtotal reduzido)", async () => {
    const t = await seedTenant("t3");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    expect(n(comanda.subtotal)).toBe(0);
    expect(n(comanda.total)).not.toBe(35);
  });

  it("P0/repro — recalc usa openedAt (não createdAt): item coberto zera o resumo, sem item R$ 0 com resumo R$ 35", async () => {
    const t = await seedTenant("repro");
    const plan = await seedPlan(t.shop.id);
    const benefit = await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    // Assinatura vigente agora.
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });

    // Comanda com createdAt ANTERIOR à vigência, mas aberta (openedAt) dentro dela.
    // Antes do reparo o recálculo usava createdAt (fora da vigência) e cobrava R$ 35,
    // enquanto o item aparecia como coberto (R$ 0). Agora o recálculo usa openedAt.
    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        customerName: t.customerUser.name,
        status: "OPEN",
        createdAt: new Date(Date.now() - 40 * DAY),
        openedAt: new Date(),
        items: {
          create: {
            barbershopId: t.shop.id,
            type: "SERVICE",
            description: "Barba",
            quantity: 1,
            unitPrice: "35.00",
            total: "35.00",
            serviceId: t.service.id,
            executorId: t.barber.id,
            clubBenefitRequested: true,
            requestedClubPlanBenefitId: benefit.id,
          },
        },
      },
      include: { items: true },
    });

    const recalculated = await recalc(comanda.id);

    expect(n(recalculated.total)).toBe(0);
    expect(n(recalculated.remainingTotal)).toBe(0);
    // O item preserva o preço de tabela; o resumo reflete a cobertura (invariante do print).
    const item = await prisma.comandaItem.findFirst({ where: { comandaId: comanda.id } });
    expect(n(item!.total)).toBe(35);
  });

  it("T4/T5 — closeComanda fecha comanda coberta sem exigir pagamento", async () => {
    const t = await seedTenant("t5");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    // conclui item de serviço
    await prisma.comandaItem.update({ where: { id: comanda.items[0].id }, data: { status: "DONE", completedAt: new Date() } });

    const closed = await finalize(t.shop.id, comanda.id);
    expect(closed.status).toBe("CLOSED");
    expect(n(closed.remainingTotal)).toBe(0);
    const paymentCount = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(paymentCount).toBe(0);
  });

  it("T6 — ClubBenefitUsage criado exatamente 1x, apenas ao finalizar", async () => {
    const t = await seedTenant("t6");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);

    // Antes de finalizar: nenhum uso.
    expect(await prisma.clubBenefitUsage.count({ where: { barbershopId: t.shop.id } })).toBe(0);

    await prisma.comandaItem.update({ where: { id: comanda.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comanda.id);

    const usages = await prisma.clubBenefitUsage.findMany({ where: { barbershopId: t.shop.id } });
    expect(usages.length).toBe(1);
    expect(usages[0].status).toBe("APPLIED");
  });

  it("T7/T8 — ClubPointEntry criado com o peso configurado do serviço (Barba)", async () => {
    const t = await seedTenant("t7");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true, pointWeight: "12.0000" });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await prisma.comandaItem.update({ where: { id: comanda.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comanda.id);

    const points = await prisma.clubPointEntry.findMany({ where: { barbershopId: t.shop.id } });
    expect(points.length).toBe(1);
    expect(n(points[0].points)).toBe(12);
    expect(points[0].memberId).toBe(t.barber.id);
  });

  it("T9 — segundo serviço usa o próprio peso configurado", async () => {
    const t = await seedTenant("t9", { serviceName: "Barba" });
    const corte = await prisma.service.create({
      data: { barbershopId: t.shop.id, categoryId: t.category.id, name: "Corte", price: "40.00", durationMin: 30 },
    });
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, corte.id, { unlimited: true, pointWeight: "30.0000" });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, corte.id, "40.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await prisma.comandaItem.update({ where: { id: comanda.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comanda.id);
    const points = await prisma.clubPointEntry.findMany({ where: { barbershopId: t.shop.id } });
    expect(n(points[0].points)).toBe(30);
  });

  it("T10 — rateio do pote usa PONTOS (peso), não contagem simples de serviços", async () => {
    const t = await seedTenant("t10", { serviceName: "Barba" });
    const corte = await prisma.service.create({
      data: { barbershopId: t.shop.id, categoryId: t.category.id, name: "Corte", price: "40.00", durationMin: 30 },
    });
    const barberUserB = await prisma.user.create({ data: { name: "Barber B", phone: uniquePhone() } });
    const barberB = await prisma.barbershopMember.create({ data: { barbershopId: t.shop.id, userId: barberUserB.id, role: "BARBER" } });
    const customerB = await prisma.user.create({ data: { name: "Cliente B", phone: uniquePhone() } });

    const plan = await seedPlan(t.shop.id, { shopSharePercent: "0.00", barberPoolPercent: "100.00", monthlyPrice: "100.00" });
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true, pointWeight: "10.0000" }); // Barba peso 10
    await seedBenefitIncluded(plan.id, corte.id, { unlimited: true, pointWeight: "30.0000" }); // Corte peso 30

    // Duas assinaturas + pagamento (gera receita/pote)
    const subA = await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    const subB = await seedSubscription(t.shop.id, customerB.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: subA.id, paymentMethod: "PIX" });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: subB.id, paymentMethod: "PIX" });

    // barberA faz Barba (10 pts); barberB faz Corte (30 pts)
    const apptA = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comandaA = await ensureComanda(t.shop.id, apptA.id);
    await prisma.comandaItem.update({ where: { id: comandaA.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comandaA.id);

    const apptB = await createAppointment(t.shop.id, customerB.id, barberB.id, corte.id, "40.00", new Date());
    const comandaB = await ensureComanda(t.shop.id, apptB.id);
    await prisma.comandaItem.update({ where: { id: comandaB.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comandaB.id);

    const summary = await cycle.getCurrentCycleSummary({ barbershopId: t.shop.id, role: "OWNER" });
    const a = summary.barbers.find((x) => x.memberId === t.barber.id)!;
    const b = summary.barbers.find((x) => x.memberId === barberB.id)!;
    expect(n(a.points)).toBe(10);
    expect(n(b.points)).toBe(30);
    // Cada um fez 1 serviço; se fosse por contagem seria 50/50. Por pontos: 25/75.
    expect(a.servicesCount).toBe(1);
    expect(b.servicesCount).toBe(1);
    expect(n(a.sharePercent)).toBeCloseTo(25, 1);
    expect(n(b.sharePercent)).toBeCloseTo(75, 1);
  });

  // ---- Parte B: ACTIVE sem pagamento é impossível ----

  async function callCreateSubscription(shopId: string, memberId: string, body: unknown) {
    sessionRef.current = { userId: "u", role: "OWNER", memberId, barbershopId: shopId };
    const req = new NextRequest("http://localhost/api/admin/clube/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await subsRoute.POST(req);
    return { status: res.status, json: await res.json() };
  }

  it("T11 — POST assinatura com status ACTIVE mas sem pagamento nasce PAST_DUE", async () => {
    const t = await seedTenant("t11");
    const plan = await seedPlan(t.shop.id);
    const { status, json } = await callCreateSubscription(t.shop.id, t.barber.id, {
      customerId: t.customerUser.id,
      clubPlanId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    expect(status).toBe(201);
    expect(json.status).toBe("PAST_DUE");
    const paymentsCount = await prisma.clubSubscriptionPayment.count({ where: { subscriptionId: json.id } });
    expect(paymentsCount).toBe(0);
  });

  it("T12 — PAST_DUE não aparece como ACTIVE na listagem da API", async () => {
    const t = await seedTenant("t12");
    const plan = await seedPlan(t.shop.id);
    await callCreateSubscription(t.shop.id, t.barber.id, {
      customerId: t.customerUser.id,
      clubPlanId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    sessionRef.current = { userId: "u", role: "OWNER", memberId: t.barber.id, barbershopId: t.shop.id };
    const res = await subsRoute.GET(new NextRequest("http://localhost/api/admin/clube/subscriptions"));
    const list = await res.json();
    expect(list.length).toBe(1);
    expect(list[0].status).toBe("PAST_DUE");
  });

  it("T13 — filtro status=ACTIVE não inclui PAST_DUE", async () => {
    const t = await seedTenant("t13");
    const plan = await seedPlan(t.shop.id);
    await callCreateSubscription(t.shop.id, t.barber.id, {
      customerId: t.customerUser.id,
      clubPlanId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    sessionRef.current = { userId: "u", role: "OWNER", memberId: t.barber.id, barbershopId: t.shop.id };
    const res = await subsRoute.GET(new NextRequest("http://localhost/api/admin/clube/subscriptions?status=ACTIVE"));
    const list = await res.json();
    expect(list.length).toBe(0);
  });

  async function callCustomerBalance(shopId: string, memberId: string, customerId: string) {
    sessionRef.current = { userId: "u", role: "OWNER", memberId, barbershopId: shopId };
    const res = await customerBalanceRoute.GET(
      new NextRequest(`http://localhost/api/admin/clube/subscriptions/customer/${customerId}/balance`),
      { params: Promise.resolve({ customerId }) }
    );
    return res.json();
  }

  it("T14 — PAST_DUE não libera benefícios (nem no /balance, nem na comanda)", async () => {
    const t = await seedTenant("t14");
    const plan = await seedPlan(t.shop.id);
    const benefit = await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });

    const balance = await callCustomerBalance(t.shop.id, t.barber.id, t.customerUser.id);
    expect(balance.benefits.length).toBe(0);

    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await setItemClub(comanda.items[0].id, benefit.id);
    const recalculated = await recalc(comanda.id);
    // Assinatura em atraso: comanda continua cobrando integral.
    expect(n(recalculated.total)).toBe(35);
  });

  it("T15 — ACTIVE com pagamento libera benefícios (/balance)", async () => {
    const t = await seedTenant("t15");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    const sub = await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: sub.id, paymentMethod: "PIX" });

    const balance = await callCustomerBalance(t.shop.id, t.barber.id, t.customerUser.id);
    expect(balance.benefits.length).toBeGreaterThan(0);
  });

  // ---- Multi-tenant ----

  it("T16 — benefício do tenant A não aplica em serviço de tenant B (mesmo nome)", async () => {
    const a = await seedTenant("t16a", { serviceName: "Barba" });
    const b = await seedTenant("t16b", { serviceName: "Barba" });
    const planA = await seedPlan(a.shop.id);
    const benefitA = await seedBenefitIncluded(planA.id, a.service.id, { unlimited: true });
    await seedSubscription(a.shop.id, a.customerUser.id, planA.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });

    // Comanda no tenant B; cliente de B sem assinatura. Força o benefitId de A no item de B.
    const appt = await createAppointment(b.shop.id, b.customerUser.id, b.barber.id, b.service.id, "35.00", new Date());
    const comanda = await ensureComanda(b.shop.id, appt.id);
    await setItemClub(comanda.items[0].id, benefitA.id);
    const recalculated = await recalc(comanda.id);
    expect(n(recalculated.total)).toBe(35);
  });

  it("T17 — assinatura do tenant A não é vista por comanda do tenant B (mesmo cliente)", async () => {
    const a = await seedTenant("t17a", { serviceName: "Barba" });
    const b = await seedTenant("t17b", { serviceName: "Barba" });
    // Mesmo usuário cliente atende os dois tenants.
    const planA = await seedPlan(a.shop.id);
    const benefitA = await seedBenefitIncluded(planA.id, a.service.id, { unlimited: true });
    await seedSubscription(a.shop.id, a.customerUser.id, planA.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });

    const planB = await seedPlan(b.shop.id);
    const benefitB = await seedBenefitIncluded(planB.id, b.service.id, { unlimited: true });
    // cliente de A NÃO tem assinatura em B
    const appt = await createAppointment(b.shop.id, a.customerUser.id, b.barber.id, b.service.id, "35.00", new Date());
    const comanda = await ensureComanda(b.shop.id, appt.id);
    await setItemClub(comanda.items[0].id, benefitB.id);
    const recalculated = await recalc(comanda.id);
    expect(n(recalculated.total)).toBe(35);
    expect(benefitA.id).not.toBe(benefitB.id);
  });

  // ---- LOTE B / financeiro ----

  it("T18 — pagamento do plano cria exatamente 1 FinancialEntry CLUB_REVENUE (LOTE B)", async () => {
    const t = await seedTenant("t18");
    const plan = await seedPlan(t.shop.id);
    const sub = await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: sub.id, paymentMethod: "PIX" });
    const revenue = await prisma.financialEntry.count({ where: { barbershopId: t.shop.id, type: "CLUB_REVENUE" } });
    expect(revenue).toBe(1);
  });

  it("T19 — pagamento do plano via PIX não cria CashMovement", async () => {
    const t = await seedTenant("t19");
    const plan = await seedPlan(t.shop.id);
    const sub = await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: sub.id, paymentMethod: "PIX" });
    const cash = await prisma.cashMovement.count({ where: { barbershopId: t.shop.id } });
    expect(cash).toBe(0);
  });

  it("T20 — nenhum FinancialEntry CLUB_BARBER_PAYOUT em runtime", async () => {
    const t = await seedTenant("t20");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true, pointWeight: "10.0000" });
    const sub = await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "PAST_DUE", startOffsetMs: -DAY, endOffsetMs: DAY });
    await club.registerManualClubSubscriptionPayment({ barbershopId: t.shop.id, subscriptionId: sub.id, paymentMethod: "PIX" });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await prisma.comandaItem.update({ where: { id: comanda.items[0].id }, data: { status: "DONE", completedAt: new Date() } });
    await finalize(t.shop.id, comanda.id);
    const payout = await prisma.financialEntry.count({ where: { barbershopId: t.shop.id, type: "CLUB_BARBER_PAYOUT" } });
    expect(payout).toBe(0);
  });

  // ---- Não-regressão ----

  it("T21 — comanda normal sem clube continua cobrando", async () => {
    const t = await seedTenant("t21");
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    expect(comanda.items[0].clubBenefitRequested).toBe(false);
    expect(n(comanda.total)).toBe(35);
  });

  it("T22 — serviço não coberto pelo plano continua cobrando", async () => {
    const t = await seedTenant("t22", { serviceName: "Barba" });
    const outro = await prisma.service.create({
      data: { barbershopId: t.shop.id, categoryId: t.category.id, name: "Sobrancelha", price: "20.00", durationMin: 15 },
    });
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true }); // cobre Barba, não Sobrancelha
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, outro.id, "20.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    expect(comanda.items[0].clubBenefitRequested).toBe(false);
    expect(n(comanda.total)).toBe(20);
  });

  it("T23 — desconto parcial do clube cobra só a diferença", async () => {
    const t = await seedTenant("t23", { serviceName: "Barba", servicePrice: "100.00" });
    const plan = await seedPlan(t.shop.id);
    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "SERVICE_DISCOUNT",
        benefitLimitMode: "UNLIMITED",
        serviceId: t.service.id,
        discountPercent: "30.00",
        pointWeight: "0.0000",
      },
    });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "100.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await setItemClub(comanda.items[0].id, benefit.id);
    const recalculated = await recalc(comanda.id);
    expect(n(recalculated.total)).toBe(70);
  });

  it("T24 — cancelar comanda antes de finalizar não cria ClubBenefitUsage/ClubPointEntry", async () => {
    const t = await seedTenant("t24");
    const plan = await seedPlan(t.shop.id);
    await seedBenefitIncluded(plan.id, t.service.id, { unlimited: true });
    await seedSubscription(t.shop.id, t.customerUser.id, plan.id, { status: "ACTIVE", startOffsetMs: -DAY, endOffsetMs: 30 * DAY });
    const appt = await createAppointment(t.shop.id, t.customerUser.id, t.barber.id, t.service.id, "35.00", new Date());
    const comanda = await ensureComanda(t.shop.id, appt.id);
    await prisma.comanda.update({ where: { id: comanda.id }, data: { status: "CANCELLED" } });

    expect(await prisma.clubBenefitUsage.count({ where: { barbershopId: t.shop.id } })).toBe(0);
    expect(await prisma.clubPointEntry.count({ where: { barbershopId: t.shop.id } })).toBe(0);
  });
});
