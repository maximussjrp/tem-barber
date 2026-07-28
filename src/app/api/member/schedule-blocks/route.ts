import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import {
  createScheduleBlockWithLock,
  isNormalizedTimeOffOverlapping,
  normalizeStoredTimeOffInterval,
  parseScheduleBlockInterval,
  ScheduleBlockAppointmentConflictError,
  ScheduleBlockConflictError,
} from "@/lib/schedule-blocks";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const url = new URL(request.url);
  const dateStr = url.searchParams.get("date");

  let where: Prisma.TimeOffWhereInput = { memberId: data!.memberId };

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
    where = {
      ...where,
      startDate: { lt: endOfDay },
      endDate: { gte: startOfDay },
    };
  }

  const blocks = await prisma.timeOff.findMany({
    where,
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      memberId: true,
      startDate: true,
      endDate: true,
      reason: true,
      allDay: true,
    },
  });

  const normalizedBlocks = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? blocks.filter((block) => {
        const [y, m, d] = dateStr.split("-").map(Number);
        const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
        return isNormalizedTimeOffOverlapping(block, { start: startOfDay, end: endOfDay });
      })
    : blocks;

  return NextResponse.json(normalizedBlocks.map((block) => normalizeStoredTimeOffInterval(block)));
}

export async function POST(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  let body: {
    startDate?: string;
    endDate?: string;
    reason?: string;
    allDay?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const { startDate, endDate, reason, allDay } = body;

  if (!startDate || !reason) {
    return NextResponse.json(
      { error: "startDate e reason sao obrigatorios." },
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
    return NextResponse.json({ error: "Datas invalidas." }, { status: 400 });
  }

  if (end.getTime() <= start.getTime()) {
    return NextResponse.json(
      { error: "O horario de fim deve ser posterior ao horario de inicio." },
      { status: 400 }
    );
  }

  try {
    const block = await prisma.$transaction(
      (tx) =>
        createScheduleBlockWithLock(tx, {
          barbershopId: data!.barbershopId,
          memberId: data!.memberId,
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
      return NextResponse.json({ error: "Profissional nao encontrado." }, { status: 404 });
    }
    throw err;
  }
}
