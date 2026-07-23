import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
    customerBarbershopLink: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { GET as getClientAppointments } from "@/app/api/client/appointments/route";
import { GET as getLinkedBarbershops } from "@/app/api/client/linked-barbershops/route";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.appointment.findMany.mockResolvedValue([]);
  prismaMock.comanda.findMany.mockResolvedValue([]);
  prismaMock.customerBarbershopLink.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue({ phone: "5517981275471" });
});

describe("client auth guards", () => {
  it("bloqueia GET /api/client/appointments para usuario nao autenticado", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/client/appointments");
    const response = await getClientAppointments(req);

    expect(response.status).toBe(401);
  });

  it("permite GET /api/client/appointments para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    const req = new NextRequest("http://localhost/api/client/appointments");
    const response = await getClientAppointments(req);

    expect(response.status).toBe(200);
    expect(prismaMock.appointment.findMany).toHaveBeenCalled();
  });

  it("permite GET /api/client/linked-barbershops para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    prismaMock.customerBarbershopLink.findMany.mockResolvedValue([{ barbershopId: "shop-a" }]);

    const response = await getLinkedBarbershops();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.linkedBarbershopIds).toEqual(["shop-a"]);
  });

  it("permite GET /api/client/linked-barbershops para sessao forte", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "verified_link" },
    });

    prismaMock.appointment.findMany.mockResolvedValue([{ barbershopId: "shop-a" }]);
    prismaMock.comanda.findMany.mockResolvedValue([{ barbershopId: "shop-b" }]);

    const response = await getLinkedBarbershops();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.linkedBarbershopIds).toEqual(["shop-a", "shop-b"]);
  });
});
