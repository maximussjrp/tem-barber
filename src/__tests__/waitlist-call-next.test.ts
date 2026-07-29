import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { POST as callNextAdmin } from "@/app/api/admin/waitlist/call-next/route";
import { POST as callNextMember } from "@/app/api/member/waitlist/call-next/route";
import { getCurrentSaoPauloDateTimeForAppointment } from "@/lib/time-utils";

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
      status: "FIT_IN_CREATED",
      fitInAppointmentId: "app-fit-in-1",
      calledByMemberId: "member-barber-1",
      calledAt: new Date("2026-07-24T14:00:00.000Z"),
      service: { id: "service-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00" },
      calledByMember: { user: { id: "u-barber-1", name: "Barbeiro João" } },
      preferredMember: null,
    });

    prismaMock.comanda.count.mockResolvedValue(0);
  });

  it("1. OWNER chama próximo e cria agendamento FIT_IN", async () => {
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
    expect(data.entry.status).toBe("FIT_IN_CREATED");
    expect(data.entry.fitInAppointmentId).toBe("app-fit-in-1");
    expect(data.appointment.bookingMode).toBe("FIT_IN");

    // Valida que o dateTime do agendamento foi criado no fuso operacional America/Sao_Paulo
    const createdAppointmentCall = prismaMock.appointment.create.mock.calls[0][0];
    const createdDateTime = createdAppointmentCall.data.dateTime as Date;
    expect(createdDateTime).toBeInstanceOf(Date);
    // Para UTC 14:00Z, no fuso de SP (UTC-3) o horário operacional é 11:00 (11h UTC no padrão da agenda)
    expect(createdDateTime.getUTCHours()).not.toBe(new Date().getUTCHours());
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
    expect(data.entry.status).toBe("FIT_IN_CREATED");
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
    expect(data.entry.status).toBe("FIT_IN_CREATED");
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
    expect(data.entry.status).toBe("FIT_IN_CREATED");
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

  it("12. cria comanda automaticamente ao chamar o próximo", async () => {
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
    expect(data.comandaId).toBe("comanda-fit-in-1");
    expect(prismaMock.comanda.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appointmentId: "app-fit-in-1",
          barbershopId: "shop-1",
        }),
      })
    );
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

    expect(res.status).toBe(409);
    expect(data.error).toBe("SCHEDULE_BLOCK_CONFLICT");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
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

    expect(res.status).toBe(409);
    expect(data.error).toBe("SCHEDULE_BLOCK_CONFLICT");
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.onlineWaitlistEntry.updateMany).not.toHaveBeenCalled();
  });
});
