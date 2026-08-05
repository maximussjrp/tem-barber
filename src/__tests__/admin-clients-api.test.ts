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
import { GET as getClientDetail } from "@/app/api/admin/clients/[id]/route";

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
}

describe("P1 Clientes/CRM LOTE A API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session();
  });

  it("lista clientes por link, legado por appointment e deduplica por User.id", async () => {
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "manual-1" }]);
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
    expect(data.clients.find((c: { id: string }) => c.id === "legacy-1").sources.appointment).toBe(true);
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

  it("cria User novo, normaliza telefone e cria CustomerBarbershopLink do tenant da sessão", async () => {
    prismaMock.barbershopBlockedCustomer.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "new-user",
      name: "Novo Cliente",
      phone: "5517991089190",
      email: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.customerBarbershopLink.upsert.mockResolvedValueOnce({ id: "link-1", createdAt: new Date() });

    const response = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Novo Cliente",
      phone: "(17) 99108-9190",
      barbershopId: "evil-shop",
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe("new-user");
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: "5517991089190" },
      })
    );
    expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barbershopId_customerId: { barbershopId: "shop-a", customerId: "new-user" } },
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
    prismaMock.customerBarbershopLink.upsert.mockResolvedValueOnce({ id: "existing-link", createdAt: new Date() });

    const response = await createClient(req("http://localhost/api/admin/clients", "POST", {
      name: "Cliente Existente",
      phone: "5517991089190",
      email: "cliente@test.com",
    }));

    expect(response.status).toBe(201);
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
    prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
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
    expect(data.whatsapp.messages.invite).toContain("Cliente Completo");
    expect(prismaMock).not.toHaveProperty("customerContactLog");
  });
});
