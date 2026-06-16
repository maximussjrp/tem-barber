import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/client/appointments — list current user's appointments (all time)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const userId = (session.user as any).id as string;

  const appointments = await prisma.appointment.findMany({
    where: { customerId: userId },
    include: {
      barbershop: {
        select: { id: true, name: true, slug: true, logoUrl: true, city: true, state: true },
      },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: {
        include: { service: { select: { name: true, durationMin: true } } },
      },
      review: { select: { id: true, rating: true, comment: true } },
    },
    orderBy: { dateTime: "desc" },
  });

  return NextResponse.json(appointments);
}

// PATCH /api/client/appointments/[id] — cancel a future appointment
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const userId = (session.user as any).id as string;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id é obrigatório." }, { status: 400 });
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id: body.id, customerId: userId },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)) {
    return NextResponse.json(
      { error: "Este agendamento não pode ser cancelado." },
      { status: 422 }
    );
  }

  // Only allow cancellation of future appointments (at least 1 minute ahead)
  if (new Date(appointment.dateTime).getTime() <= Date.now() + 60_000) {
    return NextResponse.json(
      { error: "Não é possível cancelar agendamentos no mesmo horário ou passados." },
      { status: 422 }
    );
  }

  const updated = await prisma.appointment.update({
    where: { id: body.id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json(updated);
}
