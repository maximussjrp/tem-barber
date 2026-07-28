import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import {
  createScheduleBlockWithLock,
  deleteScheduleBlock,
  normalizeStoredTimeOffInterval,
  parseScheduleBlockInterval,
  ScheduleBlockAppointmentConflictError,
  ScheduleBlockConflictError,
} from "@/lib/schedule-blocks";

async function guardMember(memberId: string, barbershopId: string) {
  const member = await prisma.barbershopMember.findUnique({ where: { id: memberId } });
  return member && member.barbershopId === barbershopId ? member : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 });
  }

  const timeOffs = await prisma.timeOff.findMany({
    where: { memberId: id },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json(timeOffs.map((timeOff) => normalizeStoredTimeOffInterval(timeOff)));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { startDate, endDate, reason } = body;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Datas de inicio e fim sao obrigatorias." }, { status: 400 });
    }

    const { start, end } = parseScheduleBlockInterval(startDate, endDate, true);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Datas invalidas." }, { status: 400 });
    }

    if (end <= start) {
      return NextResponse.json({ error: "A data de fim deve ser apos a de inicio." }, { status: 400 });
    }

    const timeOff = await prisma.$transaction(
      (tx) =>
        createScheduleBlockWithLock(tx, {
          barbershopId: data!.barbershopId!,
          memberId: id,
          startDate: start,
          endDate: end,
          reason: reason?.trim() || "Folga",
          allDay: true,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(timeOff, { status: 201 });
  } catch (err) {
    if (err instanceof ScheduleBlockAppointmentConflictError) {
      return NextResponse.json(
        { error: err.code, message: err.message, conflicts: err.conflicts },
        { status: err.status }
      );
    }
    if (err instanceof ScheduleBlockConflictError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao registrar folga." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { timeOffId } = body;

    if (!timeOffId) {
      return NextResponse.json({ error: "timeOffId e obrigatorio." }, { status: 400 });
    }

    await prisma.$transaction((tx) =>
      deleteScheduleBlock(tx, {
        barbershopId: data!.barbershopId!,
        memberId: id,
        timeOffId,
      })
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "SCHEDULE_BLOCK_NOT_FOUND") {
      return NextResponse.json({ error: "Folga nao encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "Erro ao excluir folga." }, { status: 500 });
  }
}
