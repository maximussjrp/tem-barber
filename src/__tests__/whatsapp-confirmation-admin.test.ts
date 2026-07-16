import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashWhatsappConfirmationToken } from "@/lib/appointments/whatsapp-confirmation";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findFirst: vi.fn() },
    appointmentWhatsappConfirmation: { update: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { POST } from "@/app/api/admin/appointments/[id]/confirm-whatsapp/route";

function request(token: string) {
  return new NextRequest("http://localhost/api/admin/appointments/appointment-a/confirm-whatsapp", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

function adminSession(role = "OWNER") {
  return {
    error: null,
    data: { userId: "admin-a", role, memberId: "member-admin", barbershopId: "shop-a" },
  };
}

function confirmation(status = "PENDING") {
  return {
    id: "confirmation-a",
    appointmentId: "appointment-a",
    barbershopId: "shop-a",
    customerPhone: "5511999999999",
    status,
    tokenHash: hashWhatsappConfirmationToken("TB-123456"),
    tokenHint: "TB-****56",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    confirmedAt: null,
    confirmedById: null,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
  };
}

const params = { params: Promise.resolve({ id: "appointment-a" }) };

describe("POST /api/admin/appointments/[id]/confirm-whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue(adminSession());
    prismaMock.appointment.findFirst.mockResolvedValue({
      id: "appointment-a",
      barbershopId: "shop-a",
      whatsappConfirmation: confirmation(),
    });
    prismaMock.appointmentWhatsappConfirmation.update.mockResolvedValue({
      ...confirmation("CONFIRMED"),
      confirmedAt: new Date("2026-07-16T12:00:00.000Z"),
      confirmedById: "admin-a",
    });
  });

  it.each(["OWNER", "MANAGER"])("%s confirma token valido sem alterar appointment", async (role) => {
    getAdminSessionMock.mockResolvedValue(adminSession(role));

    const response = await POST(request("123456"), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "appointment-a", barbershopId: "shop-a" },
      })
    );
    expect(prismaMock.appointmentWhatsappConfirmation.update).toHaveBeenCalledWith({
      where: { appointmentId: "appointment-a" },
      data: {
        status: "CONFIRMED",
        confirmedAt: expect.any(Date),
        confirmedById: "admin-a",
      },
      select: {
        id: true,
        appointmentId: true,
        barbershopId: true,
        status: true,
        tokenHint: true,
        expiresAt: true,
        confirmedAt: true,
        confirmedById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(data.whatsappConfirmation.status).toBe("CONFIRMED");
    expect(data.whatsappConfirmation).not.toHaveProperty("tokenHash");
  });

  it("rejeita token incorreto", async () => {
    const response = await POST(request("TB-000000"), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("INVALID_WHATSAPP_CONFIRMATION_TOKEN");
    expect(prismaMock.appointmentWhatsappConfirmation.update).not.toHaveBeenCalled();
  });

  it("nao permite confirmar appointment de outro tenant", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const response = await POST(request("TB-123456"), params);

    expect(response.status).toBe(404);
    expect(prismaMock.appointmentWhatsappConfirmation.update).not.toHaveBeenCalled();
  });

  it("retorna confirmacao ja confirmada de forma idempotente", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({
      id: "appointment-a",
      barbershopId: "shop-a",
      whatsappConfirmation: {
        ...confirmation("CONFIRMED"),
        confirmedAt: new Date("2026-07-16T12:00:00.000Z"),
        confirmedById: "admin-a",
      },
    });

    const response = await POST(request("TB-000000"), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.whatsappConfirmation.status).toBe("CONFIRMED");
    expect(data.whatsappConfirmation).not.toHaveProperty("tokenHash");
    expect(prismaMock.appointmentWhatsappConfirmation.update).not.toHaveBeenCalled();
  });

  it("does not expose tokenHash in confirm-whatsapp responses", async () => {
    const response = await POST(request("TB-123456"), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.whatsappConfirmation).toEqual(
      expect.objectContaining({
        id: "confirmation-a",
        appointmentId: "appointment-a",
        barbershopId: "shop-a",
        status: "CONFIRMED",
        tokenHint: "TB-****56",
        confirmedById: "admin-a",
      })
    );
    expect(JSON.stringify(data)).not.toContain("tokenHash");
    expect(data.whatsappConfirmation).not.toHaveProperty("tokenHash");
  });

  it("rejeita SUPER_ADMIN sem papel operacional no tenant", async () => {
    getAdminSessionMock.mockResolvedValue(adminSession("SUPER_ADMIN"));

    const response = await POST(request("TB-123456"), params);

    expect(response.status).toBe(403);
    expect(prismaMock.appointment.findFirst).not.toHaveBeenCalled();
  });
});
