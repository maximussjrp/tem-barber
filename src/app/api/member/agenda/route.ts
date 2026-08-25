import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

import { stripMetadataFromNotes } from "@/lib/appointments/notes-metadata";
import { deriveOperationalState } from "@/lib/operations/member-checkout";

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

  const cleaned = await Promise.all(
    appointments.map(async (a) => {
      // Get comanda if exists
      const comanda = await prisma.comanda.findFirst({
        where: { appointmentId: a.id },
        include: { items: true },
      });

      // Check if own appointment has pending services
      const hasOwnPendingService = comanda?.items.some(
        (item) => item.executorId === data!.memberId && item.status === "PENDING"
      );
      const hasOwnCompletedService = comanda?.items.some(
        (item) => item.executorId === data!.memberId && item.status === "DONE"
      );

      const operationalState = deriveOperationalState(
        a,
        comanda || undefined,
        hasOwnPendingService || false,
        hasOwnCompletedService || false
      );

      return {
        ...a,
        notes: stripMetadataFromNotes(a.notes),
        operationalState,
      };
    })
  );

  return NextResponse.json(cleaned);
}
