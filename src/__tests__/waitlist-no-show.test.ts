import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  prismaMock,
  getAdminSessionMock,
  getMemberSessionMock,
  verifyWaitlistPublicTokenMock,
} = vi.hoisted(() => ({
  prismaMock: {
    onlineWaitlistEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    appointment: { create: vi.fn() },
    comanda: { create: vi.fn() },
    payment: { create: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
  getMemberSessionMock: vi.fn(),
  verifyWaitlistPublicTokenMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/member-api-auth", () => ({ getMemberSession: getMemberSessionMock }));
vi.mock("@/lib/waitlist/token", () => ({
  verifyWaitlistPublicToken: verifyWaitlistPublicTokenMock,
}));

import { POST as adminNoShow } from "@/app/api/admin/waitlist/no-show/route";
import { POST as memberNoShow } from "@/app/api/member/waitlist/no-show/route";
import { GET as publicTracking } from "@/app/api/public/barbershop/[slug]/waitlist/[entryId]/route";
import { calculateEntryPosition } from "@/lib/waitlist/positions";

const calledEntry = {
  id: "entry-joao",
  sessionId: "session-1",
  barbershopId: "shop-a",
  status: "CALLED",
  noShowCount: 2,
  fitInAppointmentId: null,
  calledByMemberId: "member-a",
  calledAt: new Date("2026-08-22T13:00:00.000Z"),
  publicTokenHash: "private-hash",
  positionWeight: 10,
  createdAt: new Date("2026-08-22T12:00:00.000Z"),
};

function request(path: string, entryId = calledEntry.id) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify({ entryId, memberId: "untrusted-member" }),
  });
}

describe("Fila online - não apareceu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "owner-a", barbershopId: "shop-a", role: "OWNER" },
    });
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "barber-a", barbershopId: "shop-a", memberId: "member-a", role: "BARBER" },
    });
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue(calledEntry);
    prismaMock.onlineWaitlistEntry.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.onlineWaitlistEntry.findUnique.mockResolvedValue({
      ...calledEntry,
      status: "NO_SHOW",
      noShowCount: 3,
    });
    verifyWaitlistPublicTokenMock.mockReturnValue(true);
  });

  it("faz CALLED -> NO_SHOW, incrementa uma vez, preserva auditoria e não cria efeitos operacionais", async () => {
    const response = await adminNoShow(request("/api/admin/waitlist/no-show"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.entry).toMatchObject({
      status: "NO_SHOW",
      noShowCount: 3,
      calledByMemberId: "member-a",
      calledAt: calledEntry.calledAt.toISOString(),
      fitInAppointmentId: null,
    });
    expect(data.entry.publicTokenHash).toBeUndefined();
    expect(prismaMock.onlineWaitlistEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: calledEntry.id,
        barbershopId: "shop-a",
        status: "CALLED",
        calledByMemberId: "member-a",
        fitInAppointmentId: null,
      }),
      data: expect.objectContaining({ status: "NO_SHOW", noShowCount: { increment: 1 } }),
    }));
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("dois no-show simultâneos produzem um sucesso, um 409 e um único incremento", async () => {
    let status = "CALLED";
    let noShowCount = 2;
    prismaMock.onlineWaitlistEntry.findFirst.mockImplementation(async () => ({ ...calledEntry, status, noShowCount }));
    prismaMock.onlineWaitlistEntry.updateMany.mockImplementation(async () => {
      if (status !== "CALLED") return { count: 0 };
      status = "NO_SHOW";
      noShowCount += 1;
      return { count: 1 };
    });
    prismaMock.onlineWaitlistEntry.findUnique.mockImplementation(async () => ({ ...calledEntry, status, noShowCount }));

    const [first, second] = await Promise.all([
      adminNoShow(request("/api/admin/waitlist/no-show")),
      adminNoShow(request("/api/admin/waitlist/no-show")),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(noShowCount).toBe(3);
    expect(first.status).not.toBe(500);
    expect(second.status).not.toBe(500);
  });

  it("membro B não marca cliente chamado pelo membro A e body não substitui a identidade autenticada", async () => {
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "barber-b", barbershopId: "shop-a", memberId: "member-b", role: "BARBER" },
    });

    const response = await memberNoShow(request("/api/member/waitlist/no-show"));

    expect(response.status).toBe(403);
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("permite MANAGER na rota admin e bloqueia BARBER", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "manager-a", barbershopId: "shop-a", role: "MANAGER" },
    });
    const managerResponse = await adminNoShow(request("/api/admin/waitlist/no-show"));

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "barber-a", barbershopId: "shop-a", role: "BARBER" },
    });
    const barberResponse = await adminNoShow(request("/api/admin/waitlist/no-show"));

    expect(managerResponse.status).toBe(200);
    expect(barberResponse.status).toBe(403);
  });

  it("bloqueia admin e membro cross-tenant", async () => {
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue(null);

    const adminResponse = await adminNoShow(request("/api/admin/waitlist/no-show", "entry-shop-b"));
    const memberResponse = await memberNoShow(request("/api/member/waitlist/no-show", "entry-shop-b"));

    expect(adminResponse.status).toBe(404);
    expect(memberResponse.status).toBe(404);
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("rejeita NO_SHOW em WAITING", async () => {
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({ ...calledEntry, status: "WAITING" });

    const response = await adminNoShow(request("/api/admin/waitlist/no-show"));

    expect(response.status).toBe(409);
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("rejeita NO_SHOW depois de FIT_IN_CREATED", async () => {
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      ...calledEntry,
      status: "FIT_IN_CREATED",
      fitInAppointmentId: "appointment-1",
    });

    const response = await adminNoShow(request("/api/admin/waitlist/no-show"));

    expect(response.status).toBe(409);
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("mantém Pedro e Carlos nas posições 1 e 2 porque apenas WAITING participa do cálculo", async () => {
    prismaMock.onlineWaitlistEntry.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const pedroPosition = await calculateEntryPosition(
      prismaMock as never,
      "session-1",
      20,
      new Date("2026-08-22T12:01:00.000Z")
    );
    const carlosPosition = await calculateEntryPosition(
      prismaMock as never,
      "session-1",
      30,
      new Date("2026-08-22T12:02:00.000Z")
    );

    expect([pedroPosition, carlosPosition]).toEqual([1, 2]);
    expect(prismaMock.onlineWaitlistEntry.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "WAITING" }),
    }));
  });

  it("tracking público retorna NO_SHOW sem posição ativa nem detalhes internos", async () => {
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      ...calledEntry,
      status: "NO_SHOW",
      noShowCount: 3,
      customerName: "João",
      customerPhone: "5517999999999",
      serviceId: "service-1",
      preferredMemberId: null,
      service: { name: "Corte" },
      preferredMember: null,
      calledByMember: { user: { name: "Barbeiro" } },
    });

    const response = await publicTracking(
      new NextRequest("http://localhost/api/public/barbershop/shop/waitlist/entry-joao?token=valid"),
      { params: Promise.resolve({ slug: "shop", entryId: "entry-joao" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.entry).toMatchObject({ status: "NO_SHOW", currentPosition: 0, noShowCount: 3 });
    expect(data.entry.publicTokenHash).toBeUndefined();
    expect(data.entry.calledByMemberId).toBeUndefined();
    expect(prismaMock.onlineWaitlistEntry.count).not.toHaveBeenCalled();
  });
});
