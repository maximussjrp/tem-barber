/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePublicBookingEligibility } from "@/lib/appointments/public-booking-eligibility";

const tx = {
  barbershop: { findFirst: vi.fn() },
  barberService: { findMany: vi.fn() },
  service: { findMany: vi.fn() },
  barbershopMember: { findFirst: vi.fn() },
  timeOff: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
} as any;

const input = {
  barbershopId: "shop-a",
  memberId: "member-a",
  serviceIds: ["svc-a"],
  dateTime: new Date("2026-08-27T11:00:00.000Z"),
  quantities: new Map([["svc-a", 1]]),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
  tx.barbershop.findFirst.mockResolvedValue({ id: "shop-a" });
  tx.barberService.findMany.mockResolvedValue([{ barberId: "member-a", serviceId: "svc-a" }]);
  tx.service.findMany.mockResolvedValue([{ id: "svc-a", durationMin: 30, price: "50.00" }]);
  tx.barbershopMember.findFirst.mockResolvedValue({
    workingHours: [{ startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null }],
  });
  tx.timeOff.findMany.mockResolvedValue([]);
  tx.$queryRaw.mockResolvedValue([]);
  tx.$executeRaw.mockResolvedValue(0);
});

describe("public booking direct eligibility", () => {
  it("permite tenant ativo mesmo com dados editoriais incompletos", async () => {
    await expect(validatePublicBookingEligibility(tx, input)).resolves.toBeDefined();
    expect(tx.barbershop.findFirst).toHaveBeenCalledWith({
      where: { id: "shop-a", active: true },
      select: { id: true },
    });
  });

  it.each(["inactive", "missing"])("bloqueia tenant %s", async (state) => {
    tx.barbershop.findFirst.mockResolvedValue(null);
    await expect(validatePublicBookingEligibility(tx, input)).rejects.toMatchObject({ code: "PUBLIC_BOOKING_UNAVAILABLE" });
    expect(tx.barbershop.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop-a", active: true } }));
    expect(state).toBeTruthy();
  });

  it("mantem bloqueio fora do horario", async () => {
    tx.barbershopMember.findFirst.mockResolvedValue({
      workingHours: [{ startTime: "09:00", endTime: "10:00", breakStart: null, breakEnd: null }],
    });
    await expect(validatePublicBookingEligibility(tx, input)).rejects.toMatchObject({ reason: "OUTSIDE_WORKING_HOURS" });
  });

  it("mantem bloqueio de horario passado", async () => {
    const pastInput = { ...input, dateTime: new Date("2026-08-25T11:00:00.000Z") };
    await expect(validatePublicBookingEligibility(tx, pastInput)).rejects.toMatchObject({ reason: "PAST" });
  });

  it("mantem bloqueio de profissional sem capability", async () => {
    tx.barberService.findMany.mockResolvedValue([]);
    await expect(validatePublicBookingEligibility(tx, input)).rejects.toThrow();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
