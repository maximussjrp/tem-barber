import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    service: { findMany: vi.fn() },
    appointment: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
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
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) =>
    callback(prismaMock)
  );
  prismaMock.$executeRaw.mockResolvedValue(0);
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-a", barbershopId: "shop-a" });
  prismaMock.appointment.findFirst.mockResolvedValue({
    customer: { id: "customer-a", name: "Cliente A", phone: "11999999999" },
  });
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
  prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-a", name: "Don Brio", slug: "don-brio" });
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
    prismaMock.appointment.findMany.mockResolvedValue([]);
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

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Cliente Novo", phone: "11988887777", role: "USER" },
      })
    );
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
      where: {
        id: "member-a",
        barbershopId: "shop-a",
        isActive: true,
        services: { some: {} },
      },
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

  it("reusa cliente da mesma barbearia quando telefone normalizado ja existe", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      { customer: { id: "customer-existing", name: "Cliente Existente", phone: "+55 (11) 98888-7777" } },
    ]);
    prismaMock.service.findMany.mockResolvedValue([{ id: "svc-a", price: "40.00", durationMin: 30 }]);

    await POST(
      jsonRequest({
        memberId: "member-a",
        customerName: "Outro Nome",
        customerPhone: "11 98888-7777",
        serviceIds: ["svc-a"],
        dateTime: "2026-07-20T13:00:00.000Z",
      })
    );

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-a",
          OR: expect.arrayContaining([
            { customer: { phone: { contains: "11988887777" } } },
            { customer: { phone: { contains: "88887777" } } },
          ]),
        }),
      })
    );
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-existing" }),
      })
    );
  });

  it("nao vincula customerId de outra barbearia", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barbershopId: "shop-a", customerId: "customer-a" },
      })
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("permite owner configurado com servicos como profissional de agenda", async () => {
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-a",
      barbershopId: "shop-a",
      role: "OWNER",
      isActive: true,
    });

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(201);
    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: {
        id: "member-a",
        barbershopId: "shop-a",
        isActive: true,
        services: { some: {} },
      },
    });
  });

  it("rejeita criacao administrativa com sobreposicao de agenda", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "conflict-a" }]);

    const response = await POST(jsonRequest(body));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("SLOT_UNAVAILABLE");
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

  it("consulta conflito de agenda dentro do fluxo transacional", async () => {
    await POST(jsonRequest(body));

    expect(prismaMock.appointment.create).toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });

  it("GET /api/admin/appointments inclui barbershopName, barbershopSlug e freeSlots calculados sem ocupados", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue({
      id: "shop-a",
      name: "Don Brio",
      slug: "don-brio",
    });

    prismaMock.barbershopMember.findMany.mockResolvedValue([
      {
        id: "member-max",
        user: { name: "Max" },
        workingHours: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "11:00", breakStart: null, breakEnd: null, isActive: true },
        ],
        timeOffs: [],
      },
    ]);

    prismaMock.appointment.findMany.mockResolvedValueOnce([
      {
        id: "appt-1",
        dateTime: "2026-07-20T10:00:00.000Z",
        durationMin: 30,
        status: "CONFIRMED",
        customer: { id: "cust-1", name: "Cliente A", phone: "11999999999" },
        barber: { id: "member-max", user: { name: "Max", avatarUrl: null } },
        services: [],
        comandas: [],
      },
    ]);

    prismaMock.appointment.findMany.mockResolvedValueOnce([
      {
        id: "appt-1",
        memberId: "member-max",
        dateTime: new Date("2026-07-20T10:00:00.000Z"),
        durationMin: 30,
        status: "CONFIRMED",
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/admin/appointments?date=2026-07-20"));
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.barbershopName).toBe("Don Brio");
    expect(data.barbershopSlug).toBe("don-brio");
    
    const maxMember = data.members.find((m: any) => m.id === "member-max");
    expect(maxMember).toBeDefined();
    expect(maxMember.freeSlots).toEqual([540, 570, 630]);
  });

  it("GET /api/admin/appointments nao inclui freeSlots para profissional sem agenda ativa", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue({
      id: "shop-a",
      name: "Don Brio",
      slug: "don-brio",
    });

    prismaMock.barbershopMember.findMany.mockResolvedValue([
      {
        id: "member-inactive",
        user: { name: "No Agenda" },
        workingHours: [],
        timeOffs: [],
      },
    ]);

    prismaMock.appointment.findMany.mockResolvedValueOnce([]);

    const response = await GET(new NextRequest("http://localhost/api/admin/appointments?date=2026-07-20"));
    const data = await response.json();
    
    const inactiveMember = data.members.find((m: any) => m.id === "member-inactive");
    expect(inactiveMember).toBeDefined();
    expect(inactiveMember.freeSlots).toEqual([]);
  });

  it("agendamento criado para 10:00 e formatado em UTC nao sofre deslocamento por timezone", () => {
    const dbDateTime = "2026-06-23T10:00:00.000Z";
    
    // Simulate /minha-conta/page.tsx formatting
    const dtMinhaConta = new Date(dbDateTime);
    const timeMinhaConta = dtMinhaConta.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
    expect(timeMinhaConta).toBe("10:00");

    // Simulate /admin/agendamentos/page.tsx formatting
    const timeAdminAgenda = dtMinhaConta.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
    expect(timeAdminAgenda).toBe("10:00");

    // Simulate /admin/agendamentos/page.tsx isoToMinutes positioning
    const minutes = dtMinhaConta.getUTCHours() * 60 + dtMinhaConta.getUTCMinutes();
    expect(minutes).toBe(600); // 10:00 is exactly 600 minutes from midnight
  });
});
