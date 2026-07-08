import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const txMock = {
  appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
  appointment: { update: vi.fn() },
  barbershopMember: { findFirst: vi.fn() },
  service: { findMany: vi.fn() },
  barberService: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
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
    services: [{ serviceId: "svc-current" }],
  });
  txMock.barbershopMember.findFirst.mockResolvedValue({ id: "member-new", barbershopId: "shop-a", isActive: true });
  txMock.service.findMany.mockImplementation(async ({ where }) => {
    const ids = where.id.in as string[];
    return ids.map((id) =>
      id === "svc-current"
        ? { id, price: "40.00", durationMin: 30 }
        : id === "svc-new-a"
          ? { id, price: "50.00", durationMin: 45 }
          : { id, price: "25.50", durationMin: 30 }
    );
  });
  txMock.barberService.findMany.mockImplementation(async ({ where }) =>
    (where.serviceId.in as string[]).map((serviceId) => ({ serviceId }))
  );
  prismaMock.service.findMany.mockResolvedValue([
    { id: "svc-new-a", price: "50.00", durationMin: 45 },
    { id: "svc-new-b", price: "25.50", durationMin: 30 },
  ]);
  txMock.appointmentService.deleteMany.mockResolvedValue({ count: 2 });
  txMock.appointmentService.createMany.mockResolvedValue({ count: 2 });
  txMock.$executeRaw.mockResolvedValue(0);
  txMock.$queryRaw.mockResolvedValue([]);
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

  it("permite alterar so horario mesmo se legado estiver sem vinculo atual", async () => {
    txMock.barberService.findMany.mockResolvedValue([]);

    const response = await PUT(
      request({ dateTime: "2026-07-22T14:30:00.000Z" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(response.status).toBe(200);
    expect(txMock.barbershopMember.findFirst).not.toHaveBeenCalled();
    expect(txMock.service.findMany).not.toHaveBeenCalled();
    expect(txMock.barberService.findMany).not.toHaveBeenCalled();
    expect(txMock.appointment.update).toHaveBeenCalled();
  });

  it("altera profissional validando tenant", async () => {
    await PUT(
      request({ memberId: "member-new" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(txMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-new", barbershopId: "shop-a", isActive: true },
      select: { id: true, barbershopId: true, isActive: true },
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

    expect(txMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-new-a", "svc-new-b"] }, barbershopId: "shop-a", isActive: true },
      select: { id: true, price: true, durationMin: true },
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
      include: { services: { select: { serviceId: true } } },
    });
  });

  it("rejeita reagendamento para profissional incompatível", async () => {
    txMock.barberService.findMany.mockResolvedValue([]);

    const response = await PUT(
      request({ memberId: "member-new" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
    expect(txMock.appointment.update).not.toHaveBeenCalled();
  });

  it("rejeita troca de servicos quando profissional atual nao executa todos", async () => {
    txMock.barberService.findMany.mockResolvedValue([{ serviceId: "svc-new-a" }]);

    const response = await PUT(
      request({ serviceIds: ["svc-new-a", "svc-new-b"] }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
    expect(txMock.appointment.update).not.toHaveBeenCalled();
  });

  it("valida a nova combinacao completa ao trocar profissional e servicos", async () => {
    await PUT(
      request({ memberId: "member-new", serviceIds: ["svc-new-a", "svc-new-b"] }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(txMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-new", barbershopId: "shop-a", isActive: true },
      select: { id: true, barbershopId: true, isActive: true },
    });
    expect(txMock.barberService.findMany).toHaveBeenCalledWith({
      where: { barberId: "member-new", serviceId: { in: ["svc-new-a", "svc-new-b"] } },
      select: { serviceId: true },
    });
    expect(txMock.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memberId: "member-new", totalPrice: 75.5, durationMin: 75 }),
      })
    );
  });

  it("bloqueia quando relacao foi removida e ha mudanca de profissional ou servico", async () => {
    txMock.barberService.findMany.mockResolvedValue([]);

    const response = await PUT(
      request({ memberId: "member-new", serviceIds: ["svc-new-a"] }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
    expect(txMock.appointment.update).not.toHaveBeenCalled();
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

  it("rejeita reagendamento para horario sobreposto", async () => {
    txMock.$queryRaw.mockResolvedValueOnce([{ id: "appointment-b" }]);

    const response = await PUT(
      request({ dateTime: "2026-07-22T14:30:00.000Z" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("SLOT_UNAVAILABLE");
    expect(txMock.appointment.update).not.toHaveBeenCalled();
  });
});
