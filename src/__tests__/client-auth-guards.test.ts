import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
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
});

describe("client auth guards", () => {
  it("bloqueia GET /api/client/appointments para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    const response = await getClientAppointments();
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Acesso restrito");
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });

  it("bloqueia GET /api/client/linked-barbershops para sessao phone_lookup", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", role: "USER", authLevel: "phone_lookup" },
    });

    const response = await getLinkedBarbershops();

    expect(response.status).toBe(403);
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.comanda.findMany).not.toHaveBeenCalled();
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
