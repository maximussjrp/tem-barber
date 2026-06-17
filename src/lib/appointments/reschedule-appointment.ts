import type { Prisma } from "@prisma/client";
import { AppointmentConflictError } from "./errors";
import { lockAppointmentSchedule } from "./appointment-lock";
import { findOverlappingAppointment } from "./find-overlap";

export interface RescheduleAppointmentInput {
  id: string;
  barbershopId: string;
  memberId: string;
  dateTime: Date;
  totalPrice: number;
  durationMin: number;
  notes?: string;
  serviceCreateData?: Array<{ serviceId: string; priceApplied: string | number | Prisma.Decimal }>;
}

export async function rescheduleAppointmentWithScheduleLock(
  tx: Prisma.TransactionClient,
  input: RescheduleAppointmentInput
) {
  await lockAppointmentSchedule(tx, input.barbershopId, input.memberId);

  const conflict = await findOverlappingAppointment(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    start: input.dateTime,
    durationMin: input.durationMin,
    excludeAppointmentId: input.id,
  });

  if (conflict) {
    throw new AppointmentConflictError();
  }

  if (input.serviceCreateData) {
    await tx.appointmentService.deleteMany({ where: { appointmentId: input.id } });
    await tx.appointmentService.createMany({
      data: input.serviceCreateData.map((service) => ({
        ...service,
        appointmentId: input.id,
      })),
    });
  }

  return tx.appointment.update({
    where: { id: input.id },
    data: {
      memberId: input.memberId,
      dateTime: input.dateTime,
      ...(input.notes !== undefined && { notes: input.notes }),
      totalPrice: input.totalPrice,
      durationMin: input.durationMin,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: { include: { service: { select: { name: true, durationMin: true } } } },
    },
  });
}
