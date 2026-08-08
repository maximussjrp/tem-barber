import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

import { stripMetadataFromNotes } from "@/lib/appointments/notes-metadata";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const dateStr = request.nextUrl.searchParams.get("date");

  let targetDate: Date;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    targetDate = new Date(dateStr + "T00:00:00.000Z");
  } else {
    const now = new Date();
    targetDate = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    );
  }

  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const appointments = await prisma.appointment.findMany({
    where: {
      memberId: data!.memberId,
      dateTime: { gte: startOfDay, lte: endOfDay },
    },
    include: {
      customer: { select: { name: true, phone: true } },
      barbershop: { select: { name: true } },
      services: {
        include: {
          service: { select: { name: true, durationMin: true } },
        },
      },
    },
    orderBy: { dateTime: "asc" },
  });

  const cleaned = appointments.map((a) => ({
    ...a,
    notes: stripMetadataFromNotes(a.notes),
  }));

  return NextResponse.json(cleaned);
}
