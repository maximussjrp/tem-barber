import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

interface HourPayload {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakStart?: string;
  breakEnd?: string;
  isActive: boolean;
}

async function guardMember(memberId: string, barbershopId: string) {
  const m = await prisma.barbershopMember.findUnique({ where: { id: memberId } });
  return m && m.barbershopId === barbershopId ? m : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  const hours = await prisma.workingHour.findMany({
    where: { memberId: id },
    orderBy: { dayOfWeek: "asc" },
  });

  return NextResponse.json(hours);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { hours } = body as { hours: HourPayload[] };

    if (!Array.isArray(hours) || hours.length > 7) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    await prisma.$transaction(
      hours.map((h) =>
        prisma.workingHour.upsert({
          where: { memberId_dayOfWeek: { memberId: id, dayOfWeek: h.dayOfWeek } },
          update: {
            startTime: h.startTime,
            endTime: h.endTime,
            breakStart: h.breakStart || null,
            breakEnd: h.breakEnd || null,
            isActive: h.isActive,
          },
          create: {
            memberId: id,
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
