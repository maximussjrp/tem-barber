import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

const VALID_STATUSES = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<string, ValidStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const { id } = await params;

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { status } = body;

  if (!status || !VALID_STATUSES.includes(status as ValidStatus)) {
    return NextResponse.json(
      { error: "Status inválido. Use: CONFIRMED, COMPLETED, NO_SHOW ou CANCELLED." },
      { status: 400 }
    );
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id, memberId: data!.memberId },
  });

  if (!appointment) {
    return NextResponse.json(
      { error: "Agendamento não encontrado." },
      { status: 404 }
    );
  }

  const allowed = ALLOWED_TRANSITIONS[appointment.status] ?? [];
  if (!allowed.includes(status as ValidStatus)) {
    return NextResponse.json(
      {
        error: `Transição inválida: ${appointment.status} → ${status}.`,
      },
      { status: 422 }
    );
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: status as ValidStatus },
    include: {
      customer: { select: { name: true, phone: true } },
      services: {
        include: { service: { select: { name: true, durationMin: true } } },
      },
    },
  });

  return NextResponse.json(updated);
}
