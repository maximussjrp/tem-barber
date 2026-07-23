import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

interface Params {
  params: Promise<{ slug: string }>;
}

// GET /api/public/barbershop/[slug]/waitlist — public waitlist status, services & members
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;

  const barbershop = await prisma.barbershop.findFirst({
    where: { slug, active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
    },
  });

  if (!barbershop) {
    return NextResponse.json(
      { error: "BARBERSHOP_NOT_FOUND", message: "Barbearia não encontrada ou inativa." },
      { status: 404 }
    );
  }

  const session = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId: barbershop.id, status: "OPEN" },
    select: {
      id: true,
      status: true,
      title: true,
      notes: true,
      defaultLockBeforeAppointmentMinutes: true,
      openedAt: true,
    },
  });

  const services = await prisma.service.findMany({
    where: { barbershopId: barbershop.id, isActive: true },
    select: {
      id: true,
      name: true,
      durationMin: true,
      price: true,
      description: true,
    },
    orderBy: { name: "asc" },
  });

  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId: barbershop.id, isActive: true },
    select: {
      id: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  const waitingCount = session
    ? await prisma.onlineWaitlistEntry.count({
        where: { sessionId: session.id, status: "WAITING" },
      })
    : 0;

  return NextResponse.json({
    barbershop,
    isOpen: Boolean(session),
    session: session ?? null,
    services,
    members: members.map((m) => ({ id: m.id, name: m.user.name, avatarUrl: m.user.avatarUrl })),
    waitingCount,
  });
}
