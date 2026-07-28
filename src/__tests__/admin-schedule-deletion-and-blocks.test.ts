/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE as deleteAppointmentHandler } from "@/app/api/admin/appointments/[id]/route";
import { POST as createScheduleBlockHandler } from "@/app/api/admin/schedule-blocks/route";
import {
  DELETE as deleteLegacyTimeOffHandler,
  POST as createLegacyTimeOffHandler,
} from "@/app/api/admin/team/[id]/time-off/route";
import { createFitInAppointmentWithScheduleLock } from "@/lib/appointments/create-fit-in-appointment";
import { getAvailableSlots } from "@/lib/appointments/availability";
import { ScheduleBlockConflictApptError } from "@/lib/appointments/errors";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

vi.mock("@/lib/api-auth", () => ({ getAdminSession: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const mockTx = {
    $executeRaw: vi.fn().mockResolvedValue([]),
    $queryRaw: vi.fn().mockResolvedValue([]),
    appointment: { findFirst: vi.fn(), delete: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    appointmentService: { deleteMany: vi.fn() },
    appointmentWhatsappConfirmation: { deleteMany: vi.fn() },
    comanda: { findMany: vi.fn(), delete: vi.fn() },
    review: { findFirst: vi.fn() },
    financialEntry: { count: vi.fn() },
    onlineWaitlistEntry: { findFirst: vi.fn() },
    timeOff: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    barbershopMember: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    service: { findMany: vi.fn() },
    barberService: { findMany: vi.fn() },
  };
  return { default: { ...mockTx, $transaction: vi.fn((cb) => cb(mockTx)) } };
});

function ownerSession() {
  vi.mocked(getAdminSession).mockResolvedValue({
    data: { barbershopId: "shop-1", role: "OWNER", userId: "u1" },
    error: null,
  } as any);
}

function baseAppointment(status = "CONFIRMED") {
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
    id: "appt-1",
    barbershopId: "shop-1",
    status,
  } as any);
}

function cleanComanda(id: string, status = "OPEN") {
  return {
    id,
    status,
    payments: [],
    items: [],
  } as any;
}

async function deleteAppointment() {
  const req = new NextRequest("http://localhost/api/admin/appointments/appt-1", { method: "DELETE" });
  return deleteAppointmentHandler(req, { params: Promise.resolve({ id: "appt-1" }) });
}

