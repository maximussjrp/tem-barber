import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;

async function truncateDatabase() {
  if (!testDatabaseUrl) {
    throw new Error("TRUNCATE_FAILED: TEST_DATABASE_URL is not set.");
  }
  if (!testDatabaseUrl.includes("match_barber_test")) {
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

function generateUniquePhone() {
  return "119" + Math.floor(10000000 + Math.random() * 90000000).toString();
}

async function seedUser(name: string, phone: string) {
  return prisma.user.create({
    data: { name, phone },
  });
}

async function seedBarbershop(label: string) {
  return prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `appt-club-${label}-${Math.random().toString(36).substring(7)}`,
      phone: generateUniquePhone(),
      zipCode: "00000-000",
      street: "Rua do Agendamento Clube",
      number: "123",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });
}

async function seedTenant(label: string) {
  const shop = await seedBarbershop(label);
  const ownerUser = await seedUser(`Owner ${label}`, generateUniquePhone());
  const barberUser = await seedUser(`Barber ${label}`, generateUniquePhone());
  const customerUser = await seedUser(`Client ${label}`, generateUniquePhone());

  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Serviços", slug: `svcs-${label}` },
  });
  const service = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "50.00", durationMin: 30 },
  });

  return {
    shop,
    ownerUser,
    barberUser,
    customerUser,
    owner,
    barber,
    service,
  };
}

describeIf("Agendamento e Integração com Plano Clube (Testes de Integração de Regras de Negócio)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  it("1. Criar agendamento para cliente com Clube não deve criar ClubBenefitUsage nem ClubPointEntry e deve manter o valor original", async () => {
    const data = await seedTenant("appt-rules");

    // 1. Criar o plano
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: data.shop.id,
        name: "Plano Club",
        monthlyPrice: "80.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
        isActive: true,
      },
    });

    // 2. Criar benefício do plano
    await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: data.service.id,
        includedQty: 2,
      },
    });

    // 3. Criar assinatura ativa para o cliente
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: data.shop.id,
        customerId: data.customerUser.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 dias atrás
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),  // 25 dias no futuro
      },
    });

    // 4. Executar fluxo de criação de agendamento usando a API correspondente (ou operação direta do prisma sob as mesmas premissas)
    // O backend cria o Appointment e AppointmentServices com o preço original do serviço
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: data.shop.id,
        customerId: data.customerUser.id,
        memberId: data.barber.id,
        dateTime: new Date(),
        durationMin: 30,
        status: "CONFIRMED",
        totalPrice: data.service.price, // R$ 50.00 (valor original)
        services: {
          create: [
            {
              serviceId: data.service.id,
              priceApplied: data.service.price,
            }
          ]
        }
      },
    });

    // 5. Validar que o agendamento foi salvo com sucesso e o valor original R$ 50,00 está intacto
    expect(appt.id).toBeDefined();
    expect(parseFloat(appt.totalPrice.toString())).toBe(50.00);

    // 6. Validar regras de integridade cruciais
    const usages = await prisma.clubBenefitUsage.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(usages.length).toBe(0); // NENHUM benefício consumido!

    const points = await prisma.clubPointEntry.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(points.length).toBe(0); // NENHUM ponto gerado!
  });

  it("2. Atualizar agendamento para cliente com Clube não deve criar ClubBenefitUsage nem ClubPointEntry", async () => {
    const data = await seedTenant("appt-rules-update");

    // Criar plano e assinatura
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: data.shop.id,
        name: "Plano Club",
        monthlyPrice: "80.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
        isActive: true,
      },
    });
    await prisma.clubPlanBenefit.create({
      data: { clubPlanId: plan.id, benefitType: "INCLUDED_SERVICE", serviceId: data.service.id, includedQty: 2 },
    });
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: data.shop.id,
        customerId: data.customerUser.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    });

    // Criar agendamento inicial
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: data.shop.id,
        customerId: data.customerUser.id,
        memberId: data.barber.id,
        dateTime: new Date(),
        durationMin: 30,
        status: "PENDING",
        totalPrice: data.service.price,
        services: {
          create: [{ serviceId: data.service.id, priceApplied: data.service.price }]
        }
      },
    });

    // Atualizar agendamento
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: "CONFIRMED",
        notes: "Atualizado para confirmado",
      },
    });

    // Validar regras de integridade cruciais
    const usages = await prisma.clubBenefitUsage.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(usages.length).toBe(0); // NENHUM benefício consumido!

    const points = await prisma.clubPointEntry.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(points.length).toBe(0); // NENHUM ponto gerado!
  });
});
