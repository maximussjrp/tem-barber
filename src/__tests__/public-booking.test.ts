import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    appointment: { findFirst: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { POST } from "@/app/api/public/barbershop/[slug]/book/route";

const params = { params: Promise.resolve({ slug: "barbearia-a" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/public/barbershop/barbearia-a/book", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = {
  memberId: "member-a",
  serviceIds: ["svc-a", "svc-b"],
  dateTime: "2026-07-20T13:00:00.000Z",
  customerName: "Cliente A",
  customerPhone: "(11) 99999-9999",
};

const services = [
  { id: "svc-a", price: "40.00", durationMin: 30 },
  { id: "svc-b", price: "35.50", durationMin: 45 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue(null);
  prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-a", name: "Barbearia A", slug: "barbearia-a" });
  prismaMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-a", barbershopId: "shop-a", isActive: true });
  prismaMock.service.findMany.mockResolvedValue(services);
  prismaMock.appointment.findFirst.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue({ id: "customer-existing", phone: "11999999999" });
  prismaMock.user.create.mockResolvedValue({ id: "customer-new", phone: "11999999999" });
  prismaMock.appointment.create.mockImplementation(async ({ data }) => ({
    id: "appointment-a",
    ...data,
    customer: { id: data.customerId, name: "Cliente A", phone: "11999999999" },
    barber: { user: { name: "Barbeiro A" } },
    services: data.services.create.map((item: { serviceId: string; priceApplied: string }) => ({
      service: { name: item.serviceId, durationMin: 30 },
    })),
  }));
});

describe("agendamento publico", () => {
  it("aceita barbearia ativa e cria appointment com barbershopId correto", async () => {
    const response = await POST(request(validBody), params);

    expect(response.status).toBe(201);
    expect(prismaMock.barbershop.findUnique).toHaveBeenCalledWith({
      where: { slug: "barbearia-a", active: true },
    });
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ barbershopId: "shop-a" }),
      })
    );
  });

  it("rejeita barbearia inexistente ou inativa", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue(null);

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("valida profissional dentro da barbearia", async () => {
    await POST(request(validBody), params);

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-a", barbershopId: "shop-a", isActive: true },
    });
  });

  it("rejeita profissional invalido", async () => {
    prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("valida servicos ativos do tenant", async () => {
    await POST(request(validBody), params);

    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-b"] }, barbershopId: "shop-a", isActive: true },
    });
  });

  it("usa cliente existente localizado pelo telefone limpo", async () => {
    await POST(request(validBody), params);

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({ where: { phone: "11999999999" } });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-existing" }),
      })
    );
  });

  it("cria novo cliente quando telefone nao existe", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await POST(request(validBody), params);

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { name: "Cliente A", phone: "11999999999", role: "USER" },
    });
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-new" }),
      })
    );
  });

  it("cria AppointmentService com snapshots de preco", async () => {
    await POST(request(validBody), params);

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

  it("rejeita horario indisponivel por conflito ativo", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({
      id: "conflict-a",
      dateTime: new Date("2026-07-20T13:30:00.000Z"),
      durationMin: 30,
    });

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(409);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("registra a lacuna atual: nao valida explicitamente se o profissional executa todos os servicos", async () => {
    await POST(request(validBody), params);

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-a", barbershopId: "shop-a", isActive: true },
    });
  });
});
