import prisma from "@/lib/prisma";
import { startOfDayUTC, endOfDayUTC, nowBR, todayIsoBR } from "@/lib/time-utils";

export interface GetAvailabilityParams {
  barbershopId: string;
  dateStr: string; // YYYY-MM-DD
  serviceIds: string[];
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
  memberId,
}: GetAvailabilityParams): Promise<{ results: AvailabilityResult[]; totalDuration: number }> {
  // Validate basic parameters
  if (!serviceIds.length) {
    return { results: [], totalDuration: 0 };
  }

  // 1. Compute total duration from selected services
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, barbershopId, isActive: true },
  });
  if (services.length === 0) {
    return { results: [], totalDuration: 0 };
  }
  const totalDuration = services.reduce((s, svc) => s + svc.durationMin, 0);

  // 2. Parse target date to UTC edges (so it matches DB exactly for that date)
  const [year, month, day] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const startOfDay = startOfDayUTC(year, month, day);
  const endOfDay = endOfDayUTC(year, month, day);

  // 3. Determine which members to check
  let memberIds: string[];
  if (memberId) {
    memberIds = [memberId];
  } else {
    // Any available barber who performs all selected services
    const capable = await prisma.barbershopMember.findMany({
      where: {
        barbershopId,
        isActive: true,
        services: { some: { serviceId: { in: serviceIds } } },
      },
      select: { id: true },
    });
    memberIds = capable.map((m) => m.id);
  }

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
            startDate: { lte: endOfDay },
            endDate: { gte: startOfDay },
          },
        },
      },
    });

    if (!member) continue;

    // Skip if on time off
    if (member.timeOffs.length > 0) continue;

    // Skip if no working hours for this day
    const wh = member.workingHours[0];
    if (!wh) continue;

    const toMinutes = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };

    const workStart = toMinutes(wh.startTime);
    const workEnd = toMinutes(wh.endTime);
    const breakStart = wh.breakStart ? toMinutes(wh.breakStart) : null;
    const breakEnd = wh.breakEnd ? toMinutes(wh.breakEnd) : null;

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
    const busy = existing.map((a) => {
      const dt = new Date(a.dateTime);
      const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      return { start: startMin, end: startMin + a.durationMin };
    });

    const SLOT_INTERVAL = 30;
    const slots: string[] = [];

    // BR Time check to block past slots on "today"
    const isToday = dateStr === todayIsoBR();
    const brNow = nowBR();
    const brNowMinutes = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();

    for (let start = workStart; start + totalDuration <= workEnd; start += SLOT_INTERVAL) {
      const end = start + totalDuration;

      // Skip if overlaps with break
      if (breakStart !== null && breakEnd !== null) {
        if (start < breakEnd && end > breakStart) continue;
      }

      // Skip if overlaps with existing appointment
      const conflict = busy.some((b) => start < b.end && end > b.start);
      if (conflict) continue;

      // Skip past slots if checking today
      if (isToday && start <= brNowMinutes) continue;

      const hh = String(Math.floor(start / 60)).padStart(2, "0");
      const mm = String(start % 60).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }

    results.push({
      memberId: mId,
      memberName: member.user.name,
      slots,
    });
  }

  return { results, totalDuration };
}
