import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    barbershopMember: { findMany: vi.fn(), findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { GET as availability } from "@/app/api/public/barbershop/[slug]/availability/route";

const params = { params: Promise.resolve({ slug: "barbearia-a" }) };

function availabilityRequest(query: string) {
  return new NextRequest(`http://localhost/api/public/barbershop/barbearia-a/availability?${query}`);
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-a",
    barbershopId: "shop-a",
    user: { name: "Barbeiro A" },
    workingHours: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null, isActive: true },
    ],
    timeOffs: [],
    ...overrides,
  };
}

async function slots(query = "memberId=member-a&serviceIds=svc-a&date=2026-07-20") {
  const response = await availability(availabilityRequest(query), params);
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-a", slug: "barbearia-a" });
  prismaMock.service.findMany.mockResolvedValue([{ id: "svc-a", durationMin: 60, price: "50.00" }]);
  prismaMock.barbershopMember.findFirst.mockResolvedValue(member());
  prismaMock.barbershopMember.findMany.mockResolvedValue([{ id: "member-a" }]);
  prismaMock.appointment.findMany.mockResolvedValue([]);
});

describe("disponibilidade publica", () => {
  it("retorna horario dentro da jornada", async () => {
    const { body } = await slots();

    expect(body.results[0].slots).toContain("09:00");
    expect(body.results[0].slots).toContain("17:00");
    expect(body.totalDuration).toBe(60);
  });

  it("nao retorna horario antes do inicio da jornada", async () => {
    const { body } = await slots();

    expect(body.results[0].slots).not.toContain("08:30");
  });

  it("nao retorna horario apos o final da jornada", async () => {
    const { body } = await slots();

    expect(body.results[0].slots).not.toContain("18:00");
  });

  it("nao retorna duracao que ultrapassa o fim da jornada", async () => {
    prismaMock.service.findMany.mockResolvedValue([{ id: "svc-a", durationMin: 90, price: "50.00" }]);

    const { body } = await slots();

    expect(body.results[0].slots).toContain("16:30");
    expect(body.results[0].slots).not.toContain("17:00");
  });

  it("remove horarios que cruzam intervalo de pausa", async () => {
    prismaMock.barbershopMember.findFirst.mockResolvedValue(
      member({
        workingHours: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00", isActive: true },
        ],
      })
    );

    const { body } = await slots();

    expect(body.results[0].slots).not.toContain("11:30");
    expect(body.results[0].slots).not.toContain("12:00");
    expect(body.results[0].slots).toContain("13:00");
  });

  it("bloqueia o dia quando ha TimeOff", async () => {
    prismaMock.barbershopMember.findFirst.mockResolvedValue(
      member({ timeOffs: [{ id: "time-off-a" }] })
    );

    const { body } = await slots();

    expect(body.results).toEqual([]);
  });

  it("remove conflito com agendamento PENDING ou CONFIRMED", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      { id: "appt-a", dateTime: new Date("2026-07-20T10:00:00.000Z"), durationMin: 60, status: "PENDING" },
      { id: "appt-b", dateTime: new Date("2026-07-20T15:00:00.000Z"), durationMin: 60, status: "CONFIRMED" },
    ]);

    const { body } = await slots();

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "CONFIRMED"] },
        }),
      })
    );
    expect(body.results[0].slots).not.toContain("09:30");
    expect(body.results[0].slots).not.toContain("10:00");
    expect(body.results[0].slots).not.toContain("14:30");
    expect(body.results[0].slots).not.toContain("15:00");
  });

  it("agendamento CANCELLED nao bloqueia porque a consulta filtra apenas ativos", async () => {
    const { body } = await slots();

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["PENDING", "CONFIRMED"] } }),
      })
    );
    expect(body.results[0].slots).toContain("10:00");
  });

  it("isola disponibilidade por barbeiro quando memberId e informado", async () => {
    await slots("memberId=member-b&serviceIds=svc-a&date=2026-07-20");

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "member-b", barbershopId: "shop-a", isActive: true },
      })
    );
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ memberId: "member-b" }) })
    );
  });

  it("isola por barbearia ao buscar servicos e membros", async () => {
    await slots("serviceIds=svc-a&date=2026-07-20");

    expect(prismaMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a"] }, barbershopId: "shop-a", isActive: true },
    });
    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith({
      where: {
        barbershopId: "shop-a",
        isActive: true,
        services: { some: { serviceId: { in: ["svc-a"] } } },
      },
      select: { id: true },
    });
  });
});
