import type { Prisma } from "@prisma/client";
import { nowBR } from "@/lib/time-utils";
import { publicBarbershopWhere } from "@/lib/public-barbershops";
import { lockAppointmentSchedule } from "./appointment-lock";
import {
  type ValidatedProfessionalServiceCapability,
  validateProfessionalServiceCapability,
} from "./professional-service-capability";

export const PUBLIC_SLOT_INVALID = "PUBLIC_SLOT_INVALID";
export const PUBLIC_BOOKING_UNAVAILABLE = "PUBLIC_BOOKING_UNAVAILABLE";

export type PublicSlotInvalidReason =
  | "PAST"
  | "NO_WORKING_HOURS"
  | "OUTSIDE_WORKING_HOURS"
  | "BREAK";

export class PublicSlotInvalidError extends Error {
  readonly code = PUBLIC_SLOT_INVALID;
  readonly status = 422;

  constructor(readonly reason: PublicSlotInvalidReason) {
    super("Este horario nao esta disponivel para agendamento online.");
    this.name = "PublicSlotInvalidError";
  }
}

export class PublicBookingUnavailableError extends Error {
  readonly code = PUBLIC_BOOKING_UNAVAILABLE;
  readonly status = 422;

  constructor() {
    super("Esta barbearia nao esta disponivel para agendamentos online.");
    this.name = "PublicBookingUnavailableError";
  }
}

export interface PublicWorkingHours {
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function utcDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getPublicSlotInvalidReason({
  dateTime,
  durationMin,
  workingHours,
  now = nowBR(),
}: {
  dateTime: Date;
  durationMin: number;
  workingHours?: PublicWorkingHours | null;
  now?: Date;
}): PublicSlotInvalidReason | null {
  const requestedDate = utcDateKey(dateTime);
  const currentDate = utcDateKey(now);
  const start = dateTime.getUTCHours() * 60 + dateTime.getUTCMinutes();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  if (requestedDate < currentDate || (requestedDate === currentDate && start <= currentMinutes)) {
    return "PAST";
  }

  if (!workingHours) {
    return "NO_WORKING_HOURS";
  }

  const end = start + durationMin;
  const workStart = toMinutes(workingHours.startTime);
  const workEnd = toMinutes(workingHours.endTime);
  if (start < workStart || end > workEnd) {
    return "OUTSIDE_WORKING_HOURS";
  }

  if (workingHours.breakStart && workingHours.breakEnd) {
    const breakStart = toMinutes(workingHours.breakStart);
    const breakEnd = toMinutes(workingHours.breakEnd);
    if (start < breakEnd && end > breakStart) {
      return "BREAK";
    }
  }

  return null;
}

export async function validatePublicBookingEligibility(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    serviceIds: string[];
    dateTime: Date;
    quantities: Map<string, number>;
  }
): Promise<ValidatedProfessionalServiceCapability> {
  await lockAppointmentSchedule(tx, input.barbershopId, input.memberId);

  const publicBarbershop = await tx.barbershop.findFirst({
    where: { id: input.barbershopId, ...publicBarbershopWhere() },
    select: { id: true },
  });
  if (!publicBarbershop) {
    throw new PublicBookingUnavailableError();
  }

  const capability = await validateProfessionalServiceCapability(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    serviceIds: input.serviceIds,
  });

  capability.services.forEach((service) => {
    service.quantity = input.quantities.get(service.id) ?? 1;
  });

  const durationMin = capability.services.reduce(
    (total, service) => total + service.durationMin * (service.quantity ?? 1),
    0
  );
  const dayOfWeek = input.dateTime.getUTCDay();
  const memberSchedule = await tx.barbershopMember.findFirst({
    where: { id: input.memberId, barbershopId: input.barbershopId, isActive: true },
    select: {
      workingHours: {
        where: { dayOfWeek, isActive: true },
        select: {
          startTime: true,
          endTime: true,
          breakStart: true,
          breakEnd: true,
        },
      },
    },
  });

  const reason = getPublicSlotInvalidReason({
    dateTime: input.dateTime,
    durationMin,
    workingHours: memberSchedule?.workingHours[0],
  });
  if (reason) {
    throw new PublicSlotInvalidError(reason);
  }

  return capability;
}
