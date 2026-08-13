import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { createActiveTenantSubscription, validTestPhone } from "./helpers/integration-fixtures";

type PublicBook = typeof import("@/app/api/public/barbershop/[slug]/book/route").POST;
type Availability = typeof import("@/app/api/public/barbershop/[slug]/availability/route").GET;
type AdminPost = typeof import("@/app/api/admin/appointments/route").POST;
type AdminPut = typeof import("@/app/api/admin/appointments/[id]/route").PUT;

const { getServerSessionMock, getAdminSessionMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getAdminSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let publicBook: PublicBook;
let availability: Availability;
let adminCreate: AdminPost;
let adminUpdate: AdminPut;
type AdminServicesGet = typeof import("@/app/api/admin/services/route").GET;
let adminServicesGet: AdminServicesGet;

function publicRequest(body: unknown, key: string, slug = "shop-a") {
  return new NextRequest(`http://localhost/api/public/barbershop/${slug}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function availabilityRequest(slug: string, query: string) {
  return new NextRequest(`http://localhost/api/public/barbershop/${slug}/availability?${query}`);
}

function adminRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/appointments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function adminPutRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/appointments/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function truncateDatabase() {
  if (process.env.ALLOW_TEST_DB_TRUNCATE !== "YES") {
    throw new Error("TRUNCATE_BLOCKED: set ALLOW_TEST_DB_TRUNCATE=YES for test DB only.");
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "appointment_services",
      "appointments",
      "reviews",
      "barber_services",
      "working_hours",
      "time_offs",
      "services",
      "categories",
      "barbershop_members",
      "tenant_subscriptions",
      "barbershops",
      "users",
      "plans"
    CASCADE
  `);
}

async function seedTenant(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Shop ${label}`,
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

  await createActiveTenantSubscription(prisma, shop.id, { label });

  const adminUser = await prisma.user.create({
    data: { name: `Admin ${label}`, phone: validTestPhone(label, "admin") },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: adminUser.id, role: "OWNER" },
  });

  const [joaoUser, pedroUser, anaUser] = await Promise.all([
    prisma.user.create({ data: { name: `Joao ${label}`, phone: validTestPhone(label, "joao") } }),
    prisma.user.create({ data: { name: `Pedro ${label}`, phone: validTestPhone(label, "pedro") } }),
    prisma.user.create({ data: { name: `Ana ${label}`, phone: validTestPhone(label, "ana") } }),
  ]);

  const [joao, pedro, ana] = await Promise.all([
    prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: joaoUser.id, role: "BARBER" } }),
    prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: pedroUser.id, role: "BARBER" } }),
    prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: anaUser.id, role: "BARBER" } }),
  ]);

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Servicos", slug: "servicos" },
  });
  const [cut, beard] = await Promise.all([
    prisma.service.create({
      data: { barbershopId: shop.id, categoryId: category.id, name: `Corte ${label}`, price: "50.00", durationMin: 30 },
    }),
    prisma.service.create({
      data: { barbershopId: shop.id, categoryId: category.id, name: `Barba ${label}`, price: "40.00", durationMin: 30 },
    }),
  ]);

  await prisma.barberService.createMany({
    data: [
      { barberId: joao.id, serviceId: cut.id },
      { barberId: pedro.id, serviceId: beard.id },
      { barberId: ana.id, serviceId: cut.id },
      { barberId: ana.id, serviceId: beard.id },
    ],
  });

  await prisma.workingHour.createMany({
    data: [joao, pedro, ana].map((member) => ({
      memberId: member.id,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
      isActive: true,
    })),
  });

  const customer = await prisma.user.create({
    data: { name: `Cliente ${label}`, phone: validTestPhone(label, "customer") },
  });

  return { shop, adminUser, owner, joao, pedro, ana, cut, beard, customer };
}

async function makeCustomer(phoneSuffix: string) {
  return prisma.user.create({
    data: { name: `Cliente ${phoneSuffix}`, phone: validTestPhone("professional-service", phoneSuffix) },
  });
}

