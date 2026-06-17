import type { Prisma } from "@prisma/client";

export async function lockAppointmentSchedule(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  memberId: string
) {
  const lockKey = `${barbershopId}:${memberId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