describe("Ajustes Operacionais da Agenda - Exclusao e Bloqueios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerSession();
    baseAppointment();
    vi.mocked(prisma.review.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.onlineWaitlistEntry.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialEntry.count).mockResolvedValue(0);
  });

  it("rejeita hard-delete por BARBER com 403", async () => {
    vi.mocked(getAdminSession).mockResolvedValue({
      data: { barbershopId: "shop-1", role: "BARBER", memberId: "barber-1", userId: "u1" },
      error: null,
    } as any);

    const res = await deleteAppointment();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toContain("Apenas");
  });

  it("duas comandas limpas sao removidas na mesma transacao", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([cleanComanda("comanda-a"), cleanComanda("comanda-b")]);

    const res = await deleteAppointment();

    expect(res.status).toBe(200);
    expect(prisma.comanda.delete).toHaveBeenCalledWith({ where: { id: "comanda-a" } });
    expect(prisma.comanda.delete).toHaveBeenCalledWith({ where: { id: "comanda-b" } });
    expect(prisma.appointment.delete).toHaveBeenCalledWith({ where: { id: "appt-1" } });
  });

  it("uma comanda limpa e outra avancada bloqueia e nao remove nada", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([
      cleanComanda("comanda-clean"),
      cleanComanda("comanda-advanced", "IN_SERVICE"),
    ]);

    const res = await deleteAppointment();

    expect(res.status).toBe(422);
    expect(prisma.comanda.delete).not.toHaveBeenCalled();
    expect(prisma.appointment.delete).not.toHaveBeenCalled();
  });

  it("rollback quando uma exclusao falha", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([cleanComanda("comanda-a"), cleanComanda("comanda-b")]);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("delete failed"));

    await expect(deleteAppointment()).rejects.toThrow("delete failed");
    expect(prisma.appointment.delete).not.toHaveBeenCalled();
  });

  it("Review bloqueia", async () => {
    vi.mocked(prisma.review.findFirst).mockResolvedValue({ id: "review-1" } as any);
    const res = await deleteAppointment();
    expect(res.status).toBe(422);
  });

  it("OnlineWaitlistEntry bloqueia", async () => {
    vi.mocked(prisma.onlineWaitlistEntry.findFirst).mockResolvedValue({ id: "wait-1" } as any);
    const res = await deleteAppointment();
    expect(res.status).toBe(422);
  });

  it("Payment confirmado bloqueia", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([{ ...cleanComanda("c1"), payments: [{ id: "p1" }] }]);
    const res = await deleteAppointment();
    expect(res.status).toBe(422);
  });

  it("FinancialEntry bloqueia", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([cleanComanda("c1")]);
    vi.mocked(prisma.financialEntry.count).mockResolvedValue(1);
    const res = await deleteAppointment();
    expect(res.status).toBe(422);
  });

  it.each([
    ["StockMovement", { stockMovements: [{ id: "s1" }] }],
    ["CommissionEntry", { commissionEntry: { id: "cm1" } }],
    ["ClubBenefitUsage", { clubBenefitUsage: { id: "cb1" } }],
    ["ClubPointEntry", { clubPointEntry: { id: "cp1" } }],
  ])("%s bloqueia", async (_name, item) => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([
      { ...cleanComanda("c1"), items: [{ stockMovements: [], commissionEntry: null, clubBenefitUsage: null, clubPointEntry: null, ...item }] },
    ]);
    const res = await deleteAppointment();
    expect(res.status).toBe(422);
  });

  it("User, Service e BarbershopMember sao preservados; AppointmentService e WhatsappConfirmation saem por cascade", async () => {
    await deleteAppointment();

    expect(prisma.appointment.delete).toHaveBeenCalledWith({ where: { id: "appt-1" } });
    expect((prisma as any).user?.delete).toBeUndefined();
    expect((prisma as any).service?.delete).toBeUndefined();
    expect((prisma as any).barbershopMember?.delete).toBeUndefined();
  });

  it("POST admin schedule-blocks persiste allDay=false", async () => {
    vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({ id: "m1", barbershopId: "shop-1", isActive: true } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeOff.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeOff.create).mockResolvedValue({ id: "block-1", allDay: false } as any);

    const req = new NextRequest("http://localhost/api/admin/schedule-blocks", {
      method: "POST",
      body: JSON.stringify({
        memberId: "m1",
        startDate: "2026-07-30T14:00:00Z",
        endDate: "2026-07-30T15:00:00Z",
        reason: "Compromisso",
      }),
    });

    const res = await createScheduleBlockHandler(req);
    expect(res.status).toBe(201);
    expect(prisma.timeOff.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ allDay: false }) }));
  });

  it("rota antiga POST usa fim exclusivo e allDay=true; DELETE usa helper", async () => {
    vi.mocked(prisma.barbershopMember.findUnique).mockResolvedValue({ id: "m1", barbershopId: "shop-1" } as any);
    vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({ id: "m1", barbershopId: "shop-1", isActive: true } as any);
    vi.mocked(prisma.timeOff.create).mockResolvedValue({ id: "legacy-block", allDay: true } as any);

    const postReq = new NextRequest("http://localhost/api/admin/team/m1/time-off", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-07-28", endDate: "2026-07-30", reason: "Ferias" }),
    });
    const postRes = await createLegacyTimeOffHandler(postReq, { params: Promise.resolve({ id: "m1" }) });
    expect(postRes.status).toBe(201);
    expect(prisma.timeOff.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allDay: true,
          endDate: new Date("2026-07-31T00:00:00.000Z"),
        }),
      })
    );

    vi.mocked(prisma.timeOff.findUnique).mockResolvedValue({
      id: "legacy-block",
      memberId: "m1",
      member: { id: "m1", barbershopId: "shop-1" },
    } as any);
    const deleteReq = new NextRequest("http://localhost/api/admin/team/m1/time-off", {
      method: "DELETE",
      body: JSON.stringify({ timeOffId: "legacy-block" }),
    });
    const deleteRes = await deleteLegacyTimeOffHandler(deleteReq, { params: Promise.resolve({ id: "m1" }) });
    expect(deleteRes.status).toBe(200);
    expect(prisma.timeOff.delete).toHaveBeenCalledWith({ where: { id: "legacy-block" } });
  });

  it("encaixe rejeita TimeOff com SCHEDULE_BLOCK_CONFLICT", async () => {
    vi.mocked(prisma.timeOff.findMany).mockResolvedValue([
      { id: "block-1", memberId: "m1", startDate: new Date("2026-07-30T10:00:00Z"), endDate: new Date("2026-07-30T11:00:00Z") },
    ] as any);

    await expect(
      createFitInAppointmentWithScheduleLock(prisma as any, {
        barbershopId: "shop-1",
        memberId: "m1",
        customerId: "c1",
        dateTime: new Date("2026-07-30T10:15:00Z"),
        durationMin: 30,
        totalPrice: 50,
        fitInReason: "Urgencia",
        fitInCreatedById: "user-1",
        services: [],
      })
    ).rejects.toThrow(ScheduleBlockConflictApptError);
  });

  it("availability remove apenas slots sobrepostos ao bloqueio parcial", async () => {
    vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({
      id: "m1",
      user: { name: "Joao" },
      workingHours: [{ dayOfWeek: 4, startTime: "09:00", endTime: "12:00", breakStart: null, breakEnd: null }],
      timeOffs: [{ startDate: new Date("2026-07-30T10:00:00Z"), endDate: new Date("2026-07-30T11:00:00Z") }],
    } as any);
    vi.mocked(prisma.service.findMany).mockResolvedValue([{ id: "svc-a", durationMin: 30, price: "50.00" }] as any);
    vi.mocked(prisma.barbershopMember.findMany).mockResolvedValue([{ id: "m1" }] as any);
    vi.mocked(prisma.barberService.findMany).mockResolvedValue([{ barberId: "m1", serviceId: "svc-a" }] as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    const { results } = await getAvailableSlots({ barbershopId: "shop-1", memberId: "m1", serviceIds: ["svc-a"], dateStr: "2026-07-30" });
    expect(results[0]?.slots).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });
});
