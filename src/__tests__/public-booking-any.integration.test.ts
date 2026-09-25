import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { validTestPhone } from "./helpers/integration-fixtures";

type PublicPost = typeof import("@/app/api/public/barbershop/[slug]/book/route").POST;

const { getServerSessionMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let publicBook: PublicPost;

function publicRequest(body: unknown, key: string, slug = "shop-any") {
  return new NextRequest(`http://localhost/api/public/barbershop/${slug}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function getFutureMondayISO(time: string): string {
  const d = new Date();
  const currentDay = d.getUTCDay();
  let daysToAdd = (1 - currentDay + 7) % 7;
  if (daysToAdd === 0) {
    daysToAdd = 7;
  }
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToAdd));
  const year = target.getUTCFullYear();
  const month = String(target.getUTCMonth() + 1).padStart(2, "0");
  const day = String(target.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${time}`;
}

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "appointment_services",
      "appointments",
      "barber_services",
      "working_hours",
      "time_offs",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users",
      "tenant_subscriptions",
      "plans"
    CASCADE
  `);
}

async function seedTenantWithTwoBarbers(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `shop-${label}`,
      phone: validTestPhone(label, "shop"),
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });

  let plan = await prisma.plan.findFirst();
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        code: `test_plan_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        name: "Plano Teste",
        price: 49.9,
        maxMembers: 20,
        isActive: true,
      },
    });
  }

  await prisma.tenantSubscription.create({
    data: {
      barbershopId: shop.id,
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Cabelo", slug: `cabelo-${label}` },
  });

  const service = await prisma.service.create({
    data: {
      barbershopId: shop.id,
      categoryId: category.id,
      name: "Corte Tradicional",
      price: "50.00",
      durationMin: 30,
    },
  });

  // Barber Jesus
  const userJesus = await prisma.user.create({
    data: { name: "Jesus Barbeiro", phone: validTestPhone(label, "jesus") },
  });
  const memberJesus = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: userJesus.id, role: "BARBER", isActive: true },
  });
  await prisma.barberService.create({
    data: { barberId: memberJesus.id, serviceId: service.id },
  });
  await prisma.workingHour.create({
    data: {
      memberId: memberJesus.id,
      dayOfWeek: 1, // Monday
      startTime: "09:00",
      endTime: "18:00",
      isActive: true,
    },
  });

  // Barber Max
  const userMax = await prisma.user.create({
    data: { name: "Max Barbeiro", phone: validTestPhone(label, "max") },
  });
  const memberMax = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: userMax.id, role: "BARBER", isActive: true },
  });
  await prisma.barberService.create({
    data: { barberId: memberMax.id, serviceId: service.id },
  });
  await prisma.workingHour.create({
    data: {
      memberId: memberMax.id,
      dayOfWeek: 1, // Monday
      startTime: "09:00",
      endTime: "18:00",
      isActive: true,
    },
  });

  return { shop, service, memberJesus, memberMax };
}

