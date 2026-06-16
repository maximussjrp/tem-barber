import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/public/barbershop/[slug]/availability
// Query params: memberId, serviceIds (comma-separated), date (YYYY-MM-DD)
//
// Returns available time slots for the given date considering:
//   - WorkingHour (member's schedule)
//   - TimeOff (vacations / blocks)
//   - Existing appointments (busy slots)
//   - Total service duration

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sp = request.nextUrl.searchParams;

  const memberIdParam = sp.get("memberId");
  const serviceIdsParam = sp.get("serviceIds"); // "id1,id2"
  const dateStr = sp.get("date"); // YYYY-MM-DD

  if (!serviceIdsParam || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json(
      { error: "Parâmetros obrigatórios: serviceIds, date (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const serviceIds = serviceIdsParam.split(",").filter(Boolean);

  // Resolve barbershop
  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Compute total duration from selected services
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, barbershopId: barbershop.id, isActive: true },
  });
  if (services.length === 0) {
    return NextResponse.json({ error: "Nenhum serviço válido encontrado." }, { status: 400 });
  }
  const totalDuration = services.reduce((s, svc) => s + svc.durationMin, 0);

  // Parse target date
  const [year, month, day] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));

  // Determine which members to check
  let memberIds: string[];
  if (memberIdParam) {
    memberIds = [memberIdParam];
  } else {
    // Any available barber who performs all selected services
    const capable = await prisma.barbershopMember.findMany({
      where: {
        barbershopId: barbershop.id,
        isActive: true,
        services: { some: { serviceId: { in: serviceIds } } },
      },
      select: { id: true },
    });
    memberIds = capable.map((m) => m.id);
  }

  if (memberIds.length === 0) {
    return NextResponse.json({ slots: [] });
  }

  const results: Array<{
    memberId: string;
    memberName: string;
    slots: string[];
  }> = [];

  for (const memberId of memberIds) {
    const member = await prisma.barbershopMember.findFirst({
      where: { id: memberId, barbershopId: barbershop.id, isActive: true },
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

    // Convert working hours to minutes from midnight
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
        memberId,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { dateTime: "asc" },
    });

    // Build busy intervals in minutes
    const busy = existing.map((a) => {
      const dt = new Date(a.dateTime);
      const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      return { start: startMin, end: startMin + a.durationMin };
    });

    // Generate 30-min interval slots
    const SLOT_INTERVAL = 30;
    const slots: string[] = [];

    for (let start = workStart; start + totalDuration <= workEnd; start += SLOT_INTERVAL) {
      const end = start + totalDuration;

      // Skip if overlaps with break
      if (breakStart !== null && breakEnd !== null) {
        if (start < breakEnd && end > breakStart) continue;
      }

      // Skip if overlaps with existing appointment
      const conflict = busy.some((b) => start < b.end && end > b.start);
      if (conflict) continue;

      // Skip past slots for today
      const now = new Date();
      const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
      if (dateStr === todayStr) {
        const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        if (start <= nowMinutes) continue;
      }

      const hh = String(Math.floor(start / 60)).padStart(2, "0");
      const mm = String(start % 60).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }

    results.push({
      memberId,
      memberName: member.user.name,
      slots,
    });
  }

  return NextResponse.json({ results, totalDuration });
}
