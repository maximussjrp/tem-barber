import { describe, expect, it, vi, beforeEach } from "vitest";
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

import { POST as publicBook } from "@/app/api/public/barbershop/[slug]/book/route";

const params = { params: Promise.resolve({ slug: "barbearia-a" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/public/barbershop/barbearia-a/book", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function service(id: string, price: string, durationMin: number, barbershopId = "shop-a", isActive = true) {
  return { id, price, durationMin, barbershopId, isActive };
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue(null);
  prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-a", name: "Barbearia A" });
  prismaMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-a", barbershopId: "shop-a" });
  prismaMock.appointment.findFirst.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue({ id: "customer-a", phone: "11999999999" });
  prismaMock.appointment.create.mockImplementation(async ({ data }) => ({
    id: "appointment-a",
    ...data,
    dateTime: data.dateTime,
    customer: { id: "customer-a", name: "Cliente A", phone: "11999999999" },
    barber: { user: { name: "Barbeiro A" } },
    services: data.services.create.map((item: { serviceId: string; priceApplied: string }) => ({
      serviceId: item.serviceId,
      priceApplied: item.priceApplied,
      service: { name: item.serviceId, durationMin: 30 },
    })),
  }));
});

describe("calculo de servicos no agendamento publico", () => {
  it("soma duracao de um servico e salva snapshot de priceApplied", async () => {
    prismaMock.service.findMany.mockResolvedValue([service("svc-a", "30.50", 30)]);

    const response = await publicBook(
      request({
        memberId: "member-a",
        serviceIds: ["svc-a"],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: "(11) 99999-9999",
      }),
      params
    );

    expect(response.status).toBe(201);
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 30.5,
          durationMin: 30,
          services: { create: [{ serviceId: "svc-a", priceApplied: "30.50" }] },
        }),
      })
    );
  });

  it("soma duracao e precos de varios servicos", async () => {
    prismaMock.service.findMany.mockResolvedValue([
      service("svc-a", "30.50", 30),
      service("svc-b", "45.25", 45),
    ]);

    await publicBook(
      request({
        memberId: "member-a",
        serviceIds: ["svc-a", "svc-b"],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: "11999999999",
      }),
      params
    );

    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 75.75,
          durationMin: 75,
          services: {
            create: [
              { serviceId: "svc-a", priceApplied: "30.50" },
              { serviceId: "svc-b", priceApplied: "45.25" },
            ],
          },
        }),
      })
    );
  });

  it("rejeita servico inexistente", async () => {
    prismaMock.service.findMany.mockResolvedValue([service("svc-a", "30.00", 30)]);

    const response = await publicBook(
      request({
        memberId: "member-a",
        serviceIds: ["svc-a", "svc-missing"],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: "11999999999",
      }),
      params
    );

    expect(response.status).toBe(400);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita servico de outra barbearia pelo filtro barbershopId", async () => {
    prismaMock.service.findMany.mockResolvedValue([service("svc-a", "30.00", 30)]);

    const response = await publicBook(
      request({
        memberId: "member-a",
        serviceIds: ["svc-a", "svc-other-tenant"],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: "11999999999",
      }),
      params
    );

    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-other-tenant"] }, barbershopId: "shop-a", isActive: true },
    });
    expect(response.status).toBe(400);
  });

  it("rejeita servico inativo pelo filtro isActive", async () => {
    prismaMock.service.findMany.mockResolvedValue([]);

    const response = await publicBook(
      request({
        memberId: "member-a",
        serviceIds: ["svc-inactive"],
        dateTime: "2026-07-20T13:00:00.000Z",
        customerPhone: "11999999999",
      }),
      params
    );

    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-inactive"] }, barbershopId: "shop-a", isActive: true },
    });
    expect(response.status).toBe(400);
  });
});
