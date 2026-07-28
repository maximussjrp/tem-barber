import { Prisma } from "@prisma/client";
import { AppointmentConflictError, ScheduleBlockConflictApptError } from "./errors";
import { findOverlappingAppointment } from "./find-overlap";
import { findOverlappingScheduleBlock } from "@/lib/schedule-blocks";
import { lockAppointmentSchedule } from "./appointment-lock";
import {
  type AppointmentServiceInput,
  mapAppointmentServiceSnapshots,
} from "./calculate-appointment";

const appointmentBookingInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  customer: { select: { id: true, name: true, phone: true } },
  barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
  services: {
    include: { service: { select: { name: true, durationMin: true } } },
  },
});

export type AppointmentWithBookingRelations = Prisma.AppointmentGetPayload<{
  include: typeof appointmentBookingInclude;
}>;

export interface CreateAppointmentInput {
  barbershopId: string;
  memberId: string;
  customerId: string;
  dateTime: Date;
  totalPrice: number;
  durationMin: number;
  services: AppointmentServiceInput[];
  notes?: string | null;
}

export async function createAppointmentWithScheduleLock(
  tx: Prisma.TransactionClient,
  input: CreateAppointmentInput
): Promise<AppointmentWithBookingRelations> {
  await lockAppointmentSchedule(tx, input.barbershopId, input.memberId);

  const end = new Date(input.dateTime.getTime() + input.durationMin * 60 * 1000);
  const block = await findOverlappingScheduleBlock(tx, {
    memberId: input.memberId,
    start: input.dateTime,
    end,
  });
  if (block) {
    throw new ScheduleBlockConflictApptError();
  }

  const conflict = await findOverlappingAppointment(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    start: input.dateTime,
    durationMin: input.durationMin,
  });

  if (conflict) {
    throw new AppointmentConflictError();
  }

  return tx.appointment.create({
    data: {
      barbershopId: input.barbershopId,
      memberId: input.memberId,
      customerId: input.customerId,
      dateTime: input.dateTime,
      totalPrice: input.totalPrice,
      durationMin: input.durationMin,
      status: "CONFIRMED",
      notes: input.notes ?? null,
      services: {
        create: mapAppointmentServiceSnapshots(input.services),
      },
    },
    include: appointmentBookingInclude,
  });
}
