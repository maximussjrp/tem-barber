import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const hours = await prisma.workingHour.findMany({
    where: { memberId: data!.memberId! },
    orderBy: { dayOfWeek: "asc" },
  });

  return NextResponse.json(hours);
}

interface HourPayload {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakStart?: string;
  breakEnd?: string;
  isActive: boolean;
}

export async function PUT(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const { hours } = body as { hours: HourPayload[] };

    if (!Array.isArray(hours) || hours.length > 7) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const memberId = data!.memberId!;

    await prisma.$transaction(
      hours.map((h) =>
        prisma.workingHour.upsert({
          where: {
            memberId_dayOfWeek: {
              memberId,
              dayOfWeek: h.dayOfWeek,
            },
          },
          update: {
            startTime: h.startTime,
            endTime: h.endTime,
            breakStart: h.breakStart || null,
            breakEnd: h.breakEnd || null,
            isActive: h.isActive,
          },
          create: {
            memberId,
            dayOfWeek: h.dayOfWeek,
            startTime: h.startTime,
            endTime: h.endTime,
            breakStart: h.breakStart || null,
            breakEnd: h.breakEnd || null,
            isActive: h.isActive,
          },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erro ao salvar horários." }, { status: 500 });
  }
}
