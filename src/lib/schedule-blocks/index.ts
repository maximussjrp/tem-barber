import { Prisma } from "@prisma/client";
import { lockAppointmentSchedule } from "@/lib/appointments/appointment-lock";

export class ScheduleBlockAppointmentConflictError extends Error {
  public status = 409;
  public code = "SCHEDULE_BLOCK_APPOINTMENT_CONFLICT";
  public conflicts: Array<{
    appointmentId: string;
    start: Date;
    end: Date;
    customerName: string;
  }>;

  constructor(
    conflicts: Array<{
      appointmentId: string;
      start: Date;
      end: Date;
      customerName: string;
    }>
  ) {
    super("Existem agendamentos neste período. Reagende ou cancele antes de bloquear a agenda.");
    this.name = "ScheduleBlockAppointmentConflictError";
    this.conflicts = conflicts;
  }
}

export class ScheduleBlockConflictError extends Error {
  public status = 409;
  public code = "SCHEDULE_BLOCK_OVERLAP";

  constructor(message = "Já existe um bloqueio de agenda neste período.") {
    super(message);
    this.name = "ScheduleBlockConflictError";
  }
}

export interface ScheduleBlockInput {
  barbershopId: string;
  memberId: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  allDay?: boolean;
}

export function parseScheduleBlockInterval(
  startDateStr: string,
  endDateStr?: string,
  allDay?: boolean
): { start: Date; end: Date } {
  if (allDay) {
    const datePart = startDateStr.split("T")[0];
    const [y, m, d] = datePart.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    const endDatePart = endDateStr?.split("T")[0] ?? datePart;
    const [ey, em, ed] = endDatePart.split("-").map(Number);
    const end = new Date(Date.UTC(ey, em - 1, ed + 1, 0, 0, 0, 0));
    return { start, end };
  }

  const start = new Date(startDateStr.endsWith("Z") ? startDateStr : startDateStr + "Z");
  const end = endDateStr
    ? new Date(endDateStr.endsWith("Z") ? endDateStr : endDateStr + "Z")
    : new Date(start.getTime() + 60 * 60 * 1000); // 1h default

  return { start, end };
}

export function normalizeStoredTimeOffInterval<T extends { startDate: Date; endDate: Date; allDay?: boolean | null }>(
  timeOff: T
): T & { startDate: Date; endDate: Date; allDay: boolean } {
  const startDate = new Date(timeOff.startDate);
  const storedEnd = new Date(timeOff.endDate);
  const isLegacyAllDay = !timeOff.allDay && isUtcMidnight(startDate) && isUtcMidnight(storedEnd);

  if (timeOff.allDay) {
    return { ...timeOff, startDate, endDate: storedEnd, allDay: true };
  }

  if (isLegacyAllDay) {
    const endDate = new Date(
      Date.UTC(storedEnd.getUTCFullYear(), storedEnd.getUTCMonth(), storedEnd.getUTCDate() + 1, 0, 0, 0, 0)
    );
    return { ...timeOff, startDate, endDate, allDay: true };
  }

  return { ...timeOff, startDate, endDate: storedEnd, allDay: false };
}

export function isUtcMidnight(date: Date) {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

export function isNormalizedTimeOffOverlapping(
  timeOff: { startDate: Date; endDate: Date; allDay?: boolean | null },
  interval: { start: Date; end: Date }
) {
  const normalized = normalizeStoredTimeOffInterval(timeOff);
  return normalized.startDate < interval.end && normalized.endDate > interval.start;
}

export function getScheduleBlockCandidateFloor(start: Date) {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
}

export async function findOverlappingScheduleBlock(
  tx: Prisma.TransactionClient,
  input: {
    memberId: string;
    start: Date;
    end: Date;
    excludeTimeOffId?: string;
  }
) {
  if (!tx || !tx.timeOff || typeof tx.timeOff.findMany !== "function") {
    return null;
  }

  const excludeId = input.excludeTimeOffId ?? null;
  const candidateFloor = getScheduleBlockCandidateFloor(input.start);
  const blocks = await tx.timeOff.findMany({
    where: {
      memberId: input.memberId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startDate: { lt: input.end },
      endDate: { gte: candidateFloor },
    },
    select: {
      id: true,
      memberId: true,
      startDate: true,
      endDate: true,
      reason: true,
      allDay: true,
    },
  });

  return (blocks ?? []).find((block) =>
    isNormalizedTimeOffOverlapping(block, { start: input.start, end: input.end })
  ) ?? null;
}

export async function findAppointmentsConflictingWithScheduleBlock(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    start: Date;
    end: Date;
  }
) {
  if (!tx || !tx.appointment || typeof tx.appointment.findMany !== "function") {
    return [];
  }
  const appointments = await tx.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      memberId: input.memberId,
      status: { in: ["PENDING", "CONFIRMED"] },
      dateTime: { lt: input.end },
    },
    include: {
      customer: { select: { name: true } },
    },
  });

  const conflicts = [];
  for (const a of (appointments ?? [])) {
    const apptStart = new Date(a.dateTime);
    const apptEnd = new Date(apptStart.getTime() + a.durationMin * 60 * 1000);
    if (apptStart < input.end && apptEnd > input.start) {
      conflicts.push({
        appointmentId: a.id,
        start: apptStart,
        end: apptEnd,
        customerName: a.customer?.name ?? "Cliente",
      });
    }
  }

  return conflicts;
}

export async function createScheduleBlockWithLock(
  tx: Prisma.TransactionClient,
  input: ScheduleBlockInput
) {
  await lockAppointmentSchedule(tx, input.barbershopId, input.memberId);

  // 1. Verificar se profissional pertence ao tenant e está ativo
  const member = await tx.barbershopMember.findFirst({
    where: { id: input.memberId, barbershopId: input.barbershopId, isActive: true },
  });
  if (!member) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  // 2. Verificar se há agendamentos ativos concorrentes
  const apptConflicts = await findAppointmentsConflictingWithScheduleBlock(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    start: input.startDate,
    end: input.endDate,
  });

  if (apptConflicts.length > 0) {
    throw new ScheduleBlockAppointmentConflictError(apptConflicts);
  }

  // 3. Verificar se há bloqueio sobreposto
  const existingBlock = await findOverlappingScheduleBlock(tx, {
    memberId: input.memberId,
    start: input.startDate,
    end: input.endDate,
  });

  if (existingBlock) {
    throw new ScheduleBlockConflictError("Já existe um bloqueio de agenda neste horário.");
  }

  return tx.timeOff.create({
    data: {
      memberId: input.memberId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason.trim(),
      allDay: Boolean(input.allDay),
    },
  });
}

export async function deleteScheduleBlock(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    timeOffId: string;
    memberId?: string;
  }
) {
  const timeOff = await tx.timeOff.findUnique({
    where: { id: input.timeOffId },
    include: { member: { select: { id: true, barbershopId: true } } },
  });

  if (
    !timeOff ||
    timeOff.member.barbershopId !== input.barbershopId ||
    (input.memberId && timeOff.memberId !== input.memberId)
  ) {
    throw new Error("SCHEDULE_BLOCK_NOT_FOUND");
  }

  await tx.timeOff.delete({ where: { id: input.timeOffId } });
  return timeOff;
}