describeIf("Public Booking ANY — Testes de Integração com PostgreSQL Real", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for integration tests.");
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    getServerSessionMock.mockResolvedValue(null);

    const [{ PrismaClient }, { PrismaPg }, { Pool }] = await Promise.all([
      import("@prisma/client"),
      import("@prisma/adapter-pg"),
      import("pg"),
    ]);

    const pool = new Pool({ connectionString: testDatabaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    const bookModule = await import("@/app/api/public/barbershop/[slug]/book/route");
    publicBook = bookModule.POST;
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    if (prisma) {
      await truncateDatabase();
      await prisma.$disconnect();
    }
  });

  it("CENÁRIO A: 2 profissionais elegíveis no mesmo horário -> ANY escolhe o profissional com menor carga horária", async () => {
    const { shop, service, memberJesus, memberMax } = await seedTenantWithTwoBarbers("cenario-a");
    const monday10 = getFutureMondayISO("10:00:00.000Z");
    const monday14 = getFutureMondayISO("14:00:00.000Z");

    // Cria um agendamento prévio de 60 min para Jesus às 14:00
    const customerExisting = await prisma.user.create({
      data: { name: "Cliente Anterior", phone: validTestPhone("cenario-a", "prev") },
    });
    await prisma.appointment.create({
      data: {
        barbershopId: shop.id,
        memberId: memberJesus.id,
        customerId: customerExisting.id,
        dateTime: new Date(monday14),
        durationMin: 60,
        totalPrice: "50.00",
        status: "CONFIRMED",
        services: {
          create: [{ serviceId: service.id, priceApplied: "50.00" }],
        },
      },
    });

    // Booking ANY para as 10:00 (Jesus tem 60min de workload, Max tem 0min de workload)
    const res = await publicBook(
      publicRequest(
        {
          memberId: "any",
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente Teste A",
          customerPhone: validTestPhone("cenario-a", "client1"),
        },
        "11111111-1111-4111-8111-000000000001",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    // Max deve ser o escolhido devido à menor carga horária (0min vs 60min)
    expect(body.appointment.barberName).toBe("Max Barbeiro");

    const appts = await prisma.appointment.findMany({
      where: { barbershopId: shop.id, dateTime: new Date(monday10) },
    });
    expect(appts).toHaveLength(1);
    expect(appts[0].memberId).toBe(memberMax.id);
  });

  it("CENÁRIO B — CONCORRÊNCIA: 2 clientes chamam ANY às 10:00 simultaneamente -> ambos têm sucesso, um com Jesus e um com Max, sem overlap", async () => {
    const { shop, service, memberJesus, memberMax } = await seedTenantWithTwoBarbers("cenario-b");
    const monday10 = getFutureMondayISO("10:00:00.000Z");

    // Ambos os profissionais estão livres às 10:00 com 0 minutos de workload prévia
    const reqA = publicBook(
      publicRequest(
        {
          memberId: "any",
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente A",
          customerPhone: validTestPhone("cenario-b", "client-a"),
        },
        "22222222-2222-4222-8222-000000000001",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const reqB = publicBook(
      publicRequest(
        {
          memberId: "any",
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente B",
          customerPhone: validTestPhone("cenario-b", "client-b"),
        },
        "22222222-2222-4222-8222-000000000002",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const [resultA, resultB] = await Promise.allSettled([reqA, reqB]);

    expect(resultA.status).toBe("fulfilled");
    expect(resultB.status).toBe("fulfilled");

    const resA = (resultA as PromiseFulfilledResult<Response>).value;
    const resB = (resultB as PromiseFulfilledResult<Response>).value;

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    const assignedBarbers = [bodyA.appointment.barberName, bodyB.appointment.barberName].sort();
    expect(assignedBarbers).toEqual(["Jesus Barbeiro", "Max Barbeiro"]);

    const createdAppointments = await prisma.appointment.findMany({
      where: { barbershopId: shop.id, dateTime: new Date(monday10) },
      include: { barber: { include: { user: true } } },
    });

    expect(createdAppointments).toHaveLength(2);
    const assignedMemberIds = new Set(createdAppointments.map((a) => a.memberId));
    expect(assignedMemberIds.size).toBe(2);
    expect(assignedMemberIds.has(memberJesus.id)).toBe(true);
    expect(assignedMemberIds.has(memberMax.id)).toBe(true);
  });

  it("CENÁRIO C: Somente 1 profissional disponível -> 2 requests ANY concorrentes resultam em 1 sucesso e 1 conflito 409", async () => {
    const { shop, service, memberJesus, memberMax } = await seedTenantWithTwoBarbers("cenario-c");
    const monday10 = getFutureMondayISO("10:00:00.000Z");

    // Bloqueia Max com TimeOff durante todo o dia
    const mondayStart = new Date(getFutureMondayISO("00:00:00.000Z"));
    const mondayEnd = new Date(getFutureMondayISO("23:59:59.999Z"));
    await prisma.timeOff.create({
      data: {
        memberId: memberMax.id,
        startDate: mondayStart,
        endDate: mondayEnd,
        allDay: true,
      },
    });

    // Somente Jesus está disponível às 10:00
    const reqA = publicBook(
      publicRequest(
        {
          memberId: "any",
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente Concorrente 1",
          customerPhone: validTestPhone("cenario-c", "conc-1"),
        },
        "33333333-3333-4333-8333-000000000001",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const reqB = publicBook(
      publicRequest(
        {
          memberId: "any",
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente Concorrente 2",
          customerPhone: validTestPhone("cenario-c", "conc-2"),
        },
        "33333333-3333-4333-8333-000000000002",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const [resultA, resultB] = await Promise.allSettled([reqA, reqB]);

    const resA = (resultA as PromiseFulfilledResult<Response>).value;
    const resB = (resultB as PromiseFulfilledResult<Response>).value;

    const statuses = [resA.status, resB.status].sort();
    // Exatamente 1 sucesso (201) e 1 conflito (409)
    expect(statuses).toEqual([201, 409]);

    const appts = await prisma.appointment.findMany({
      where: { barbershopId: shop.id, dateTime: new Date(monday10) },
    });
    // Nunca gera double-booking
    expect(appts).toHaveLength(1);
    expect(appts[0].memberId).toBe(memberJesus.id);
  });

  it("CENÁRIO D: SPECIFIC concorrente continua respeitando schedule lock e impede double-booking", async () => {
    const { shop, service, memberJesus } = await seedTenantWithTwoBarbers("cenario-d");
    const monday10 = getFutureMondayISO("10:00:00.000Z");

    const reqA = publicBook(
      publicRequest(
        {
          memberId: memberJesus.id,
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente Specific 1",
          customerPhone: validTestPhone("cenario-d", "spec-1"),
        },
        "44444444-4444-4444-8444-000000000001",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const reqB = publicBook(
      publicRequest(
        {
          memberId: memberJesus.id,
          serviceIds: [service.id],
          dateTime: monday10,
          customerName: "Cliente Specific 2",
          customerPhone: validTestPhone("cenario-d", "spec-2"),
        },
        "44444444-4444-4444-8444-000000000002",
        shop.slug
      ),
      { params: Promise.resolve({ slug: shop.slug }) }
    );

    const [resultA, resultB] = await Promise.allSettled([reqA, reqB]);

    const resA = (resultA as PromiseFulfilledResult<Response>).value;
    const resB = (resultB as PromiseFulfilledResult<Response>).value;

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const appts = await prisma.appointment.findMany({
      where: { barbershopId: shop.id, memberId: memberJesus.id, dateTime: new Date(monday10) },
    });
    expect(appts).toHaveLength(1);
  });
});
