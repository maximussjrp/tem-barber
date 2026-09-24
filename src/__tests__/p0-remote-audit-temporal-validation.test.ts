import { describe, expect, it, vi } from "vitest";
import {
  validateMemberTemporalAvailability,
  MemberTemporalAvailabilityError,
} from "@/lib/agenda/working-hours-validation";
import {
  AppointmentConflictError,
  ScheduleBlockConflictApptError,
  ProfessionalNotAvailableError,
} from "@/lib/appointments/errors";

describe("P0 Remote Audit - Canonical Temporal Availability Validator", () => {
  const baseWorkingHour = {
    dayOfWeek: 2, // Terça-feira
    startTime: "09:00",
    endTime: "19:00",
    breakStart: "12:00",
    breakEnd: "13:00",
    isActive: true,
  };

  const createMockTx = (overrides?: {
    member?: unknown;
    timeOffBlocks?: unknown[];
    overlapRows?: unknown[];
  }) => {
    const member =
      overrides?.member !== undefined
        ? overrides.member
        : {
            id: "member-1",
            barbershopId: "shop-1",
            isActive: true,
            workingHours: [baseWorkingHour],
          };

    return {
      barbershopMember: {
        findFirst: vi.fn().mockResolvedValue(member),
      },
      timeOff: {
        findMany: vi.fn().mockResolvedValue(overrides?.timeOffBlocks ?? []),
      },
      $queryRaw: vi.fn().mockResolvedValue(overrides?.overlapRows ?? []),
    } as unknown as Parameters<typeof validateMemberTemporalAvailability>[0];
  };

  it("rejeita quando membro não existe ou não pertence à barbearia", async () => {
    const tx = createMockTx({ member: null });
    await expect(
      validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T10:00:00.000Z"), // Terça-feira
        durationMin: 30,
      })
    ).rejects.toThrow(ProfessionalNotAvailableError);
  });

  it("rejeita dia da semana sem expediente ativo (NO_WORKING_HOURS)", async () => {
    const tx = createMockTx({
      member: {
        id: "member-1",
        barbershopId: "shop-1",
        isActive: true,
        workingHours: [], // Sem expediente
      },
    });

    await expect(
      validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T10:00:00.000Z"),
        durationMin: 30,
      })
    ).rejects.toThrow(MemberTemporalAvailabilityError);

    try {
      await validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T10:00:00.000Z"),
        durationMin: 30,
      });
    } catch (err: unknown) {
      if (err instanceof MemberTemporalAvailabilityError) {
        expect(err.code).toBe("NO_WORKING_HOURS");
      }
    }
  });

  it("rejeita horário antes do expediente (OUTSIDE_WORKING_HOURS)", async () => {
    const tx = createMockTx();

    // 08:30 (antes das 09:00)
    await expect(
      validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T08:30:00.000Z"),
        durationMin: 30,
      })
    ).rejects.toThrow(MemberTemporalAvailabilityError);

    try {
      await validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T08:30:00.000Z"),
        durationMin: 30,
      });
    } catch (err: unknown) {
      if (err instanceof MemberTemporalAvailabilityError) {
        expect(err.code).toBe("OUTSIDE_WORKING_HOURS");
      }
    }
  });

  it("rejeita horário que ultrapassa o final do expediente (OUTSIDE_WORKING_HOURS)", async () => {
    const tx = createMockTx();

    // 18:45 com duração de 30min -> termina 19:15 (expediente encerra 19:00)
    try {
      await validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T18:45:00.000Z"),
        durationMin: 30,
      });
      expect.fail("Deveria ter lançado erro de fora de expediente");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MemberTemporalAvailabilityError);
      if (err instanceof MemberTemporalAvailabilityError) {
        expect(err.code).toBe("OUTSIDE_WORKING_HOURS");
      }
    }
  });

  it("rejeita horário que atravessa o intervalo/almoço (BREAK_CONFLICT)", async () => {
    const tx = createMockTx();

    // Inicia 11:45 e dura 30min -> 11:45 às 12:15 (cruza início do almoço 12:00)
    try {
      await validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T11:45:00.000Z"),
        durationMin: 30,
      });
      expect.fail("Deveria ter lançado erro de conflito com intervalo");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MemberTemporalAvailabilityError);
      if (err instanceof MemberTemporalAvailabilityError) {
        expect(err.code).toBe("BREAK_CONFLICT");
      }
    }

    // Inicia 12:30 e dura 30min -> totalmente dentro do almoço (12:00 às 13:00)
    try {
      await validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T12:30:00.000Z"),
        durationMin: 30,
      });
      expect.fail("Deveria ter lançado erro de conflito com intervalo");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MemberTemporalAvailabilityError);
      if (err instanceof MemberTemporalAvailabilityError) {
        expect(err.code).toBe("BREAK_CONFLICT");
      }
    }
  });

  it("rejeita quando coincide com TimeOff / ScheduleBlock", async () => {
    const tx = createMockTx({
      timeOffBlocks: [
        {
          id: "block-1",
          memberId: "member-1",
          startDate: new Date("2026-07-28T15:00:00.000Z"),
          endDate: new Date("2026-07-28T16:00:00.000Z"),
          allDay: false,
        },
      ],
    });

    await expect(
      validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T15:15:00.000Z"),
        durationMin: 30,
      })
    ).rejects.toThrow(ScheduleBlockConflictApptError);
  });

  it("rejeita quando coincide com agendamento ativo concorrente", async () => {
    const tx = createMockTx({
      overlapRows: [{ id: "existing-appt-1" }],
    });

    await expect(
      validateMemberTemporalAvailability(tx, {
        barbershopId: "shop-1",
        memberId: "member-1",
        dateTime: new Date("2026-07-28T14:00:00.000Z"),
        durationMin: 30,
      })
    ).rejects.toThrow(AppointmentConflictError);
  });

  it("aprova com sucesso quando o slot é perfeitamente válido dentro do expediente", async () => {
    const tx = createMockTx();

    const result = await validateMemberTemporalAvailability(tx, {
      barbershopId: "shop-1",
      memberId: "member-1",
      dateTime: new Date("2026-07-28T10:00:00.000Z"),
      durationMin: 45,
    });

    expect(result).toBeDefined();
    expect(result.member.id).toBe("member-1");
    expect(result.workingHour.startTime).toBe("09:00");
  });
});
