import prisma from "@/lib/prisma";
import { startOfDayUTC, endOfDayUTC, nowBR } from "@/lib/time-utils";
import { isNormalizedTimeOffOverlapping, normalizeStoredTimeOffInterval } from "@/lib/schedule-blocks";
import { findEligibleMembersForServices } from "./professional-service-capability";
import { getPublicSlotInvalidReason } from "./public-booking-eligibility";

export interface GetAvailabilityParams {
  barbershopId: string;
  dateStr: string; // YYYY-MM-DD
  serviceIds: string[];
  services?: { serviceId: string; quantity: number }[];
  memberId?: string; // se undefined, retorna para todos disponíveis
}

export interface AvailabilityResult {
  memberId: string;
  memberName: string;
  slots: string[];
}

export async function getAvailableSlots({
  barbershopId,
  dateStr,
  serviceIds,
  services,
  memberId,
}: GetAvailabilityParams): Promise<{ results: AvailabilityResult[]; totalDuration: number }> {
  const capability = await findEligibleMembersForServices(prisma, {
    barbershopId,
    serviceIds,
    memberId,
  });

  if (!capability.services.length) {
    return { results: [], totalDuration: 0 };
  }

  let totalDuration = 0;
  if (services && services.length > 0) {
    const serviceQtyMap = new Map(services.map(s => [s.serviceId, s.quantity]));
    totalDuration = capability.services.reduce((s, svc) => s + svc.durationMin * (serviceQtyMap.get(svc.id) ?? 1), 0);
  } else {
    totalDuration = capability.services.reduce((s, svc) => s + svc.durationMin, 0);
  }

  // 2. Parse target date to UTC edges (so it matches DB exactly for that date)
  const [year, month, day] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const startOfDay = startOfDayUTC(year, month, day);
  const endOfDay = endOfDayUTC(year, month, day);

  const memberIds = capability.memberIds;

  if (memberIds.length === 0) {
    return { results: [], totalDuration };
  }

  const results: AvailabilityResult[] = [];

  // 4. Calculate for each member
  for (const mId of memberIds) {
    const member = await prisma.barbershopMember.findFirst({
      where: { id: mId, barbershopId, isActive: true },
      include: {
        user: { select: { name: true } },
        workingHours: {
          where: { dayOfWeek, isActive: true },
        },
        timeOffs: {
          where: {
            startDate: { lt: endOfDay },
            endDate: { gte: startOfDay },
          },
        },
      },
    });

    if (!member) continue;

    // Skip if no working hours for this day
    const wh = member.workingHours[0];
    if (!wh) continue;

    const toMinutes = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };

    const workStart = toMinutes(wh.startTime);
    const workEnd = toMinutes(wh.endTime);

    // Converter TimeOffs em intervalos ocupados de minutos no dia
    const timeOffBusy = member.timeOffs.filter((storedTimeOff) =>
      isNormalizedTimeOffOverlapping(storedTimeOff, { start: startOfDay, end: endOfDay })
    ).map((storedTimeOff) => {
      const to = normalizeStoredTimeOffInterval(storedTimeOff);
      const toStart = to.startDate ? new Date(to.startDate) : null;
      const toEnd = to.endDate ? new Date(to.endDate) : null;

      if (!toStart || !toEnd || isNaN(toStart.getTime()) || isNaN(toEnd.getTime())) {
        return { start: 0, end: 1440 };
      }

      const startMin = toStart.getTime() <= startOfDay.getTime()
        ? 0
        : toStart.getUTCHours() * 60 + toStart.getUTCMinutes();

      const endMin = toEnd.getTime() >= endOfDay.getTime()
        ? 1440
        : toEnd.getUTCHours() * 60 + toEnd.getUTCMinutes();

      return { start: startMin, end: endMin };
    });

    // Get existing appointments for this member on this day
    const existing = await prisma.appointment.findMany({
      where: {
        memberId: mId,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { dateTime: "asc" },
    });

    // Build busy intervals in minutes based on UTC hours (since dateTime is stored UTC aligned)
    const busy = [
      ...existing.map((a) => {
        const dt = new Date(a.dateTime);
        const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
        return { start: startMin, end: startMin + a.durationMin };
      }),
      ...timeOffBusy,
    ];

    const SLOT_INTERVAL = 30;
    const slots: string[] = [];

    const brNow = nowBR();

    for (let start = workStart; start + totalDuration <= workEnd; start += SLOT_INTERVAL) {
      const end = start + totalDuration;

      const dateTime = new Date(Date.UTC(year, month - 1, day, Math.floor(start / 60), start % 60));
      if (
        getPublicSlotInvalidReason({
          dateTime,
          durationMin: totalDuration,
          workingHours: wh,
          now: brNow,
        })
      ) continue;

      // Skip if overlaps with existing appointment
      const conflict = busy.some((b) => start < b.end && end > b.start);
      if (conflict) continue;

      const hh = String(Math.floor(start / 60)).padStart(2, "0");
      const mm = String(start % 60).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }

    if (slots.length > 0) {
      results.push({
        memberId: mId,
        memberName: member.user?.name ?? "Profissional",
        slots,
      });
    }
  }

  return { results, totalDuration };
}
