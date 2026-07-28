/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getMemberSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    timeOff: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
  },
  getMemberSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/member-api-auth", () => ({ getMemberSession: getMemberSessionMock }));

import { GET, POST } from "@/app/api/member/schedule-blocks/route";
import { DELETE } from "@/app/api/member/schedule-blocks/[id]/route";

describe("Member Schedule Blocks API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-123", memberId: "member-123", barbershopId: "shop-123", role: "BARBER" },
    });
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") return cb(prismaMock);
      return cb;
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-123",
      barbershopId: "shop-123",
      isActive: true,
    });
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.timeOff.findMany.mockResolvedValue([]);
    prismaMock.timeOff.create.mockImplementation(async ({ data }: any) => ({
      id: "block-1",
      ...data,
    }));
  });

  it("POST ignora memberId enviado no body e usa sessao", async () => {
    const req = new NextRequest("http://localhost/api/member/schedule-blocks", {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-07-28T10:00:00.000Z",
        endDate: "2026-07-28T11:00:00.000Z",
        reason: "Almoco",
        memberId: "other-member",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.memberId).toBe("member-123");
    expect(data.memberId).not.toBe("other-member");
  });

  it("POST rejeita motivo curto com 400", async () => {
    const req = new NextRequest("http://localhost/api/member/schedule-blocks", {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-07-28T10:00:00.000Z",
        endDate: "2026-07-28T11:00:00.000Z",
        reason: "ab",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("POST cria bloqueio parcial com sucesso", async () => {
    const req = new NextRequest("http://localhost/api/member/schedule-blocks", {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-07-28T14:00:00.000Z",
        endDate: "2026-07-28T15:00:00.000Z",
        reason: "Reuniao",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.allDay).toBe(false);
    expect(prismaMock.timeOff.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ memberId: "member-123", allDay: false }),
      })
    );
  });

  it("POST cria bloqueio allDay com fim exclusivo", async () => {
    const req = new NextRequest("http://localhost/api/member/schedule-blocks", {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-07-28",
        reason: "Ferias",
        allDay: true,
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.timeOff.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allDay: true,
          startDate: new Date("2026-07-28T00:00:00.000Z"),
          endDate: new Date("2026-07-29T00:00:00.000Z"),
        }),
      })
    );
  });

  it("DELETE rejeita bloqueio de outro profissional", async () => {
    prismaMock.timeOff.findUnique.mockResolvedValue({
      id: "block-other",
      memberId: "other-member",
      member: { id: "other-member", barbershopId: "shop-123" },
    });

    const req = new NextRequest("http://localhost/api/member/schedule-blocks/block-other", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "block-other" }) });

    expect(res.status).toBe(404);
    expect(prismaMock.timeOff.delete).not.toHaveBeenCalled();
  });

  it("DELETE exclui bloqueio proprio com sucesso", async () => {
    prismaMock.timeOff.findUnique.mockResolvedValue({
      id: "block-1",
      memberId: "member-123",
      member: { id: "member-123", barbershopId: "shop-123" },
    });

    const req = new NextRequest("http://localhost/api/member/schedule-blocks/block-1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "block-1" }) });

    expect(res.status).toBe(200);
    expect(prismaMock.timeOff.delete).toHaveBeenCalledWith({ where: { id: "block-1" } });
  });

  it("GET retorna apenas bloqueios do proprio profissional", async () => {
    prismaMock.timeOff.findMany.mockResolvedValue([
      {
        id: "block-1",
        memberId: "member-123",
        startDate: new Date("2026-07-28T13:00:00.000Z"),
        endDate: new Date("2026-07-28T14:00:00.000Z"),
        reason: "Reuniao",
        allDay: false,
      },
    ]);

    const req = new NextRequest("http://localhost/api/member/schedule-blocks?date=2026-07-28");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].memberId).toBe("member-123");
    expect(prismaMock.timeOff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: "member-123",
          endDate: { gte: new Date("2026-07-28T00:00:00.000Z") },
        }),
      })
    );
  });

  it("GET por data retorna legado start=end apos normalizacao", async () => {
    prismaMock.timeOff.findMany.mockResolvedValue([
      {
        id: "legacy-block",
        memberId: "member-123",
        startDate: new Date("2026-07-28T00:00:00.000Z"),
        endDate: new Date("2026-07-28T00:00:00.000Z"),
        reason: "Folga antiga",
        allDay: false,
      },
    ]);

    const req = new NextRequest("http://localhost/api/member/schedule-blocks?date=2026-07-28");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data[0].id).toBe("legacy-block");
    expect(data[0].allDay).toBe(true);
    expect(data[0].endDate).toBe("2026-07-29T00:00:00.000Z");
  });
});
