import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ComandaItemStatus } from "@prisma/client";
import { localDateToUTCBoundary, shiftDateISO } from "@/lib/time-utils";

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

describeIf("Filtros de data e relatorio de comissoes", () => {
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

  it("calcula corretamente os limites de data locais convertidos para UTC", () => {
    // 2026-06-25 local começa em 2026-06-25T03:00:00.000Z em UTC (America/Sao_Paulo UTC-3)
    const start = localDateToUTCBoundary("2026-06-25");
    expect(start.toISOString()).toBe("2026-06-25T03:00:00.000Z");

    // shiftDateISO de 2026-06-25 mais 1 dia retorna 2026-06-26
    const nextDayStr = shiftDateISO("2026-06-25", 1);
    expect(nextDayStr).toBe("2026-06-26");

    const end = localDateToUTCBoundary(nextDayStr);
    expect(end.toISOString()).toBe("2026-06-26T03:00:00.000Z");
  });

  it("verifica se a query de CommissionEntry e CommissionAdjustment filtra corretamente pelas datas locais convertidas para UTC", async () => {
    // Seed barbearia e barbeiro
    const shop = await prisma.barbershop.create({
      data: {
        name: "Test Shop",
        slug: "test-shop",
        phone: "11999999999",
        zipCode: "00000-000",
        street: "Rua Teste",
        number: "1",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
      },
    });

    const user = await prisma.user.create({ data: { name: "Barber", phone: "11999999998" } });
    const member = await prisma.barbershopMember.create({
      data: { barbershopId: shop.id, userId: user.id, role: "BARBER" },
    });

    const category = await prisma.category.create({
      data: { barbershopId: shop.id, name: "Servicos", slug: "servicos" },
    });
    const service = await prisma.service.create({
      data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "100.00", durationMin: 30 },
    });

    // Criar comanda fechada localmente em 2026-06-25T02:00:00.000Z (que seria dia 24/06 local - 23:00)
    // E outra comanda fechada localmente em 2026-06-25T05:00:00.000Z (que seria dia 25/06 local - 02:00)
    
    // Comanda 1: fechada em 2026-06-25T02:00:00Z (dia 24 local)
    const comanda1 = await prisma.comanda.create({
      data: {
        barbershopId: shop.id,
        customerName: "Cliente 1",
        closedAt: new Date("2026-06-25T02:00:00.000Z"), // dia 24 local
        status: "CLOSED",
      },
    });
    const item1 = await prisma.comandaItem.create({
      data: {
        comandaId: comanda1.id,
        barbershopId: shop.id,
        type: "SERVICE",
        description: "Corte",
        quantity: 1,
        unitPrice: 100,
        total: 100,
        serviceId: service.id,
        executorId: member.id,
        status: "DONE",
      },
    });

    // Comanda 2: fechada em 2026-06-25T05:00:00Z (dia 25 local)
    const comanda2 = await prisma.comanda.create({
      data: {
        barbershopId: shop.id,
        customerName: "Cliente 2",
        closedAt: new Date("2026-06-25T05:00:00.000Z"), // dia 25 local
        status: "CLOSED",
      },
    });
    const item2 = await prisma.comandaItem.create({
      data: {
        comandaId: comanda2.id,
        barbershopId: shop.id,
        type: "SERVICE",
        description: "Corte",
        quantity: 1,
        unitPrice: 100,
        total: 100,
        serviceId: service.id,
        executorId: member.id,
        status: "DONE",
      },
    });

    // Criar as entradas de comissão correspondentes
    await prisma.commissionEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item1.id,
        memberId: member.id,
        configSnapshot: {},
        baseAmount: 100,
        generatedAmount: 50,
        releasedAmount: 50,
        competence: "2026-06",
        status: "RELEASED",
      },
    });

    await prisma.commissionEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item2.id,
        memberId: member.id,
        configSnapshot: {},
        baseAmount: 100,
        generatedAmount: 50,
        releasedAmount: 50,
        competence: "2026-06",
        status: "RELEASED",
      },
    });

    // Filtrar apenas o dia 2026-06-25 local
    const startDate = localDateToUTCBoundary("2026-06-25"); // 2026-06-25T03:00:00Z
    const endDate = localDateToUTCBoundary(shiftDateISO("2026-06-25", 1)); // 2026-06-26T03:00:00Z

    const filteredEntries = await prisma.commissionEntry.findMany({
      where: {
        barbershopId: shop.id,
        memberId: member.id,
        OR: [
          {
            comandaItem: {
              comanda: {
                closedAt: { gte: startDate, lt: endDate },
              },
            },
          },
          {
            comandaItem: {
              comanda: {
                closedAt: null,
              },
            },
            createdAt: { gte: startDate, lt: endDate },
          },
        ],
      },
      include: { comandaItem: { include: { comanda: true } } },
    });

    // Deve retornar apenas a entrada da comanda 2 (fechada em 2026-06-25T05:00:00Z, que está no intervalo [T03:00, T03:00 do dia seguinte))
    expect(filteredEntries).toHaveLength(1);
    expect(filteredEntries[0].comandaItem.comanda.customerName).toBe("Cliente 2");
  });
});
