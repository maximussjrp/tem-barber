import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import { phoneLookupVariants } from "@/lib/customers";

type SessionUser = {
  id?: string;
  authLevel?: string;
};

function hasClientAccess(sessionUser: SessionUser | undefined) {
  return sessionUser?.authLevel === "verified_link" || sessionUser?.authLevel === "verified_otp";
}

function hasStrongClientAccess(sessionUser: SessionUser | undefined) {
  return sessionUser?.authLevel === "verified_link" || sessionUser?.authLevel === "verified_otp";
}

// GET /api/client/appointments — list current user's appointments (all time)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!hasClientAccess(session.user as SessionUser)) {
    return NextResponse.json(
      { error: "Verificação necessária para acessar sua conta." },
      { status: 403 }
    );
  }

  const userId = (session.user as SessionUser).id as string;
  const { searchParams } = new URL(request.url);
  const barbershopFilter = searchParams.get("barbershop") || searchParams.get("barbershopId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  const phoneVariants = user?.phone ? phoneLookupVariants(user.phone) : [];

  const appointments = await prisma.appointment.findMany({
    where: {
      OR: [
        { customerId: userId },
        ...(phoneVariants.length > 0 ? [{ customer: { phone: { in: phoneVariants } } }] : []),
      ],
      ...(barbershopFilter
        ? {
            barbershop: {
              OR: [{ id: barbershopFilter }, { slug: barbershopFilter }],
            },
          }
        : {}),
    },
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

  if (!hasStrongClientAccess(session.user as SessionUser)) {
    return NextResponse.json(
      { error: "Acesso restrito. Use um link seguro para acessar sua conta." },
      { status: 403 }
    );
  }

  const userId = (session.user as SessionUser).id as string;

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
