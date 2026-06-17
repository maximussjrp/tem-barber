import type { Prisma } from "@prisma/client";
import { getIntervalEnd } from "./overlap";

export interface FindOverlapInput {
  barbershopId: string;
  memberId: string;
  start: Date;
  durationMin: number;
  excludeAppointmentId?: string;
}

interface OverlapRow {
  id: string;
}

export async function findOverlappingAppointment(
  tx: Prisma.TransactionClient,
  input: FindOverlapInput
) {
  const end = getIntervalEnd(input.start, input.durationMin);
  const excludeAppointmentId = input.excludeAppointmentId ?? null;

  const rows = await tx.$queryRaw<OverlapRow[]>`
    SELECT "id"
    FROM "appointments"
    WHERE "barbershop_id" = ${input.barbershopId}
      AND "member_id" = ${input.memberId}
      AND "status" IN ('PENDING', 'CONFIRMED')
      AND (${excludeAppointmentId}::text IS NULL OR "id" <> ${excludeAppointmentId})
      AND "date_time" < ${end}
      AND ("date_time" + ("duration_min" * interval '1 minute')) > ${input.start}
    LIMIT 1
  `;

  return rows[0] ?? null;
}
