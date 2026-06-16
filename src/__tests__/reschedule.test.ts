import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const txMock = {
  appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
  appointment: { update: vi.fn() },
};

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findFirst: vi.fn(), update: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { PUT } from "@/app/api/admin/appointments/[id]/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/appointments/appointment-a", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminSessionMock.mockResolvedValue({
    error: null,
    data: { userId: "admin-a", role: "OWNER", memberId: "owner-a", barbershopId: "shop-a" },
  });
  prismaMock.appointment.findFirst.mockResolvedValue({
    id: "appointment-a",
    barbershopId: "shop-a",
    memberId: "member-old",
    dateTime: new Date("2026-07-20T13:00:00.000Z"),
    totalPrice: "40.00",
    durationMin: 30,
    status: "CONFIRMED",
  });
  prismaMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-new", barbershopId: "shop-a" });
  prismaMock.service.findMany.mockResolvedValue([
    { id: "svc-new-a", price: "50.00", durationMin: 45 },
    { id: "svc-new-b", price: "25.50", durationMin: 30 },
  ]);
  txMock.appointmentService.deleteMany.mockResolvedValue({ count: 2 });
  txMock.appointmentService.createMany.mockResolvedValue({ count: 2 });
  txMock.appointment.update.mockImplementation(async ({ data }) => ({ id: "appointment-a", ...data }));
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof txMock) => unknown) => callback(txMock));
});

describe("reagendamento administrativo", () => {
  it("altera data e horario", async () => {
    await PUT(
      request({ dateTime: "2026-07-22T14:30:00.000Z" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(txMock.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dateTime: new Date("2026-07-22T14:30:00.000Z"),
        }),
      })
    );
  });

  it("altera profissional validando tenant", async () => {
    await PUT(
      request({ memberId: "member-new" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-new", barbershopId: "shop-a", isActive: true },
    });
    expect(txMock.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memberId: "member-new" }),
      })
    );
  });

  it("altera servicos, recalcula preco e duracao", async () => {
    await PUT(
      request({ serviceIds: ["svc-new-a", "svc-new-b"] }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-new-a", "svc-new-b"] }, barbershopId: "shop-a", isActive: true },
    });
    expect(txMock.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 75.5,
          durationMin: 75,
        }),
      })
    );
  });

  it("substitui AppointmentService dentro da transacao", async () => {
    await PUT(
      request({ serviceIds: ["svc-new-a", "svc-new-b"] }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(txMock.appointmentService.deleteMany).toHaveBeenCalledWith({
      where: { appointmentId: "appointment-a" },
    });
    expect(txMock.appointmentService.createMany).toHaveBeenCalledWith({
      data: [
        { appointmentId: "appointment-a", serviceId: "svc-new-a", priceApplied: "50.00" },
        { appointmentId: "appointment-a", serviceId: "svc-new-b", priceApplied: "25.50" },
      ],
    });
  });

  it("protege multi-tenant ao buscar agendamento existente", async () => {
    await PUT(
      request({ dateTime: "2026-07-22T14:30:00.000Z" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: "appointment-a", barbershopId: "shop-a" },
    });
  });

  it("nao reagenda agendamento de outro tenant", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await PUT(
      request({ dateTime: "2026-07-22T14:30:00.000Z" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(response.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
