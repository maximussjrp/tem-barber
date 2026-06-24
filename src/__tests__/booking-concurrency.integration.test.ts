import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";

type PublicPost = typeof import("@/app/api/public/barbershop/[slug]/book/route").POST;
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
let publicBook: PublicPost;
let adminCreate: AdminPost;
let adminUpdate: AdminPut;

function publicRequest(body: unknown, key: string, slug = "shop-a") {
  return new NextRequest(`http://localhost/api/public/barbershop/${slug}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
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

async function seedTenant(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `shop-${label}`,
      phone: `110000000${label.charCodeAt(0)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  const admin = await prisma.user.create({
    data: { name: `Admin ${label}`, phone: `119900000${label.charCodeAt(0)}` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barbeiro ${label}`, phone: `119911000${label.charCodeAt(0)}` },
  });
  const customer = await prisma.user.create({
    data: { name: `Cliente ${label}`, phone: `119922000${label.charCodeAt(0)}` },
  });
  const member = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: admin.id, role: "OWNER" },
  });
  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Corte", slug: "corte" },
  });
  const service = await prisma.service.create({
    data: {
      barbershopId: shop.id,
      categoryId: category.id,
      name: `Corte ${label}`,
      price: "50.00",
      durationMin: 30,
    },
  });

  await prisma.barberService.create({
    data: { barberId: member.id, serviceId: service.id },
  });

  return { shop, admin, owner, barberUser, customer, member, category, service };
}

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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

describeIf("concorrencia e idempotencia de agendamentos com PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    getServerSessionMock.mockResolvedValue(null);

    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    publicBook = (await import("@/app/api/public/barbershop/[slug]/book/route")).POST;
    adminCreate = (await import("@/app/api/admin/appointments/route")).POST;
    adminUpdate = (await import("@/app/api/admin/appointments/[id]/route")).PUT;
  });

  beforeEach(async () => {
    await truncateDatabase();
    getServerSessionMock.mockResolvedValue(null);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("duas chamadas simultaneas com a mesma chave retornam o mesmo agendamento", async () => {
    const tenant = await seedTenant("a");
    const body = {
      memberId: tenant.member.id,
      serviceIds: [tenant.service.id],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerPhone: tenant.customer.phone,
    };

    const [first, second] = await Promise.all([
      publicBook(publicRequest(body, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), {
        params: Promise.resolve({ slug: tenant.shop.slug }),
      }),
      publicBook(publicRequest(body, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), {
        params: Promise.resolve({ slug: tenant.shop.slug }),
      }),
    ]);

    const payloads = await Promise.all([first.json(), second.json()]);
    const statuses = [first.status, second.status].sort();
    const appointments = await prisma.appointment.findMany();

    expect(statuses).toEqual([200, 201]);
    expect(payloads[0].appointment.id).toBe(payloads[1].appointment.id);
    expect(appointments).toHaveLength(1);
  });

  it("duas chaves diferentes para o mesmo intervalo geram uma reserva e um 409", async () => {
    const tenant = await seedTenant("a");
    const body = {
      memberId: tenant.member.id,
      serviceIds: [tenant.service.id],
      dateTime: "2026-07-20T14:00:00.000Z",
      customerPhone: tenant.customer.phone,
    };

    const responses = await Promise.all([
      publicBook(publicRequest(body, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), {
        params: Promise.resolve({ slug: tenant.shop.slug }),
      }),
      publicBook(publicRequest(body, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"), {
        params: Promise.resolve({ slug: tenant.shop.slug }),
      }),
    ]);
    const errors = await Promise.all(responses.map((response) => response.clone().json()));
    const appointments = await prisma.appointment.findMany();

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(errors.some((data) => data.error === "SLOT_UNAVAILABLE")).toBe(true);
    expect(appointments).toHaveLength(1);
  });

  it("permite horarios adjacentes, profissionais diferentes e tenants diferentes", async () => {
    const tenantA = await seedTenant("a");
    const tenantB = await seedTenant("b");
    const secondBarberUser = await prisma.user.create({
      data: { name: "Barbeiro extra", phone: "11993300000" },
    });
    const secondMember = await prisma.barbershopMember.create({
      data: { barbershopId: tenantA.shop.id, userId: secondBarberUser.id, role: "BARBER" },
    });

    const base = { serviceIds: [tenantA.service.id], customerPhone: tenantA.customer.phone };
    const responses = await Promise.all([
      publicBook(
        publicRequest(
          { ...base, memberId: tenantA.member.id, dateTime: "2026-07-20T15:00:00.000Z" },
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          tenantA.shop.slug
        ),
        { params: Promise.resolve({ slug: tenantA.shop.slug }) }
      ),
      publicBook(
        publicRequest(
          { ...base, memberId: tenantA.member.id, dateTime: "2026-07-20T15:30:00.000Z" },
          "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          tenantA.shop.slug
        ),
        { params: Promise.resolve({ slug: tenantA.shop.slug }) }
      ),
      publicBook(
        publicRequest(
          { ...base, memberId: secondMember.id, dateTime: "2026-07-20T15:00:00.000Z" },
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
          tenantA.shop.slug
        ),
        { params: Promise.resolve({ slug: tenantA.shop.slug }) }
      ),
      publicBook(
        publicRequest(
          {
            memberId: tenantB.member.id,
            serviceIds: [tenantB.service.id],
            dateTime: "2026-07-20T15:00:00.000Z",
            customerPhone: tenantB.customer.phone,
          },
          "99999999-9999-4999-8999-999999999999",
          tenantB.shop.slug
        ),
        { params: Promise.resolve({ slug: tenantB.shop.slug }) }
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect(await prisma.appointment.count()).toBe(4);
  });

  it("endpoint admin rejeita criacao sobreposta e PUT nao altera o original em conflito", async () => {
    const tenant = await seedTenant("a");
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: {
        userId: tenant.admin.id,
        role: "OWNER",
        memberId: tenant.owner.id,
        barbershopId: tenant.shop.id,
      },
    });

    const first = await adminCreate(
      adminRequest({
        memberId: tenant.member.id,
        customerId: tenant.customer.id,
        serviceIds: [tenant.service.id],
        dateTime: "2026-07-20T16:00:00.000Z",
      })
    );
    const conflict = await adminCreate(
      adminRequest({
        memberId: tenant.member.id,
        customerId: tenant.customer.id,
        serviceIds: [tenant.service.id],
        dateTime: "2026-07-20T16:15:00.000Z",
      })
    );
    const second = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.member.id,
        customerId: tenant.customer.id,
        dateTime: new Date("2026-07-20T17:00:00.000Z"),
        totalPrice: "50.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.service.id, priceApplied: "50.00" }] },
      },
    });
    const putConflict = await adminUpdate(adminPutRequest(second.id, {
      dateTime: "2026-07-20T16:00:00.000Z",
    }), {
      params: Promise.resolve({ id: second.id }),
    });
    const unchanged = await prisma.appointment.findUniqueOrThrow({ where: { id: second.id } });

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(putConflict.status).toBe(409);
    expect(unchanged.dateTime.toISOString()).toBe("2026-07-20T17:00:00.000Z");
  });
});
