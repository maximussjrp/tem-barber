export const ACTIVE_APPOINTMENT_STATUSES = ["PENDING", "CONFIRMED"] as const;

export interface AppointmentInterval {
  barbershopId: string;
  memberId: string;
  start: Date;
  durationMin: number;
  status?: string;
  id?: string;
}

export function getIntervalEnd(start: Date, durationMin: number) {
  return new Date(start.getTime() + durationMin * 60_000);
}

export function intervalsOverlap(
  existingStart: Date,
  existingDurationMin: number,
  newStart: Date,
  newDurationMin: number
) {
  const existingEnd = getIntervalEnd(existingStart, existingDurationMin);
  const newEnd = getIntervalEnd(newStart, newDurationMin);
  return existingStart < newEnd && existingEnd > newStart;
}

export function blocksAppointment(candidate: AppointmentInterval, next: AppointmentInterval) {
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(candidate.status as "PENDING" | "CONFIRMED")) {
    return false;
  }

  if (candidate.id && next.id && candidate.id === next.id) {
    return false;
  }

  if (candidate.barbershopId !== next.barbershopId || candidate.memberId !== next.memberId) {
    return false;
  }

  return intervalsOverlap(candidate.start, candidate.durationMin, next.start, next.durationMin);
}
