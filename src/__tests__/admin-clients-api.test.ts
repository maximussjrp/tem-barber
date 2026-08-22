import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    customerBarbershopLink: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    comanda: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    customerClubSubscription: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    barbershopBlockedCustomer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    customerContactLog: {
      groupBy: vi.fn(),
    },
    barbershop: {
      findUnique: vi.fn(),
    },
    review: {
      findMany: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET as listClients, POST as createClient } from "@/app/api/admin/clients/route";
import { GET as searchClients } from "@/app/api/admin/clients/search/route";
import { GET as getClientDetail, PATCH as updateClientProfile } from "@/app/api/admin/clients/[id]/route";

function req(url: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function session() {
  getAdminSessionMock.mockResolvedValue({
    error: null,
    data: { userId: "admin-1", role: "OWNER", memberId: "member-1", barbershopId: "shop-a" },
  });
}

function emptyStatsQueries() {
  prismaMock.appointment.findMany.mockResolvedValueOnce([]);
  prismaMock.comanda.findMany.mockResolvedValueOnce([]);
  prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
  prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValueOnce([]);
  prismaMock.customerContactLog.groupBy.mockResolvedValueOnce([]);
}

describe("P1 Clientes/CRM LOTE A API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.customerBarbershopLink.findMany.mockResolvedValue([]);
    session();
  });

  it("lista clientes por link, legado por appointment e deduplica por User.id", async () => {
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "manual-1" }]);
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{
      customerId: "manual-1",
      birthDate: new Date("1992-05-14T00:00:00.000Z"),
      notes: "Notas tenant A",
    }]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([
      { customerId: "legacy-1" },
      { customerId: "manual-1" },
    ]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "legacy-1", name: "Cliente Legado", phone: "5517991089190", email: null, createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "manual-1", name: "Cliente Manual", phone: "5517991089191", email: null, createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    emptyStatsQueries();

    const response = await listClients(req("http://localhost/api/admin/clients"));
    const data = await response.json();

    expect(data.total).toBe(2);
    expect(data.clients.map((c: { id: string }) => c.id)).toEqual(["legacy-1", "manual-1"]);
    expect(data.clients.find((c: { id: string }) => c.id === "manual-1").sources.link).toBe(true);
    expect(data.clients.find((c: { id: string }) => c.id === "manual-1")).toMatchObject({
      birthDate: "1992-05-14",
      notes: "Notas tenant A",
    });
    expect(data.clients.find((c: { id: string }) => c.id === "legacy-1").sources.appointment).toBe(true);
    expect(data.clients.find((c: { id: string }) => c.id === "legacy-1")).toMatchObject({
      birthDate: null,
      notes: null,
    });
  });

  it("filtra sem agendamento e não vaza cliente de outro tenant", async () => {
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "manual-a" }]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([{ customerId: "legacy-a" }]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "manual-a", name: "Manual A", phone: "5517991089190", email: null, createdAt: new Date() },
      { id: "legacy-a", name: "Legacy A", phone: "5517991089191", email: null, createdAt: new Date() },
    ]);
    emptyStatsQueries();

    const response = await listClients(req("http://localhost/api/admin/clients?filter=without_appointment"));
    const data = await response.json();

    expect(prismaMock.customerBarbershopLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: "shop-a" } })
    );
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0].id).toBe("manual-a");
  });

  it("retorna dados e métricas de contato sem N+1 e preserva filtros antigos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([
      { customerId: "never" },
      { customerId: "old" },
      { customerId: "recent" },
    ]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([{ customerId: "recent" }]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "never", name: "Nunca", phone: "5517991089190", email: null, createdAt: new Date() },
      { id: "old", name: "Antigo", phone: "5517991089191", email: null, createdAt: new Date() },
      { id: "recent", name: "Recente", phone: "5517991089192", email: null, createdAt: new Date() },
    ]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([
      { customerId: "recent", status: "CONFIRMED", dateTime: new Date("2026-08-10T12:00:00.000Z") },
    ]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValueOnce([]);
    prismaMock.customerContactLog.groupBy.mockResolvedValueOnce([
      { customerId: "old", _max: { contactedAt: new Date("2026-06-01T12:00:00.000Z") }, _count: { _all: 2 } },
      { customerId: "recent", _max: { contactedAt: new Date("2026-08-03T12:00:00.000Z") }, _count: { _all: 1 } },
    ]);

    const response = await listClients(req("http://localhost/api/admin/clients"));
    const data = await response.json();

    expect(data.clients.find((c: { id: string }) => c.id === "never").stats).toMatchObject({
      lastContactedAt: null,
      contactLogCount: 0,
    });
    expect(data.clients.find((c: { id: string }) => c.id === "old").stats).toMatchObject({
      lastContactedAt: "2026-06-01T12:00:00.000Z",
      contactLogCount: 2,
    });
    expect(data.contactMetrics).toEqual({
      neverContacted: 1,
      noContact30: 2,
      recentlyContacted: 1,
    });
    expect(prismaMock.customerContactLog.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.customerContactLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["customerId"],
        where: { barbershopId: "shop-a", customerId: { in: ["never", "old", "recent"] } },
      })
    );
    expect(data.clients.find((c: { id: string }) => c.id === "recent").stats.nextAppointmentAt).toBe("2026-08-10T12:00:00.000Z");
    vi.useRealTimers();
  });

  it("filtra clientes por status de contato usando logs do tenant da sessão", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));

    async function runFilter(filter: string) {
      prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([
        { customerId: "never" },
        { customerId: "old30" },
        { customerId: "old60" },
        { customerId: "old90" },
        { customerId: "recent" },
      ]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);
      prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: "never", name: "Nunca", phone: "5517991089190", email: null, createdAt: new Date() },
        { id: "old30", name: "Trinta", phone: "5517991089191", email: null, createdAt: new Date() },
        { id: "old60", name: "Sessenta", phone: "5517991089192", email: null, createdAt: new Date() },
        { id: "old90", name: "Noventa", phone: "5517991089193", email: null, createdAt: new Date() },
        { id: "recent", name: "Recente", phone: "5517991089194", email: null, createdAt: new Date() },
      ]);
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);
      prismaMock.comanda.findMany.mockResolvedValueOnce([]);
      prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
      prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValueOnce([]);
      prismaMock.customerContactLog.groupBy.mockResolvedValueOnce([
        { customerId: "old30", _max: { contactedAt: new Date("2026-07-01T12:00:00.000Z") }, _count: { _all: 1 } },
        { customerId: "old60", _max: { contactedAt: new Date("2026-05-20T12:00:00.000Z") }, _count: { _all: 1 } },
        { customerId: "old90", _max: { contactedAt: new Date("2026-04-01T12:00:00.000Z") }, _count: { _all: 1 } },
        { customerId: "recent", _max: { contactedAt: new Date("2026-08-01T12:00:00.000Z") }, _count: { _all: 1 } },
      ]);
      const response = await listClients(req(`http://localhost/api/admin/clients?filter=${filter}`));
      const data = await response.json();
      return data.clients.map((c: { id: string }) => c.id);
    }

    await expect(runFilter("never_contacted")).resolves.toEqual(["never"]);
    await expect(runFilter("no_contact_30")).resolves.toEqual(["never", "old30", "old60", "old90"]);
    await expect(runFilter("no_contact_60")).resolves.toEqual(["never", "old60", "old90"]);
    await expect(runFilter("no_contact_90")).resolves.toEqual(["never", "old90"]);
    await expect(runFilter("recently_contacted")).resolves.toEqual(["recent"]);
    expect(prismaMock.customerContactLog.groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: "shop-a" }) })
    );
    vi.useRealTimers();
  });

  it("cria o vínculo tenant e preserva o round-trip exato da data civil e notes como texto", async () => {
    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "new-user",
      name: "Novo Cliente",
      phone: "5517991089190",
      email: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.customerBarbershopLink.upsert.mockResolvedValueOnce({
      id: "link-1",
      createdAt: new Date(),
      birthDate: new Date("1990-05-10T00:00:00.000Z"),
      notes: "<script>alert(1)</script>",
    });

    const response = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Novo Cliente",
      phone: "(17) 99108-9190",
      birthDate: "1990-05-10",
      notes: "  <script>alert(1)</script>  ",
      barbershopId: "evil-shop",
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe("new-user");
    expect(data.birthDate).toBe("1990-05-10");
    expect(data.notes).toBe("<script>alert(1)</script>");
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: "5517991089190" },
      })
    );
    expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barbershopId_customerId: { barbershopId: "shop-a", customerId: "new-user" } },
        create: expect.objectContaining({
          barbershopId: "shop-a",
          birthDate: new Date("1990-05-10T00:00:00.000Z"),
          notes: "<script>alert(1)</script>",
        }),
      })
    );
  });

  it("reutiliza User global existente e não duplica vínculo tenant", async () => {
    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "existing-user",
      name: "Cliente Existente",
      phone: "5517991089190",
      email: "cliente@test.com",
      createdAt: new Date(),
    });
    prismaMock.customerBarbershopLink.upsert.mockResolvedValueOnce({
      id: "existing-link",
      createdAt: new Date(),
      birthDate: null,
      notes: null,
    });

    const response = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente Existente",
      phone: "5517991089190",
      email: "cliente@test.com",
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.birthDate).toBeNull();
    expect(data.notes).toBeNull();
    expect(prismaMock.user.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenCalledTimes(1);
  });

  it("rejeita telefone inválido e telefone bloqueado", async () => {
    const invalidResponse = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente",
      phone: "123",
    }));
    expect(invalidResponse.status).toBe(400);
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();

    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce({ id: "block-1" });
    const blockedResponse = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente",
      phone: "5517991089190",
    }));
    expect(blockedResponse.status).toBe(409);
    expect(prismaMock.customerBarbershopLink.upsert).not.toHaveBeenCalled();
  });

  it("rejeita data futura, data civil invalida e observacoes acima de 1000 caracteres", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));

    for (const birthDate of ["2026-08-23", "2025-02-30", "1899-12-31"]) {
      const response = await createClient(req("http://localhost/api/admin/clients", "POST", {
        name: "Cliente",
        phone: "5517991089190",
        birthDate,
      }));
      expect(response.status).toBe(400);
    }
    vi.setSystemTime(new Date("2026-08-23T01:00:00.000Z"));
    const timezoneBoundaryResponse = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente",
      phone: "5517991089190",
      birthDate: "2026-08-23",
    }));
    expect(timezoneBoundaryResponse.status).toBe(400);
    const notesResponse = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente",
      phone: "5517991089190",
      notes: "x".repeat(1001),
    }));
    expect(notesResponse.status).toBe(400);
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("mantem birthDate e notes independentes para o mesmo User em dois tenants", async () => {
    const profiles = new Map([
      ["shop-a", { birthDate: new Date("1990-01-01T00:00:00.000Z"), notes: "Cliente A" }],
      ["shop-b", { birthDate: new Date("1991-02-02T00:00:00.000Z"), notes: "Cliente B" }],
    ]);
    prismaMock.customerBarbershopLink.findUnique.mockImplementation(({ where }) => {
      const key = where.barbershopId_customerId.barbershopId;
      return Promise.resolve(profiles.has(key) ? { id: `link-${key}` } : null);
    });
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.comanda.count.mockResolvedValue(0);
    prismaMock.customerClubSubscription.count.mockResolvedValue(0);
    prismaMock.customerBarbershopLink.upsert.mockImplementation(({ where, update }) => {
      const key = where.barbershopId_customerId.barbershopId;
      const current = profiles.get(key)!;
      const updated = { ...current, ...update };
      profiles.set(key, updated);
      return Promise.resolve(updated);
    });

    const responseA = await updateClientProfile(req("http://localhost/api/admin/clients/shared-user", "PATCH", {
      birthDate: "1990-05-10",
      notes: "Cliente A atualizado",
    }), { params: Promise.resolve({ id: "shared-user" }) });
    expect(profiles.get("shop-b")).toEqual({
      birthDate: new Date("1991-02-02T00:00:00.000Z"),
      notes: "Cliente B",
    });

    getAdminSessionMock.mockResolvedValueOnce({
      error: null,
      data: { userId: "admin-2", role: "OWNER", memberId: "member-2", barbershopId: "shop-b" },
    });
    const responseB = await updateClientProfile(req("http://localhost/api/admin/clients/shared-user", "PATCH", {
      birthDate: "1991-03-03",
      notes: "Cliente B atualizado",
    }), { params: Promise.resolve({ id: "shared-user" }) });

    await expect(responseA.json()).resolves.toEqual({ birthDate: "1990-05-10", notes: "Cliente A atualizado" });
    await expect(responseB.json()).resolves.toEqual({ birthDate: "1991-03-03", notes: "Cliente B atualizado" });
    expect(profiles.get("shop-a")).toEqual({
      birthDate: new Date("1990-05-10T00:00:00.000Z"),
      notes: "Cliente A atualizado",
    });
    expect(profiles.get("shop-b")).toEqual({
      birthDate: new Date("1991-03-03T00:00:00.000Z"),
      notes: "Cliente B atualizado",
    });
    expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { barbershopId_customerId: { barbershopId: "shop-a", customerId: "shared-user" } } })
    );
    expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { barbershopId_customerId: { barbershopId: "shop-b", customerId: "shared-user" } } })
    );
  });

  it("busca cliente manual por nome e telefone sem depender apenas de Appointment", async () => {
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "manual-1" }]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "manual-1", name: "Ana Manual", phone: "5517991089190", email: null, createdAt: new Date() },
    ]);
    emptyStatsQueries();

    const response = await searchClients(req("http://localhost/api/admin/clients/search?q=99108"));
    const data = await response.json();

    expect(data.clients).toEqual([
      { id: "manual-1", name: "Ana Manual", phone: "5517991089190", lastAppointmentAt: null },
    ]);
  });

  it("detalhe abre cliente manual sem appointment e bloqueia cliente sem vínculo tenant", async () => {
    prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({
      id: "link-1",
      birthDate: new Date("1992-05-14T00:00:00.000Z"),
      notes: "Notas tenant A",
    });
    prismaMock.appointment.count.mockResolvedValueOnce(0);
    prismaMock.comanda.count.mockResolvedValueOnce(0);
    prismaMock.customerClubSubscription.count.mockResolvedValueOnce(0);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "manual-1",
      name: "Manual",
      phone: "5517991089190",
      email: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.barbershop.findUnique.mockResolvedValueOnce({ name: "Barbearia A", slug: "barbearia-a" });
    prismaMock.appointment.findMany.mockResolvedValueOnce([]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findFirst.mockResolvedValueOnce(null);
    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);

    const ok = await getClientDetail(req("http://localhost/api/admin/clients/manual-1"), {
      params: Promise.resolve({ id: "manual-1" }),
    });
    const okData = await ok.json();
    expect(ok.status).toBe(200);
    expect(okData.history).toEqual([]);
    expect(okData.contactHistoryConfigured).toBe(true);
    expect(okData.birthDate).toBe("1992-05-14");
    expect(okData.notes).toBe("Notas tenant A");

    prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce(null);
    prismaMock.appointment.count.mockResolvedValueOnce(0);
    prismaMock.comanda.count.mockResolvedValueOnce(0);
    prismaMock.customerClubSubscription.count.mockResolvedValueOnce(0);
    const forbidden = await getClientDetail(req("http://localhost/api/admin/clients/other"), {
      params: Promise.resolve({ id: "other" }),
    });
    expect(forbidden.status).toBe(404);
  });

  it("detalhe mostra appointment, comanda, clube ativo, bloqueio e WhatsApp manual sem criar log", async () => {
    prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
    prismaMock.appointment.count.mockResolvedValueOnce(1);
    prismaMock.comanda.count.mockResolvedValueOnce(1);
    prismaMock.customerClubSubscription.count.mockResolvedValueOnce(1);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "client-1",
      name: "Cliente Completo",
      phone: "5517991089190",
      email: "c@test.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.barbershop.findUnique.mockResolvedValueOnce({ name: "Barbearia A", slug: "barbearia-a" });
    prismaMock.appointment.findMany.mockResolvedValueOnce([
      {
        id: "appt-1",
        dateTime: new Date("2026-08-10T13:00:00Z"),
        status: "CONFIRMED",
        bookingMode: "NORMAL",
        createdAt: new Date("2026-08-01T13:00:00Z"),
        totalPrice: 50,
        barber: { id: "barber-1", user: { name: "Barbeiro" } },
        services: [{ service: { id: "svc-1", name: "Corte" } }],
      },
    ]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([{ id: "cmd-1", status: "OPEN", paidTotal: 0 }]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findFirst.mockResolvedValueOnce({
      id: "sub-1",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      clubPlan: { id: "plan-1", name: "Gold" },
    });
    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce({
      id: "block-1",
      reason: "Teste",
      blockedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const response = await getClientDetail(req("http://localhost/api/admin/clients/client-1"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const data = await response.json();

    expect(data.metrics.totalAppointments).toBe(1);
    expect(data.comandaSummary.open).toBe(1);
    expect(data.clubSubscription.planName).toBe("Gold");
    expect(data.isBlocked).toBe(true);
    expect(data.whatsapp.link).toContain("https://wa.me/5517991089190");
    expect(data.whatsapp.messages.invite).toContain("Completo");
    expect(data.whatsapp.messages.invite).not.toContain("Cliente Completo");
    expect(prismaMock.customerContactLog.groupBy).not.toHaveBeenCalled();
  });
});
