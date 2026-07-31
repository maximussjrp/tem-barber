import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import prisma from "@/lib/prisma";
import { normalizeBrazilPhone, isValidBrazilMobilePhone, sanitizePhoneForLog } from "@/lib/phone-utils";
import { blockCustomer, unblockCustomer, listBlockedCustomers, isCustomerOrPhoneBlocked } from "@/lib/operations/blocked-customers";
import * as bookRoute from "@/app/api/public/barbershop/[slug]/book/route";
import { NextRequest } from "next/server";

const testDatabaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || "";
const isSafeTestDatabase =
  Boolean(testDatabaseUrl) &&
  /match_barber|localhost|127\.0\.0\.1|5434|5439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);

function createNextRequest(url: string, method = "GET", body?: unknown, headers?: Record<string, string>): NextRequest {
  const reqHeaders = new Headers(headers ?? {});
  if (body) reqHeaders.set("Content-Type", "application/json");
  return new NextRequest(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Customer Blocklist Integration", () => {
  beforeAll(() => {
    if (!isSafeTestDatabase) {
      throw new Error("customer-blocklist.integration.test.ts requires a safe test database");
    }
  });
  let tenantAId: string;
  let tenantBId: string;
  let tenantASlug: string;
  let ownerUserId: string;
  let ownerMemberId: string;
  let barberUserId: string;
  let barberMemberId: string;
  let serviceId: string;

  beforeEach(async () => {
    // Seed test environment
    const ownerUser = await prisma.user.create({
      data: {
        name: "Owner User",
        email: `owner-${Date.now()}@test.com`,
        phone: `55179${Math.floor(10000000 + Math.random() * 90000000)}`,
        role: "SUPER_ADMIN",
      },
    });
    ownerUserId = ownerUser.id;

    const barbershopA = await prisma.barbershop.create({
      data: {
        name: `Barbearia A ${Date.now()}`,
        slug: `barbearia-a-${Date.now()}`,
        phone: "5517991089190",
        zipCode: "15000000",
        street: "Rua A",
        number: "100",
        neighborhood: "Centro",
        city: "São José do Rio Preto",
        state: "SP",
      },
    });
    tenantAId = barbershopA.id;
    tenantASlug = barbershopA.slug;

    const barbershopB = await prisma.barbershop.create({
      data: {
        name: `Barbearia B ${Date.now()}`,
        slug: `barbearia-b-${Date.now()}`,
        phone: "5517991089191",
        zipCode: "15000000",
        street: "Rua B",
        number: "200",
        neighborhood: "Centro",
        city: "São José do Rio Preto",
        state: "SP",
      },
    });
    tenantBId = barbershopB.id;
    tenantBSlug = barbershopB.slug;

    const plan = await prisma.plan.create({
      data: {
        name: `Plano Teste ${Date.now()}`,
        price: 99.0,
        maxMembers: 10,
      },
    });

    const futureDate = new Date(Date.now() + 30 * 86400000);

    await prisma.tenantSubscription.create({
      data: {
        barbershop: { connect: { id: tenantAId } },
        plan: { connect: { id: plan.id } },
        status: "ACTIVE",
        currentPeriodEnd: futureDate,
      },
    });

    await prisma.tenantSubscription.create({
      data: {
        barbershop: { connect: { id: tenantBId } },
        plan: { connect: { id: plan.id } },
        status: "ACTIVE",
        currentPeriodEnd: futureDate,
      },
    });

    const ownerMember = await prisma.barbershopMember.create({
      data: {
        barbershopId: tenantAId,
        userId: ownerUserId,
        role: "OWNER",
      },
    });
    ownerMemberId = ownerMember.id;

    const barberUser = await prisma.user.create({
      data: {
        name: "Barber User",
        email: `barber-${Date.now()}@test.com`,
        phone: `55179${Math.floor(10000000 + Math.random() * 90000000)}`,
        role: "USER",
      },
    });
    barberUserId = barberUser.id;

    const barberMember = await prisma.barbershopMember.create({
      data: {
        barbershopId: tenantAId,
        userId: barberUserId,
        role: "BARBER",
      },
    });
    barberMemberId = barberMember.id;

    const cat = await prisma.category.create({
      data: {
        barbershopId: tenantAId,
        name: "Cabelo",
        slug: `cabelo-${Date.now()}`,
      },
    });

    const svc = await prisma.service.create({
      data: {
        barbershopId: tenantAId,
        categoryId: cat.id,
        name: "Corte Tradicional",
        price: 50.0,
        durationMin: 30,
      },
    });
    serviceId = svc.id;

    await prisma.barberService.create({
      data: {
        barberId: barberMemberId,
        serviceId: serviceId,
      },
    });
  });

  it("1. Normaliza telefone com máscara e DDI +55", () => {
    expect(normalizeBrazilPhone("(17) 99123-4567")).toBe("5517991234567");
    expect(normalizeBrazilPhone("+55 (17) 99123-4567")).toBe("5517991234567");
  });

  it("2. Retém dígitos de telefone inválido no bloqueio administrativo", () => {
    const norm = normalizeBrazilPhone("1818999943");
    expect(norm).toBe("1818999943");
  });

  it("3. Rejeita telefone móvel inválido na validação estrita pública", () => {
    expect(isValidBrazilMobilePhone("1818999943")).toBe(false);
    expect(isValidBrazilMobilePhone("1199999999999")).toBe(false);
  });

  it("4. Aceita telefone móvel brasileiro válido na validação estrita", () => {
    expect(isValidBrazilMobilePhone("5517991089190")).toBe(true);
  });

  it("5. Permite bloqueio administrativo mesmo de telefone inválido/suspeito", async () => {
    const res = await blockCustomer({
      barbershopId: tenantAId,
      phone: "1818999943",
      reason: "Telefone suspeito com agendamentos falsos",
      executorUserId: ownerUserId,
      executorMemberId: ownerMemberId,
    });

    expect(res.block.phoneNormalized).toBe("1818999943");
    expect(res.block.active).toBe(true);
  });

  it("6. Exige motivo com no mínimo 5 caracteres ao bloquear", async () => {
    await expect(
      blockCustomer({
        barbershopId: tenantAId,
        phone: "1818999943",
        reason: "abc",
        executorUserId: ownerUserId,
      })
    ).rejects.toThrow("no mínimo 5 caracteres");
  });

  it("7. Executa Upsert sem duplicação de bloqueio", async () => {
    const first = await blockCustomer({
      barbershopId: tenantAId,
      phone: "1818999943",
      reason: "Motivo inicial de bloqueio",
      executorUserId: ownerUserId,
    });

    const second = await blockCustomer({
      barbershopId: tenantAId,
      phone: "1818999943",
      reason: "Motivo atualizado de bloqueio",
      executorUserId: ownerUserId,
    });

    expect(first.block.id).toBe(second.block.id);
    expect(second.block.reason).toBe("Motivo atualizado de bloqueio");

    const total = await prisma.barbershopBlockedCustomer.count({
      where: { barbershopId: tenantAId, phoneNormalized: "1818999943" },
    });
    expect(total).toBe(1);
  });

  it("8. Cancela automaticamente apenas agendamentos futuros ativos", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Cliente Teste",
        email: `c-${Date.now()}-${Math.random()}@test.com`,
        phone: `55179${Math.floor(10000000 + Math.random() * 90000000)}`,
      },
    });

    const futureDate = new Date(Date.now() + 86400000);
    const pastDate = new Date(Date.now() - 86400000);

    const futureAppt = await prisma.appointment.create({
      data: {
        barbershopId: tenantAId,
        memberId: barberMemberId,
        customerId: customer.id,
        dateTime: futureDate,
        totalPrice: 50.0,
        durationMin: 30,
        status: "CONFIRMED",
      },
    });

    const pastAppt = await prisma.appointment.create({
      data: {
        barbershopId: tenantAId,
        memberId: barberMemberId,
        customerId: customer.id,
        dateTime: pastDate,
        totalPrice: 50.0,
        durationMin: 30,
        status: "COMPLETED",
      },
    });

    const res = await blockCustomer({
      barbershopId: tenantAId,
      userId: customer.id,
      reason: "Cliente em lista negra",
      executorUserId: ownerUserId,
    });

    expect(res.cancelledFutureAppointmentsCount).toBe(1);

    const updatedFuture = await prisma.appointment.findUnique({ where: { id: futureAppt.id } });
    expect(updatedFuture?.status).toBe("CANCELLED");

    const updatedPast = await prisma.appointment.findUnique({ where: { id: pastAppt.id } });
    expect(updatedPast?.status).toBe("COMPLETED");
  });

  it("9. Não altera histórico, comandas pagas ou financeiro ao bloquear", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Cliente Historico",
        email: `ch-${Date.now()}-${Math.random()}@test.com`,
        phone: `55179${Math.floor(10000000 + Math.random() * 90000000)}`,
      },
    });

    const pastDate = new Date(Date.now() - 86400000);
    const pastAppt = await prisma.appointment.create({
      data: {
        barbershopId: tenantAId,
        memberId: barberMemberId,
        customerId: customer.id,
        dateTime: pastDate,
        totalPrice: 50.0,
        durationMin: 30,
        status: "COMPLETED",
      },
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: tenantAId,
        appointmentId: pastAppt.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        status: "CLOSED",
        subtotal: 50.0,
        total: 50.0,
        paidTotal: 50.0,
        remainingTotal: 0.0,
      },
    });

    await blockCustomer({
      barbershopId: tenantAId,
      userId: customer.id,
      reason: "Bloqueando cliente com historico",
      executorUserId: ownerUserId,
    });

    const checkComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(checkComanda?.status).toBe("CLOSED");
  });

  it("10. Recusa bloqueio automático se houver comanda aberta vinculada a agendamento futuro", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Cliente Comanda Aberta",
        email: `cca-${Date.now()}-${Math.random()}@test.com`,
        phone: `55179${Math.floor(10000000 + Math.random() * 90000000)}`,
      },
    });

    const futureDate = new Date(Date.now() + 86400000);
    const futureAppt = await prisma.appointment.create({
      data: {
        barbershopId: tenantAId,
        memberId: barberMemberId,
        customerId: customer.id,
        dateTime: futureDate,
        totalPrice: 50.0,
        durationMin: 30,
        status: "CONFIRMED",
      },
    });

    await prisma.comanda.create({
      data: {
        barbershopId: tenantAId,
        appointmentId: futureAppt.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        status: "OPEN",
        subtotal: 50.0,
        total: 50.0,
        paidTotal: 0.0,
        remainingTotal: 50.0,
      },
    });

    await expect(
      blockCustomer({
        barbershopId: tenantAId,
        userId: customer.id,
        reason: "Tentativa com comanda aberta",
        executorUserId: ownerUserId,
      })
    ).rejects.toThrow("existe uma comanda aberta");
  });

  it("11. Desbloqueia cliente alterando active=false e registrando auditoria", async () => {
    const blockRes = await blockCustomer({
      barbershopId: tenantAId,
      phone: "5517998877662",
      reason: "Motivo inicial de teste",
      executorUserId: ownerUserId,
    });

    const unblocked = await unblockCustomer({
      barbershopId: tenantAId,
      blockId: blockRes.block.id,
      reason: "Erro sanado pelo responsável",
      executorUserId: ownerUserId,
    });

    expect(unblocked.active).toBe(false);
    expect(unblocked.unblockReason).toBe("Erro sanado pelo responsável");
    expect(unblocked.unblockedAt).not.toBeNull();
  });

  it("12. Exige motivo com no mínimo 5 caracteres ao desbloquear", async () => {
    const blockRes = await blockCustomer({
      barbershopId: tenantAId,
      phone: "5517998877661",
      reason: "Bloqueio para teste de erro",
      executorUserId: ownerUserId,
    });

    await expect(
      unblockCustomer({
        barbershopId: tenantAId,
        blockId: blockRes.block.id,
        reason: "ok",
        executorUserId: ownerUserId,
      })
    ).rejects.toThrow("no mínimo 5 caracteres");
  });

  it("13. Listagem retorna telefones sanitizados em log/API", async () => {
    await blockCustomer({
      barbershopId: tenantAId,
      phone: "5517991089190",
      reason: "Teste de sanitizacao de listagem",
      executorUserId: ownerUserId,
    });

    const res = await listBlockedCustomers({ barbershopId: tenantAId });
    expect(res.blocks.length).toBeGreaterThan(0);
    expect(res.blocks[0].phoneSanitized).not.toBe("5517991089190");
    expect(res.blocks[0].phoneSanitized).toContain("****");
  });

  it("14. Garante isolamento tenant-scoped (bloqueado em A, permitido em B)", async () => {
    await blockCustomer({
      barbershopId: tenantAId,
      phone: "5517998877660",
      reason: "Bloqueado na Barbearia A",
      executorUserId: ownerUserId,
    });

    const blockedInA = await isCustomerOrPhoneBlocked({
      barbershopId: tenantAId,
      phone: "5517998877660",
    });
    expect(blockedInA).toBe(true);

    const blockedInB = await isCustomerOrPhoneBlocked({
      barbershopId: tenantBId,
      phone: "5517998877660",
    });
    expect(blockedInB).toBe(false);
  });

  it("15. Agendamento público com telefone inválido retorna 400 INVALID_PHONE", async () => {
    const futureDateStr = new Date(Date.now() + 86400000 * 2).toISOString();
    const req = createNextRequest(`http://localhost/api/public/barbershop/${tenantASlug}/book`, "POST", {
      memberId: barberMemberId,
      serviceIds: [serviceId],
      dateTime: futureDateStr,
      customerName: "Joao Teste Fake",
      customerPhone: "1818999943",
    });

    const res = await bookRoute.POST(req, { params: Promise.resolve({ slug: tenantASlug }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PHONE");
  });

  it("16. Agendamento público com telefone bloqueado retorna 403 CUSTOMER_BLOCKED", async () => {
    const validPhone = "5517991089192";
    await blockCustomer({
      barbershopId: tenantAId,
      phone: validPhone,
      reason: "Cliente inconveniente reportado",
      executorUserId: ownerUserId,
    });

    const futureDateStr = new Date(Date.now() + 86400000 * 2).toISOString();
    const req = createNextRequest(`http://localhost/api/public/barbershop/${tenantASlug}/book`, "POST", {
      memberId: barberMemberId,
      serviceIds: [serviceId],
      dateTime: futureDateStr,
      customerName: "Cliente Bloqueado",
      customerPhone: validPhone,
    });

    const res = await bookRoute.POST(req, { params: Promise.resolve({ slug: tenantASlug }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("CUSTOMER_BLOCKED");
  });

  it("17. Agendamento público bloqueia sem criar registros em banco", async () => {
    const validPhone = "5517991089193";
    await blockCustomer({
      barbershopId: tenantAId,
      phone: validPhone,
      reason: "Bloqueio preventivo total",
      executorUserId: ownerUserId,
    });

    const initialUsersCount = await prisma.user.count();
    const initialApptsCount = await prisma.appointment.count();

    const futureDateStr = new Date(Date.now() + 86400000 * 3).toISOString();
    const req = createNextRequest(`http://localhost/api/public/barbershop/${tenantASlug}/book`, "POST", {
      memberId: barberMemberId,
      serviceIds: [serviceId],
      dateTime: futureDateStr,
      customerName: "Tentativa Bloqueada",
      customerPhone: validPhone,
    });

    const res = await bookRoute.POST(req, { params: Promise.resolve({ slug: tenantASlug }) });
    expect(res.status).toBe(403);

    const finalUsersCount = await prisma.user.count();
    const finalApptsCount = await prisma.appointment.count();

    expect(finalUsersCount).toBe(initialUsersCount);
    expect(finalApptsCount).toBe(initialApptsCount);
  });

  it("18. Sanitização de log nunca imprime número completo", () => {
    const s1 = sanitizePhoneForLog("551818999943");
    const s2 = sanitizePhoneForLog("5517991089190");
    expect(s1).not.toBe("551818999943");
    expect(s2).not.toBe("5517991089190");
    expect(s1).toContain("****");
    expect(s2).toContain("****");
  });

  it("19. Telefone desbloqueado volta a conseguir agendar se telefone for válido", async () => {
    const validPhone = "5517991089194";
    const blockRes = await blockCustomer({
      barbershopId: tenantAId,
      phone: validPhone,
      reason: "Bloqueio temporario para teste",
      executorUserId: ownerUserId,
    });

    await unblockCustomer({
      barbershopId: tenantAId,
      blockId: blockRes.block.id,
      reason: "Desbloqueio autorizado para teste",
      executorUserId: ownerUserId,
    });

    const isBlocked = await isCustomerOrPhoneBlocked({
      barbershopId: tenantAId,
      phone: validPhone,
    });
    expect(isBlocked).toBe(false);
  });
});