describeIf("P1 professional service capability com PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    getServerSessionMock.mockResolvedValue(null);

    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    publicBook = (await import("@/app/api/public/barbershop/[slug]/book/route")).POST;
    availability = (await import("@/app/api/public/barbershop/[slug]/availability/route")).GET;
    adminCreate = (await import("@/app/api/admin/appointments/route")).POST;
    adminUpdate = (await import("@/app/api/admin/appointments/[id]/route")).PUT;
    adminServicesGet = (await import("@/app/api/admin/services/route")).GET;
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    await truncateDatabase();
    getServerSessionMock.mockResolvedValue(null);
    getAdminSessionMock.mockResolvedValue({ error: null, data: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("1. Joao + Corte cria booking publico", async () => {
    const tenant = await seedTenant("a");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.cut.id],
        dateTime: "2026-07-20T09:00:00.000Z",
        customerPhone: tenant.customer.phone,
      }, "11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );

    expect(response.status).toBe(201);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("2. Joao + Barba sem BarberService rejeita", async () => {
    const tenant = await seedTenant("a");
    const customer = await makeCustomer("2");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.beard.id],
        dateTime: "2026-07-20T09:30:00.000Z",
        customerPhone: customer.phone,
      }, "22222222-2222-4222-8222-222222222222"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("3. Joao + multi-servico parcial rejeita", async () => {
    const tenant = await seedTenant("a");
    const customer = await makeCustomer("3");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.cut.id, tenant.beard.id],
        dateTime: "2026-07-20T10:00:00.000Z",
        customerPhone: customer.phone,
      }, "33333333-3333-4333-8333-333333333333"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );

    expect(response.status).toBe(422);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("4. profissional com ambos cria multi-servico", async () => {
    const tenant = await seedTenant("a");
    const customer = await makeCustomer("4");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.ana.id,
        serviceIds: [tenant.cut.id, tenant.beard.id],
        dateTime: "2026-07-20T10:30:00.000Z",
        customerPhone: customer.phone,
      }, "44444444-4444-4444-8444-444444444444"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );

    expect(response.status).toBe(201);
    expect(await prisma.appointmentService.count()).toBe(2);
  });

  it("5. member de outro tenant rejeita", async () => {
    const tenantA = await seedTenant("a");
    const tenantB = await seedTenant("b");
    const customer = await makeCustomer("5");
    const response = await publicBook(
      publicRequest({
        memberId: tenantB.joao.id,
        serviceIds: [tenantA.cut.id],
        dateTime: "2026-07-20T11:00:00.000Z",
        customerPhone: customer.phone,
      }, "55555555-5555-4555-8555-555555555555", tenantA.shop.slug),
      { params: Promise.resolve({ slug: tenantA.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("PROFESSIONAL_NOT_AVAILABLE");
  });

  it("6. service de outro tenant rejeita", async () => {
    const tenantA = await seedTenant("a");
    const tenantB = await seedTenant("b");
    const customer = await makeCustomer("6");
    const response = await publicBook(
      publicRequest({
        memberId: tenantA.joao.id,
        serviceIds: [tenantB.cut.id],
        dateTime: "2026-07-20T11:30:00.000Z",
        customerPhone: customer.phone,
      }, "66666666-6666-4666-8666-666666666666", tenantA.shop.slug),
      { params: Promise.resolve({ slug: tenantA.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("INVALID_SERVICE_SELECTION");
  });

  it("7. member inativo rejeita", async () => {
    const tenant = await seedTenant("a");
    await prisma.barbershopMember.update({ where: { id: tenant.joao.id }, data: { isActive: false } });
    const customer = await makeCustomer("7");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.cut.id],
        dateTime: "2026-07-20T12:00:00.000Z",
        customerPhone: customer.phone,
      }, "77777777-7777-4777-8777-777777777777"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("PROFESSIONAL_NOT_AVAILABLE");
  });

  it("8. service inativo rejeita", async () => {
    const tenant = await seedTenant("a");
    await prisma.service.update({ where: { id: tenant.cut.id }, data: { isActive: false } });
    const customer = await makeCustomer("8");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.cut.id],
        dateTime: "2026-07-20T12:30:00.000Z",
        customerPhone: customer.phone,
      }, "88888888-8888-4888-8888-888888888888"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("INVALID_SERVICE_SELECTION");
  });

  it("9. vinculo removido rejeita", async () => {
    const tenant = await seedTenant("a");
    await prisma.barberService.delete({ where: { barberId_serviceId: { barberId: tenant.joao.id, serviceId: tenant.cut.id } } });
    const customer = await makeCustomer("9");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.joao.id,
        serviceIds: [tenant.cut.id],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: customer.phone,
      }, "99999999-9999-4999-8999-999999999999"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );

    expect(response.status).toBe(422);
  });

  it("10. availability com member incompatível retorna sem slots", async () => {
    const tenant = await seedTenant("a");
    const response = await availability(
      availabilityRequest(tenant.shop.slug, `memberId=${tenant.joao.id}&serviceIds=${tenant.beard.id}&date=2026-07-20`),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.totalDuration).toBe(30);
    expect(data.results).toEqual([]);
  });

  it("11. availability sem memberId retorna apenas elegiveis ALL", async () => {
    const tenant = await seedTenant("a");
    const response = await availability(
      availabilityRequest(tenant.shop.slug, `serviceIds=${tenant.cut.id},${tenant.beard.id}&date=2026-07-20`),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results.map((result: { memberId: string }) => result.memberId)).toEqual([tenant.ana.id]);
  });

  it("12. admin create incompatível rejeita", async () => {
    const tenant = await seedTenant("a");
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });
    const response = await adminCreate(
      adminRequest({
        memberId: tenant.joao.id,
        customerId: tenant.customer.id,
        serviceIds: [tenant.beard.id],
        dateTime: "2026-07-20T13:30:00.000Z",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
  });

  it("13. reschedule incompatível rejeita", async () => {
    const tenant = await seedTenant("a");
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.joao.id,
        customerId: tenant.customer.id,
        dateTime: new Date("2026-07-20T14:00:00.000Z"),
        totalPrice: "50.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.cut.id, priceApplied: "50.00" }] },
      },
    });

    const response = await adminUpdate(adminPutRequest(appointment.id, { serviceIds: [tenant.beard.id] }), {
      params: Promise.resolve({ id: appointment.id }),
    });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
  });

  it("14. time-only legacy incompatível permitido", async () => {
    const tenant = await seedTenant("a");
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });
    const legacy = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.joao.id,
        customerId: tenant.customer.id,
        dateTime: new Date("2026-07-20T15:00:00.000Z"),
        totalPrice: "40.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.beard.id, priceApplied: "40.00" }] },
      },
    });

    const response = await adminUpdate(adminPutRequest(legacy.id, { dateTime: "2026-07-20T15:30:00.000Z" }), {
      params: Promise.resolve({ id: legacy.id }),
    });
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: legacy.id } });

    expect(response.status).toBe(200);
    expect(updated.dateTime.toISOString()).toBe("2026-07-20T15:30:00.000Z");
  });

  it("15. duplicate serviceIds normaliza de forma deterministica", async () => {
    const tenant = await seedTenant("a");
    const customer = await makeCustomer("15");
    const response = await publicBook(
      publicRequest({
        memberId: tenant.ana.id,
        serviceIds: [tenant.cut.id, tenant.cut.id, tenant.beard.id],
        dateTime: "2026-07-20T16:00:00.000Z",
        customerPhone: customer.phone,
      }, "15151515-1515-4515-8515-151515151515"),
      { params: Promise.resolve({ slug: tenant.shop.slug }) }
    );
    const appointment = await prisma.appointment.findFirstOrThrow({
      include: { services: true },
    });

    expect(response.status).toBe(201);
    expect(appointment.durationMin).toBe(60);
    expect(appointment.services).toHaveLength(2);
  });

  it("16. GET /api/admin/services padrão inclui ativos e inativos, e activeOnly=true filtra", async () => {
    const tenant = await seedTenant("b");
    await prisma.service.update({ where: { id: tenant.cut.id }, data: { isActive: false } });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });

    const resDefault = await adminServicesGet(new NextRequest("http://localhost/api/admin/services"));
    expect(resDefault.status).toBe(200);
    const servicesDefault = await resDefault.json();
    expect(servicesDefault.map((s: { id: string }) => s.id).sort()).toEqual([tenant.cut.id, tenant.beard.id].sort());

    const resActiveOnly = await adminServicesGet(new NextRequest("http://localhost/api/admin/services?activeOnly=true"));
    expect(resActiveOnly.status).toBe(200);
    const servicesActiveOnly = await resActiveOnly.json();
    expect(servicesActiveOnly).toHaveLength(1);
    expect(servicesActiveOnly[0].id).toBe(tenant.beard.id);
  });

  it("17. admin create rejeita servico inativo", async () => {
    const tenant = await seedTenant("c");
    await prisma.service.update({ where: { id: tenant.cut.id }, data: { isActive: false } });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });

    const response = await adminCreate(
      adminRequest({
        memberId: tenant.joao.id,
        customerId: tenant.customer.id,
        services: [{ serviceId: tenant.cut.id, quantity: 1 }],
        dateTime: "2026-07-20T14:30:00.000Z",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("INVALID_SERVICE_SELECTION");
    expect(data.message).toBe("Um ou mais serviços selecionados não estão mais disponíveis. Atualize a seleção e tente novamente.");
  });

  it("18. admin create cria agendamento com services [{serviceId, quantity}] valido", async () => {
    const tenant = await seedTenant("d");
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: tenant.adminUser.id, role: "OWNER", memberId: tenant.owner.id, barbershopId: tenant.shop.id },
    });

    const response = await adminCreate(
      adminRequest({
        memberId: tenant.joao.id,
        customerId: tenant.customer.id,
        services: [{ serviceId: tenant.cut.id, quantity: 2 }],
        dateTime: "2026-07-20T15:00:00.000Z",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: data.id },
      include: { services: true },
    });
    expect(appointment.notes).toContain(`[[TEMBARBER_SERVICE_QUANTITIES_V1:{"${tenant.cut.id}":2}]]`);
  });
});
