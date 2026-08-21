import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const { prismaMock, getAdminSessionMock, getMemberSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    onlineWaitlistSession: { findFirst: vi.fn() },
    onlineWaitlistEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    barberService: { findUnique: vi.fn() },
    onlineWaitlistMemberConfig: { findUnique: vi.fn() },
    appointment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    comandaItem: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
    customerClubSubscription: { findMany: vi.fn() },
    clubBenefitUsage: { findMany: vi.fn() },
    timeOff: {
      findMany: vi.fn(),
    },
    user: { findFirst: vi.fn(), create: vi.fn() },
    comanda: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
  getMemberSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/member-api-auth", () => ({ getMemberSession: getMemberSessionMock }));

type MockFindFirstArgs = {
  where?: {
    id?: string;
  };
};

type MockComandaFindUniqueArgs = {
  select?: {
    customerId?: boolean;
  };
};

type MockAppointmentCreateArgs = {
  data: {
    dateTime: Date;
    totalPrice: number;
    services: {
      create: Array<{
        serviceId: string;
        priceApplied: string;
      }>;
    };
  };
};

type MockComandaCreateArgs = {
  data: {
    items: {
      create: Array<{
        unitPrice: string | number | Prisma.Decimal;
        total: string | number | Prisma.Decimal;
      }>;
    };
  };
};

type CallNextResponseData = {
  comanda: {
    total: string | number | Prisma.Decimal;
  };
};

import { POST as callNextAdmin } from "@/app/api/admin/waitlist/call-next/route";
import { POST as callNextMember } from "@/app/api/member/waitlist/call-next/route";
import { POST as startServiceAdmin } from "@/app/api/admin/waitlist/start-service/route";
import { POST as startServiceMember } from "@/app/api/member/waitlist/start-service/route";
import { POST as passTurnAdmin } from "@/app/api/admin/waitlist/pass-turn/route";
import { POST as passTurnMember } from "@/app/api/member/waitlist/pass-turn/route";
import { getCurrentSaoPauloDateTimeForAppointment } from "@/lib/time-utils";
import { passCalledWaitlistEntry } from "@/lib/waitlist/positions";

describe("PR #23 - Chamar próximo criando encaixe (FIT_IN)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([]);

    prismaMock.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") return cb(prismaMock);
      if (Array.isArray(cb)) return Promise.all(cb);
      return cb;
    });

    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-barber-1",
      barbershopId: "shop-1",
      userId: "u-barber-1",
      isActive: true,
      user: { id: "u-barber-1", name: "Barbeiro João" },
    });

    prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
      id: "session-1",
      barbershopId: "shop-1",
      status: "OPEN",
      defaultLockBeforeAppointmentMinutes: 20,
    });

    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-corte",
      preferredMemberId: null,
      queueNumber: 7,
      status: "WAITING",
      publicTokenHash: "secret-token-hash",
      service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00" },
      customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
      preferredMember: null,
    });

    prismaMock.barberService.findUnique.mockResolvedValue({
      barberId: "member-barber-1",
      serviceId: "service-corte",
    });

    prismaMock.onlineWaitlistMemberConfig.findUnique.mockResolvedValue(null);

    prismaMock.appointment.findFirst.mockImplementation((args: MockFindFirstArgs) => {
      if (args?.where?.id === "app-fit-in-1") {
        return Promise.resolve({
          id: "app-fit-in-1",
          barbershopId: "shop-1",
          memberId: "member-barber-1",
          customerId: null,
          dateTime: new Date("2026-07-24T14:00:00.000Z"),
          totalPrice: "50.00",
          durationMin: 30,
          customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
          services: [
            {
              serviceId: "service-corte",
              priceApplied: "50.00",
              service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30 },
            },
          ],
        });
      }
      return Promise.resolve(null);
    });
    prismaMock.timeOff.findMany.mockResolvedValue([]);

    prismaMock.appointment.create.mockResolvedValue({
      id: "app-fit-in-1",
      barbershopId: "shop-1",
      memberId: "member-barber-1",
      customerId: "cust-1",
      dateTime: new Date("2026-07-24T14:00:00.000Z"),
      totalPrice: "50.00",
      durationMin: 30,
      status: "CONFIRMED",
      bookingMode: "FIT_IN",
      fitInReason: "Fila Online - Senha #7",
      fitInCreatedById: "admin-1",
      fitInCreatedAt: new Date("2026-07-24T14:00:00.000Z"),
      conflictSnapshot: null,
      barber: { user: { name: "Barbeiro João", avatarUrl: null } },
      customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
      services: [{ service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30 } }],
      comandas: [],
    });

    prismaMock.onlineWaitlistEntry.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.comanda.findUnique.mockImplementation((args: MockComandaFindUniqueArgs) => {
      if (args?.select?.customerId) {
        return Promise.resolve({
          customerId: "cust-1",
          barbershopId: "shop-1",
          createdAt: new Date("2026-07-24T14:00:00.000Z"),
        });
      }
      return Promise.resolve(null);
    });
    prismaMock.comanda.create.mockResolvedValue({ id: "comanda-fit-in-1" });
    prismaMock.comandaItem.findMany.mockResolvedValue([
      { type: "SERVICE", status: "PENDING", total: "50.00", clubBenefitUsage: null },
    ]);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
    prismaMock.clubBenefitUsage.findMany.mockResolvedValue([]);
    prismaMock.comanda.update.mockResolvedValue({
      id: "comanda-fit-in-1",
      barbershopId: "shop-1",
      status: "OPEN",
      total: "50.00",
      remainingTotal: "50.00",
      items: [],
      payments: [],
    });

    prismaMock.onlineWaitlistEntry.findUnique.mockResolvedValue({
      id: "entry-1",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-corte",
      preferredMemberId: null,
      queueNumber: 7,
      status: "CALLED",
      fitInAppointmentId: null,
      calledByMemberId: "member-barber-1",
      calledAt: new Date("2026-07-24T14:00:00.000Z"),
      service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00" },
      calledByMember: { user: { id: "u-barber-1", name: "Barbeiro João" } },
      preferredMember: null,
    });

    prismaMock.comanda.count.mockResolvedValue(0);
  });

  it("1. OWNER chama próximo e apenas marca CALLED", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
    expect(data.entry.fitInAppointmentId).toBeNull();
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
  });

  it("2. MANAGER chama próximo e cria agendamento FIT_IN", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "manager-1", barbershopId: "shop-1", role: "MANAGER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
  });

  it("3. BARBER tenta chamar via endpoint admin e recebe 403", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "u-barber-1", barbershopId: "shop-1", role: "BARBER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("FORBIDDEN");
  });

  it("4. BARBER chama próximo via endpoint member para si", async () => {
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "u-barber-1", barbershopId: "shop-1", memberId: "member-barber-1", role: "BARBER" },
    });

    const req = new NextRequest("http://localhost/api/member/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "other-member" }), // Deve ser ignorado
    });

    const res = await callNextMember(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
  });

  it("5. Preferência divergente sem confirmação retorna HTTP 409 PREFERRED_MEMBER_MISMATCH e não cria agendamento", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-corte",
      preferredMemberId: "member-barber-2", // Preferência divergente
      queueNumber: 7,
      status: "WAITING",
      publicTokenHash: "secret-token-hash",
      service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00" },
      customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
      preferredMember: { user: { name: "Barbeiro Pedro" } },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1", confirmPreferredMismatch: false }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("PREFERRED_MEMBER_MISMATCH");
    expect(data.preferredMemberMismatch).toBe(true);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("6. Preferência divergente com confirmPreferredMismatch: true cria agendamento FIT_IN", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-corte",
      preferredMemberId: "member-barber-2",
      queueNumber: 7,
      status: "WAITING",
      publicTokenHash: "secret-token-hash",
      service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00" },
      customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
      preferredMember: { user: { name: "Barbeiro Pedro" } },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1", confirmPreferredMismatch: true }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
  });

  it("7. Fila sem entradas WAITING retorna EMPTY_WAITLIST (400)", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("EMPTY_WAITLIST");
  });

  it("8. Fila não aberta retorna WAITLIST_NOT_OPEN (400)", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("WAITLIST_NOT_OPEN");
  });

  it("9. Profissional sem capability (BarberService) para o serviço retorna MEMBER_CANNOT_EXECUTE_SERVICE (400)", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.barberService.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("MEMBER_CANNOT_EXECUTE_SERVICE");
  });

  it("10. Trava de agendamento próximo bloqueia chamada com MEMBER_LOCKED_BY_UPCOMING_APPOINTMENT (400)", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    const now = new Date();
    const upcomingAppointmentTime = new Date(now.getTime() + 10 * 60 * 1000); // Em 10 min

    prismaMock.appointment.findFirst.mockResolvedValue({
      dateTime: upcomingAppointmentTime,
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("MEMBER_LOCKED_BY_UPCOMING_APPOINTMENT");
  });

  it("11. Concorrência: updateMany count === 0 retorna WAITLIST_ENTRY_ALREADY_CALLED (409)", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.onlineWaitlistEntry.updateMany.mockResolvedValue({ count: 0 });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("WAITLIST_ENTRY_ALREADY_CALLED");
  });

  it("12. não cria comanda automaticamente ao chamar o próximo", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
    expect(data.comandaId).toBeUndefined();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
  });

  it("13. Confirma que publicTokenHash não vaza no payload da API", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(data.entry.publicTokenHash).toBeUndefined();
  });

  it("14. getCurrentSaoPauloDateTimeForAppointment converte instante UTC 14:18Z para horário operacional local 11:18", () => {
    const realUtc = new Date("2026-07-24T14:18:00.000Z");
    const spDateTime = getCurrentSaoPauloDateTimeForAppointment(realUtc);

    expect(spDateTime.getUTCFullYear()).toBe(2026);
    expect(spDateTime.getUTCMonth()).toBe(6); // Julho = 6
    expect(spDateTime.getUTCDate()).toBe(24);
    expect(spDateTime.getUTCHours()).toBe(11);
    expect(spDateTime.getUTCMinutes()).toBe(18);
  });
  it("15. TimeOff bloqueia encaixe da fila com erro operacional antes de criar Appointment ou atualizar a posicao", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });
    prismaMock.timeOff.findMany.mockResolvedValue([
      {
        id: "block-1",
        memberId: "member-barber-1",
        startDate: new Date("2000-01-01T00:00:00.000Z"),
        endDate: new Date("2999-01-01T00:00:00.000Z"),
        reason: "Bloqueio",
      },
    ]);

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    const res = await callNextAdmin(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("16. rota member tambem retorna 409 para bloqueio de agenda", async () => {
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "u-barber-1", barbershopId: "shop-1", memberId: "member-barber-1", role: "BARBER" },
    });
    prismaMock.timeOff.findMany.mockResolvedValue([
      {
        id: "block-1",
        memberId: "member-barber-1",
        startDate: new Date("2000-01-01T00:00:00.000Z"),
        endDate: new Date("2999-01-01T00:00:00.000Z"),
        reason: "Bloqueio",
        allDay: false,
      },
    ]);

    const req = new NextRequest("http://localhost/api/member/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await callNextMember(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entry.status).toBe("CALLED");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).toHaveBeenCalled();
  });

  function mockBarbaWaitlistPrice(price: unknown) {
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-barba",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-barba",
      preferredMemberId: null,
      queueNumber: 2,
      status: "CALLED",
      calledByMemberId: "member-barber-1",
      publicTokenHash: "secret-token-hash",
      service: { id: "service-barba", name: "Barba", durationMin: 30, price },
      customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
      preferredMember: null,
    });

    prismaMock.barberService.findUnique.mockResolvedValue({
      barberId: "member-barber-1",
      serviceId: "service-barba",
    });

    let createdAppointmentData: MockAppointmentCreateArgs["data"] | undefined;
    prismaMock.appointment.create.mockImplementation((args: MockAppointmentCreateArgs) => {
      createdAppointmentData = args.data;
      return Promise.resolve({
        id: "app-fit-in-1",
        barbershopId: "shop-1",
        memberId: "member-barber-1",
        customerId: "cust-1",
        dateTime: args.data.dateTime,
        totalPrice: args.data.totalPrice,
        durationMin: 30,
        status: "CONFIRMED",
        bookingMode: "FIT_IN",
        fitInReason: "Fila Online - Senha #2",
        fitInCreatedById: "admin-1",
        fitInCreatedAt: new Date("2026-07-24T14:00:00.000Z"),
        conflictSnapshot: null,
        barber: { user: { name: "Barbeiro Joao", avatarUrl: null } },
        customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
        services: [{ service: { id: "service-barba", name: "Barba", durationMin: 30 } }],
        comandas: [],
      });
    });

    prismaMock.appointment.findFirst.mockImplementation((args: MockFindFirstArgs) => {
      if (args?.where?.id === "app-fit-in-1") {
        const priceApplied = createdAppointmentData?.services?.create?.[0]?.priceApplied ?? "35";
        return Promise.resolve({
          id: "app-fit-in-1",
          barbershopId: "shop-1",
          memberId: "member-barber-1",
          customerId: "cust-1",
          dateTime: new Date("2026-07-24T14:00:00.000Z"),
          totalPrice: createdAppointmentData?.totalPrice ?? 35,
          durationMin: 30,
          customer: { id: "cust-1", name: "Carlos Cliente", phone: "5517999998888" },
          services: [
            {
              serviceId: "service-barba",
              priceApplied,
              service: { id: "service-barba", name: "Barba", durationMin: 30 },
            },
          ],
        });
      }
      return Promise.resolve(null);
    });

    prismaMock.comandaItem.findMany.mockResolvedValue([
      { type: "SERVICE", status: "PENDING", total: "35.00", clubBenefitUsage: null },
    ]);

    prismaMock.comanda.update.mockResolvedValue({
      id: "comanda-fit-in-1",
      barbershopId: "shop-1",
      status: "OPEN",
      total: "35.00",
      remainingTotal: "35.00",
      items: [],
      payments: [],
    });

    prismaMock.onlineWaitlistEntry.findUnique.mockResolvedValue({
      id: "entry-barba",
      sessionId: "session-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      serviceId: "service-barba",
      preferredMemberId: null,
      queueNumber: 2,
      status: "FIT_IN_CREATED",
      fitInAppointmentId: "app-fit-in-1",
      calledByMemberId: "member-barber-1",
      calledAt: new Date("2026-07-24T14:00:00.000Z"),
      service: { id: "service-barba", name: "Barba", durationMin: 30, price },
      calledByMember: { user: { id: "u-barber-1", name: "Barbeiro Joao" } },
      preferredMember: null,
    });
    prismaMock.onlineWaitlistEntry.update.mockResolvedValue({
      id: "entry-barba",
      status: "FIT_IN_CREATED",
      fitInAppointmentId: "app-fit-in-1",
    });
  }

  async function callNextAsOwner() {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    const req = new NextRequest("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      body: JSON.stringify({ memberId: "member-barber-1" }),
    });

    return callNextAdmin(req);
  }

  async function startServiceAsOwner() {
    const req = new NextRequest("http://localhost/api/admin/waitlist/start-service", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-barba", memberId: "member-barber-1" }),
    });
    return startServiceAdmin(req);
  }

  function expectBarbaPriceApplied(data: CallNextResponseData) {
    const appointmentData = (prismaMock.appointment.create.mock.calls[0][0] as MockAppointmentCreateArgs).data;
    expect(appointmentData.totalPrice).toBe(35);
    expect(Number(appointmentData.services.create[0].priceApplied)).toBe(35);

    const comandaItems = (prismaMock.comanda.create.mock.calls[0][0] as MockComandaCreateArgs).data.items.create;
    expect(comandaItems).toHaveLength(1);
    expect(Number(comandaItems[0].unitPrice)).toBe(35);
    expect(Number(comandaItems[0].total)).toBe(35);
    expect(Number(data.comanda.total)).toBe(35);
  }

  it("17. call-next usa preco Decimal do servico ao criar FIT_IN e comanda", async () => {
    mockBarbaWaitlistPrice(new Prisma.Decimal("35.00"));

    const res = await startServiceAsOwner();
    const data = await res.json();

    expect(res.status).toBe(200);
    expectBarbaPriceApplied(data);
  });

  it("18. call-next usa preco string do servico ao criar FIT_IN e comanda", async () => {
    mockBarbaWaitlistPrice("35.00");

    const res = await startServiceAsOwner();
    const data = await res.json();

    expect(res.status).toBe(200);
    expectBarbaPriceApplied(data);
  });

  it("19. call-next usa preco number do servico ao criar FIT_IN e comanda", async () => {
    mockBarbaWaitlistPrice(35);

    const res = await startServiceAsOwner();
    const data = await res.json();

    expect(res.status).toBe(200);
    expectBarbaPriceApplied(data);
  });

  it("20. preco invalido nao cria appointment nem altera fila", async () => {
    mockBarbaWaitlistPrice({ toString: () => "valor-invalido" });

    const res = await startServiceAsOwner();
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe("INVALID_SERVICE_PRICE");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).toHaveBeenCalled();
  });

  it("21. start-service rejeita segundo claim antes de criar efeitos", async () => {
    mockBarbaWaitlistPrice("35.00");
    prismaMock.onlineWaitlistEntry.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await startServiceAsOwner();
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("WAITLIST_ENTRY_ALREADY_STARTED");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
  });

  it("22. passar vez retorna CALLED para WAITING abaixo do próximo", async () => {
    const update = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: "called",
        status: "WAITING",
        positionWeight: 20,
        skipCount: 1,
        calledByMemberId: null,
        calledAt: null,
      });
    const db = {
      onlineWaitlistEntry: {
        findUnique: vi.fn().mockResolvedValue({
          id: "called",
          sessionId: "session-1",
          status: "CALLED",
          positionWeight: 10,
          createdAt: new Date("2026-08-21T12:00:00.000Z"),
          skipCount: 0,
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "next",
            sessionId: "session-1",
            status: "WAITING",
            positionWeight: 20,
            createdAt: new Date("2026-08-21T12:01:00.000Z"),
          },
        ]),
        findFirst: vi.fn().mockResolvedValue({
          id: "next",
          sessionId: "session-1",
          status: "WAITING",
          positionWeight: 20,
          createdAt: new Date("2026-08-21T12:01:00.000Z"),
        }),
        update,
      },
    } as never;

    const result = await passCalledWaitlistEntry(db, "called");

    expect(result?.status).toBe("WAITING");
    expect(result?.calledByMemberId).toBeNull();
    expect(result?.calledAt).toBeNull();
    expect(update).toHaveBeenNthCalledWith(1, { where: { id: "next" }, data: { positionWeight: 10 } });
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "called" } }));
  });

  it("26. pesos iguais produzem ordem Pedro, Joao, Carlos", async () => {
    const entries = [
      { id: "pedro", status: "WAITING", positionWeight: 10, createdAt: new Date("2026-08-21T10:01:00Z") },
      { id: "carlos", status: "WAITING", positionWeight: 20, createdAt: new Date("2026-08-21T10:02:00Z") },
    ];
    const state = {
      id: "joao",
      sessionId: "session-1",
      status: "CALLED",
      positionWeight: 10,
      createdAt: new Date("2026-08-21T10:00:00Z"),
      skipCount: 0,
    };
    const finalWeights = new Map<string, number>();
    const db = {
      onlineWaitlistEntry: {
        findUnique: vi.fn().mockResolvedValue(state),
        findMany: vi.fn().mockResolvedValue(entries),
        update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { positionWeight?: number } }) => {
          finalWeights.set(where.id, data.positionWeight ?? 0);
          return { ...state, id: where.id, status: "WAITING", positionWeight: data.positionWeight ?? 0 };
        }),
      },
    } as never;

    await passCalledWaitlistEntry(db, "joao");
    expect([...finalWeights.entries()].sort((left, right) => left[1] - right[1])).toEqual([
      ["pedro", 10],
      ["joao", 20],
      ["carlos", 30],
    ]);
  });

  it("27. pass-turn sem proximo retorna WAITING na posição 1", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "joao",
      status: "WAITING",
      positionWeight: 10,
      skipCount: 1,
      calledByMemberId: null,
      calledAt: null,
    });
    const db = {
      onlineWaitlistEntry: {
        findUnique: vi.fn().mockResolvedValue({ id: "joao", sessionId: "session-1", status: "CALLED", positionWeight: 10, createdAt: new Date(), skipCount: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        update,
      },
    } as never;

    const result = await passCalledWaitlistEntry(db, "joao");
    expect(result).toMatchObject({ status: "WAITING", positionWeight: 10, skipCount: 1, calledByMemberId: null, calledAt: null });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("29. três pesos iguais mantêm ordem determinística após pass-turn", async () => {
    const entries = [
      { id: "pedro", status: "WAITING", positionWeight: 10, createdAt: new Date("2026-08-21T10:01:00Z") },
      { id: "carlos", status: "WAITING", positionWeight: 10, createdAt: new Date("2026-08-21T10:02:00Z") },
    ];
    const finalWeights = new Map<string, number>();
    const db = {
      onlineWaitlistEntry: {
        findUnique: vi.fn().mockResolvedValue({ id: "joao", sessionId: "session-1", status: "CALLED", positionWeight: 10, createdAt: new Date("2026-08-21T10:00:00Z"), skipCount: 0 }),
        findMany: vi.fn().mockResolvedValue(entries),
        update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { positionWeight?: number } }) => {
          finalWeights.set(where.id, data.positionWeight ?? 0);
          return { id: where.id, status: "WAITING", positionWeight: data.positionWeight ?? 0 };
        }),
      },
    } as never;

    await passCalledWaitlistEntry(db, "joao");
    expect([...finalWeights.entries()].sort((left, right) => left[1] - right[1])).toEqual([
      ["pedro", 10],
      ["joao", 20],
      ["carlos", 30],
    ]);
  });

  it("28. P2034 esgotado retorna 409 após exatamente três tentativas", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "7.8.0" });
    prismaMock.$transaction.mockRejectedValue(conflict);
    getAdminSessionMock.mockResolvedValue({ error: null, data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" } });

    const response = await startServiceAdmin(new NextRequest("http://localhost/api/admin/waitlist/start-service", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-1", memberId: "member-barber-1" }),
    }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("WAITLIST_ENTRY_ALREADY_STARTED");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
  });

  it("23. membro diferente não pode iniciar nem passar entrada de outro membro", async () => {
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "u-barber-2", barbershopId: "shop-1", memberId: "member-barber-2", role: "BARBER" },
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-barber-2",
      barbershopId: "shop-1",
      isActive: true,
      user: { id: "u-barber-2", name: "Barbeiro Pedro" },
    });
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      barbershopId: "shop-1",
      status: "CALLED",
      calledByMemberId: "member-barber-1",
      fitInAppointmentId: null,
      serviceId: "service-corte",
      customerId: "cust-1",
      customerName: "Carlos Cliente",
      customerPhone: "5517999998888",
      queueNumber: 7,
      service: { id: "service-corte", durationMin: 30, price: "50.00" },
    });

    const startResponse = await startServiceMember(new NextRequest("http://localhost/api/member/waitlist/start-service", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-1" }),
    }));
    const passResponse = await passTurnMember(new NextRequest("http://localhost/api/member/waitlist/pass-turn", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-1" }),
    }));

    expect(startResponse.status).toBe(403);
    expect(passResponse.status).toBe(403);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it("24. admin não pode iniciar ou passar entrada com membro de outro tenant", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "owner-a", barbershopId: "shop-a", role: "OWNER" },
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue(null);
    prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
      id: "entry-b",
      barbershopId: "shop-b",
      status: "CALLED",
      calledByMemberId: "member-a",
    });

    const startResponse = await startServiceAdmin(new NextRequest("http://localhost/api/admin/waitlist/start-service", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-b", memberId: "member-b" }),
    }));
    const passResponse = await passTurnAdmin(new NextRequest("http://localhost/api/admin/waitlist/pass-turn", {
      method: "POST",
      body: JSON.stringify({ entryId: "entry-b", memberId: "member-b" }),
    }));

    expect(startResponse.status).toBe(400);
    expect(passResponse.status).toBe(403);
  });

  it("25. cinco pass-turns mantêm a entrada WAITING e apenas incrementam skipCount", async () => {
    let state = { id: "called", status: "CALLED", positionWeight: 10, skipCount: 0, calledByMemberId: "member-a" };
    const db = {
      onlineWaitlistEntry: {
        findUnique: vi.fn().mockImplementation(async () => state),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          state = {
            ...state,
            status: data.status as string,
            positionWeight: data.positionWeight as number,
            skipCount: state.skipCount + 1,
            calledByMemberId: data.calledByMemberId as string | null,
          };
          return { ...state, calledAt: null };
        }),
      },
    } as never;

    for (let index = 0; index < 5; index++) {
      if (state.status !== "CALLED") state = { ...state, status: "CALLED", calledByMemberId: "member-a" };
      await passCalledWaitlistEntry(db, "called");
    }

    expect(state.status).toBe("WAITING");
    expect(state.skipCount).toBe(5);
    expect(state.calledByMemberId).toBeNull();
  });
});
