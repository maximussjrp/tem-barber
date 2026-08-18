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

  it("bloqueia GET /api/client/appointments para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    const req = new NextRequest("http://localhost/api/client/appointments");
    const response = await getClientAppointments(req);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Verificação necessária para acessar sua conta.",
    });
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });

  it("bloqueia GET /api/client/linked-barbershops para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    const response = await getLinkedBarbershops();
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: "Verificação necessária para acessar sua conta." });
    expect(prismaMock.customerBarbershopLink.findMany).not.toHaveBeenCalled();
  });

  it("permite os GETs para verified_otp", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "verified_otp" },
    });

    const appointmentsResponse = await getClientAppointments(
      new NextRequest("http://localhost/api/client/appointments")
    );
    const linkedResponse = await getLinkedBarbershops();

    expect(appointmentsResponse.status).toBe(200);
    expect(linkedResponse.status).toBe(200);
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

  it("nao concede acesso client para sessao admin", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-a", role: "OWNER", authLevel: "admin" },
    });

    const appointmentsResponse = await getClientAppointments(
      new NextRequest("http://localhost/api/client/appointments")
    );
    const linkedResponse = await getLinkedBarbershops();

    expect(appointmentsResponse.status).toBe(403);
    expect(linkedResponse.status).toBe(403);
  });
});
