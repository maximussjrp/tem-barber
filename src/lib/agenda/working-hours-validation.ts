import type { Prisma } from "@prisma/client";
import { AppointmentConflictError, ScheduleBlockConflictApptError, ProfessionalNotAvailableError } from "@/lib/appointments/errors";
import { findOverlappingScheduleBlock } from "@/lib/schedule-blocks";
import { findOverlappingAppointment } from "@/lib/appointments/find-overlap";

export type MemberTemporalErrorCode =
  | "NO_WORKING_HOURS"
  | "OUTSIDE_WORKING_HOURS"
  | "BREAK_CONFLICT";

export class MemberTemporalAvailabilityError extends Error {
  readonly code: MemberTemporalErrorCode;
  readonly status: number;

  constructor(code: MemberTemporalErrorCode, message: string, status = 400) {
    super(message);
    this.name = "MemberTemporalAvailabilityError";
    this.code = code;
    this.status = status;
  }
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export interface ValidateMemberTemporalAvailabilityInput {
  barbershopId: string;
  memberId: string;
  dateTime: Date;
  durationMin: number;
  excludeAppointmentId?: string;
}

/**
 * Validador canônico de disponibilidade temporal server-side.
 * Garante:
 * 1. O membro existe, pertence ao tenant e está ativo.
 * 2. O dia possui WorkingHour ativo.
 * 3. O agendamento começa >= startTime e termina <= endTime.
 * 4. O agendamento não cruza o intervalo (breakStart..breakEnd).
 * 5. O agendamento não cruza nenhum TimeOff / ScheduleBlock.
 * 6. O agendamento não cruza nenhum agendamento ativo concorrente.
 */
export async function validateMemberTemporalAvailability(
  tx: Prisma.TransactionClient,
  input: ValidateMemberTemporalAvailabilityInput
) {
  const dayOfWeek = input.dateTime.getUTCDay();

  const member = await tx.barbershopMember.findFirst({
    where: {
      id: input.memberId,
      barbershopId: input.barbershopId,
      isActive: true,
    },
    include: {
      workingHours: {
        where: { dayOfWeek, isActive: true },
      },
    },
  });

  if (!member) {
    throw new ProfessionalNotAvailableError();
  }

  const wh = member.workingHours?.[0];
  if (!wh) {
    throw new MemberTemporalAvailabilityError(
      "NO_WORKING_HOURS",
      "O profissional não atende neste dia da semana."
    );
  }

  const startMin = input.dateTime.getUTCHours() * 60 + input.dateTime.getUTCMinutes();
  const endMin = startMin + input.durationMin;

  const workStart = toMinutes(wh.startTime);
  const workEnd = toMinutes(wh.endTime);

  if (startMin < workStart || endMin > workEnd) {
    throw new MemberTemporalAvailabilityError(
      "OUTSIDE_WORKING_HOURS",
      "O horário selecionado está fora do expediente de trabalho do profissional."
    );
  }

  if (wh.breakStart && wh.breakEnd) {
    const breakStart = toMinutes(wh.breakStart);
    const breakEnd = toMinutes(wh.breakEnd);

    // Cruzamento de intervalos: start < breakEnd && end > breakStart
    if (startMin < breakEnd && endMin > breakStart) {
      throw new MemberTemporalAvailabilityError(
        "BREAK_CONFLICT",
        "O horário selecionado coincide com o intervalo do profissional."
      );
    }
  }

  const apptEnd = new Date(input.dateTime.getTime() + input.durationMin * 60 * 1000);
  const block = await findOverlappingScheduleBlock(tx, {
    memberId: input.memberId,
    start: input.dateTime,
    end: apptEnd,
  });

  if (block) {
    throw new ScheduleBlockConflictApptError();
  }

  const conflict = await findOverlappingAppointment(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    start: input.dateTime,
    durationMin: input.durationMin,
    excludeAppointmentId: input.excludeAppointmentId,
  });

  if (conflict) {
    throw new AppointmentConflictError();
  }

  return { member, workingHour: wh };
}
