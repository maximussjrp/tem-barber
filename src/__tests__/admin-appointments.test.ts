import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    service: { findMany: vi.fn() },
    appointment: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET, POST } from "@/app/api/admin/appointments/route";
import { GET as GET_BY_ID } from "@/app/api/admin/appointments/[id]/route";

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/appointments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const body = {
  memberId: "member-a",
  customerId: "customer-a",
  serviceIds: ["svc-a", "svc-b"],
  dateTime: "2026-07-20T13:00:00.000Z",
};

const services = [
  { id: "svc-a", price: "40.00", durationMin: 30 },
  { id: "svc-b", price: "35.50", durationMin: 45 },
];

function adminSession(role = "OWNER", barbershopId = "shop-a") {
  return { error: null, data: { userId: "admin-a", role, memberId: "member-admin", barbershopId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminSessionMock.mockResolvedValue(adminSession());
  prismaMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-a", barbershopId: "shop-a" });
  prismaMock.user.findFirst.mockResolvedValue({ id: "customer-existing", phone: "11999999999" });
  prismaMock.user.create.mockResolvedValue({ id: "customer-new", phone: "11999999999" });
  prismaMock.service.findMany.mockResolvedValue(services);
  prismaMock.appointment.create.mockImplementation(async ({ data }) => ({
    id: "appointment-a",
    ...data,
    customer: { id: data.customerId, name: "Cliente A", phone: "11999999999" },
    barber: { user: { name: "Barbeiro A", avatarUrl: null } },
    services: data.services.create,
  }));
  prismaMock.appointment.findMany.mockResolvedValue([]);
  prismaMock.appointment.count.mockResolvedValue(0);
  prismaMock.barbershopMember.findMany.mockResolvedValue([]);
});

describe("agendamento administrativo", () => {
  it.each(["OWNER", "MANAGER"])("%s autorizado cria agendamento", async (role) => {
    getAdminSessionMock.mockResolvedValue(adminSession(role));

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(201);
    expect(prismaMock.appointment.create).toHaveBeenCalled();
  });

  it("usuario sem permissao administrativa e rejeitado pelo guard", async () => {
    const error = Response.json({ error: "Acesso negado." }, { status: 403 });
    getAdminSessionMock.mockResolvedValue({ error, data: null });

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(403);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("cria com cliente existente informado por customerId", async () => {
    await POST(jsonRequest(body));

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-a" }),
      })
    );
  });

  it("cria novo cliente quando suportado por customerPhone", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.service.findMany.mockResolvedValue([{ id: "svc-a", price: "40.00", durationMin: 30 }]);

    await POST(
      jsonRequest({
        memberId: "member-a",
        customerName: "Cliente Novo",
        customerPhone: "(11) 98888-7777",
        serviceIds: ["svc-a"],
        dateTime: "2026-07-20T13:00:00.000Z",
      })
    );

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { name: "Cliente Novo", phone: "11988887777", role: "USER" },
    });
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-new" }),
      })
    );
  });

  it("vincula servicos e calcula preco e duracao", async () => {
    await POST(jsonRequest(body));

    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 75.5,
          durationMin: 75,
          services: {
            create: [
              { serviceId: "svc-a", priceApplied: "40.00" },
              { serviceId: "svc-b", priceApplied: "35.50" },
            ],
          },
        }),
      })
    );
  });

  it("isola criacao pelo barbershopId da sessao", async () => {
    await POST(jsonRequest(body));

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-a", barbershopId: "shop-a", isActive: true },
    });
    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-b"] }, barbershopId: "shop-a", isActive: true },
    });
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ barbershopId: "shop-a" }),
      })
    );
  });

  it("rejeita profissional de outro tenant", async () => {
    prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("nao acessa agendamento de outra barbearia", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await GET_BY_ID(
      new NextRequest("http://localhost/api/admin/appointments/appointment-b"),
      { params: Promise.resolve({ id: "appointment-b" }) }
    );

    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "appointment-b", barbershopId: "shop-a" } })
    );
    expect(response.status).toBe(404);
  });

  it("lista somente agendamentos do tenant da sessao", async () => {
    await GET(new NextRequest("http://localhost/api/admin/appointments?date=2026-07-20"));

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barbershopId: "shop-a" }),
      })
    );
  });

  it("registra lacuna: criacao administrativa ainda nao consulta conflito de agenda", async () => {
    await POST(jsonRequest(body));

    expect(prismaMock.appointment.create).toHaveBeenCalled();
    expect(prismaMock.appointment.findFirst).not.toHaveBeenCalled();
  });
});
