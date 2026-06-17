import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findFirst: vi.fn(), update: vi.fn() },
    comanda: { findFirst: vi.fn(), update: vi.fn() },
    financialEntry: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { PATCH as adminPatch } from "@/app/api/admin/appointments/[id]/route";
import { PATCH as clientPatch } from "@/app/api/client/appointments/route";

function request(url: string, body: unknown) {
  return new NextRequest(url, { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T10:00:00.000Z"));
  getAdminSessionMock.mockResolvedValue({
    error: null,
    data: { userId: "admin-a", role: "OWNER", memberId: "owner-a", barbershopId: "shop-a" },
  });
  getServerSessionMock.mockResolvedValue({ user: { id: "customer-a", role: "USER" } });
  prismaMock.appointment.findFirst.mockResolvedValue({
    id: "appointment-a",
    customerId: "customer-a",
    barbershopId: "shop-a",
    dateTime: new Date("2026-07-21T10:00:00.000Z"),
    status: "CONFIRMED",
  });
  prismaMock.appointment.update.mockImplementation(async ({ where, data }: any) => ({
    id: where.id,
    ...data,
  }));
  prismaMock.comanda.findFirst.mockResolvedValue(null);
  prismaMock.financialEntry.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (cb: any) => await cb(prismaMock));
});

describe("cancelamento de agendamentos", () => {
  it("admin cancela agendamento do proprio tenant", async () => {
    const response = await adminPatch(
      request("http://localhost/api/admin/appointments/appointment-a", { status: "CANCELLED" }),
      { params: Promise.resolve({ id: "appointment-a" }) }
    );

    expect(response.status).toBe(200);
    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: "appointment-a", barbershopId: "shop-a" },
    });
    expect(prismaMock.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "appointment-a" },
        data: { status: "CANCELLED" },
      })
    );
  });

  it("admin nao cancela agendamento de outro tenant", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await adminPatch(
      request("http://localhost/api/admin/appointments/appointment-b", { status: "CANCELLED" }),
      { params: Promise.resolve({ id: "appointment-b" }) }
    );

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it("cliente cancela o proprio agendamento futuro", async () => {
    const response = await clientPatch(
      request("http://localhost/api/client/appointments", { id: "appointment-a" })
    );

    expect(response.status).toBe(200);
    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: "appointment-a", customerId: "customer-a" },
    });
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({
      where: { id: "appointment-a" },
      data: { status: "CANCELLED" },
    });
  });

  it("cliente nao cancela agendamento de outro cliente", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await clientPatch(
      request("http://localhost/api/client/appointments", { id: "appointment-b" })
    );

    expect(response.status).toBe(404);
    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it("cancelamento altera status e nao apaga o agendamento", async () => {
    await clientPatch(request("http://localhost/api/client/appointments", { id: "appointment-a" }));

    expect(prismaMock.appointment.update).toHaveBeenCalledWith({
      where: { id: "appointment-a" },
      data: { status: "CANCELLED" },
    });
    expect((prismaMock.appointment as { delete?: unknown }).delete).toBeUndefined();
  });
});
