import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getOperationalStaffSession } from "@/lib/operational-session";
import {
  createScheduleBlockWithLock,
  parseScheduleBlockInterval,
  ScheduleBlockAppointmentConflictError,
  ScheduleBlockConflictError,
} from "@/lib/schedule-blocks";

export async function POST(request: NextRequest) {
  const { error, data } = await getOperationalStaffSession({ requiredPermission: "AGENDA_BLOCK_ALL" });
  if (error) return error;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;

  let body: {
    memberId?: string;
    startDate?: string;
    endDate?: string;
    reason?: string;
    allDay?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { memberId, startDate, endDate, reason, allDay } = body;

  if (!memberId || !startDate || !reason) {
    return NextResponse.json(
      { error: "memberId, startDate e reason são obrigatórios." },
      { status: 400 }
    );
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    return NextResponse.json(
      { error: "O motivo deve conter pelo menos 3 caracteres." },
      { status: 400 }
    );
  }

  const { start, end } = parseScheduleBlockInterval(startDate, endDate, allDay);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Datas inválidas." }, { status: 400 });
  }

  if (end.getTime() <= start.getTime()) {
    return NextResponse.json(
      { error: "O horário de fim deve ser posterior ao horário de início." },
      { status: 400 }
    );
  }

  try {
    const block = await prisma.$transaction(
      (tx) =>
        createScheduleBlockWithLock(tx, {
          barbershopId,
          memberId,
          startDate: start,
          endDate: end,
          reason: trimmedReason,
          allDay: Boolean(allDay),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(block, { status: 201 });
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
    if (err instanceof Error && err.message === "MEMBER_NOT_FOUND") {
      return NextResponse.json({ error: "Profissional não encontrado." }, { status: 404 });
    }
    throw err;
  }
}
