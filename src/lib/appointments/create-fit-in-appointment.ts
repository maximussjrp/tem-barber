import { Prisma } from "@prisma/client";
import { lockAppointmentSchedule } from "./appointment-lock";
import { findOverlappingAppointment } from "./find-overlap";
import {
  type AppointmentServiceInput,
  mapAppointmentServiceSnapshots,
} from "./calculate-appointment";

const fitInAppointmentInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  customer: { select: { id: true, name: true, phone: true } },
  barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
  services: {
    include: { service: { select: { id: true, name: true, durationMin: true } } },
  },
  comandas: {
    select: { id: true, status: true, total: true, paidTotal: true },
  },
});

export type AppointmentWithFitInRelations = Prisma.AppointmentGetPayload<{
  include: typeof fitInAppointmentInclude;
}>;

export interface FitInConflictSnapshot {
  conflictAppointmentId: string;
  existingStart: string;
  existingDurationMin: number;
  detectedAt: string;
}

export interface CreateFitInAppointmentInput {
  barbershopId: string;
  memberId: string;
  customerId: string;
  dateTime: Date;
  totalPrice: number;
  durationMin: number;
  services: AppointmentServiceInput[];
  notes?: string | null;
  fitInReason: string;
  fitInCreatedById: string;
}

export async function createFitInAppointmentWithScheduleLock(
  tx: Prisma.TransactionClient,
  input: CreateFitInAppointmentInput
): Promise<{
  appointment: AppointmentWithFitInRelations;
  conflictSnapshot: FitInConflictSnapshot | null;
}> {
  await lockAppointmentSchedule(tx, input.barbershopId, input.memberId);

  const conflict = await findOverlappingAppointment(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    start: input.dateTime,
    durationMin: input.durationMin,
  });

  let conflictSnapshot: FitInConflictSnapshot | null = null;
  if (conflict) {
    const conflictingAppointment = await tx.appointment.findUnique({
      where: { id: conflict.id },
      select: { id: true, dateTime: true, durationMin: true },
    });

    if (conflictingAppointment) {
      conflictSnapshot = {
        conflictAppointmentId: conflictingAppointment.id,
        existingStart: conflictingAppointment.dateTime.toISOString(),
        existingDurationMin: conflictingAppointment.durationMin,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  const conflictSnapshotJson = conflictSnapshot
    ? (conflictSnapshot as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  const appointment = (await tx.appointment.create({
    data: {
      barbershopId: input.barbershopId,
      memberId: input.memberId,
      customerId: input.customerId,
      dateTime: input.dateTime,
      totalPrice: input.totalPrice,
      durationMin: input.durationMin,
      status: "CONFIRMED",
      bookingMode: "FIT_IN",
      fitInReason: input.fitInReason,
      fitInCreatedById: input.fitInCreatedById,
      fitInCreatedAt: new Date(),
      conflictSnapshot: conflictSnapshotJson,
      notes: input.notes ?? null,
      services: {
        create: mapAppointmentServiceSnapshots(input.services),
      },
    },
    include: fitInAppointmentInclude,
  })) as AppointmentWithFitInRelations;

  return {
    appointment,
    conflictSnapshot,
  };
}
