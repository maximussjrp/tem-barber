import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// POST /api/public/barbershop/[slug]/book
// Body: { memberId, serviceIds, dateTime, customerName?, customerPhone? }
// If session exists (logged-in client), uses session user.
// Otherwise requires customerPhone (and optional customerName) to find/create user.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body: {
    memberId?: string;
    serviceIds?: string[];
    dateTime?: string;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { memberId, serviceIds, dateTime, customerName, customerPhone, notes } = body;

  if (!memberId || !serviceIds?.length || !dateTime) {
    return NextResponse.json(
      { error: "memberId, serviceIds e dateTime são obrigatórios." },
      { status: 400 }
    );
  }

  // Resolve barbershop
  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Validate member
  const member = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId: barbershop.id, isActive: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Barbeiro não disponível." }, { status: 404 });
  }

  // Validate & price services
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, barbershopId: barbershop.id, isActive: true },
  });
  if (services.length !== serviceIds.length) {
    return NextResponse.json({ error: "Um ou mais serviços inválidos." }, { status: 400 });
  }

  const totalPrice = services.reduce((s, svc) => s + Number(svc.price), 0);
  const durationMin = services.reduce((s, svc) => s + svc.durationMin, 0);
  const requestedDateTime = new Date(dateTime);

  if (isNaN(requestedDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime inválido." }, { status: 400 });
  }

  // Conflict check — same member, overlapping active appointment
  const slotStart = requestedDateTime;
  const slotEnd = new Date(requestedDateTime.getTime() + durationMin * 60_000);

  const conflict = await prisma.appointment.findFirst({
    where: {
      memberId,
      status: { in: ["PENDING", "CONFIRMED"] },
      dateTime: { lt: slotEnd },
      AND: [
        {
          dateTime: {
            gte: new Date(slotStart.getTime() - 24 * 60 * 60_000), // safety window
          },
        },
      ],
    },
  });

  // Fine-grain overlap check
  if (conflict) {
    const cStart = new Date(conflict.dateTime).getTime();
    const cEnd = cStart + conflict.durationMin * 60_000;
    const sStart = slotStart.getTime();
    const sEnd = slotEnd.getTime();
    if (sStart < cEnd && sEnd > cStart) {
      return NextResponse.json(
        { error: "Horário não disponível. Escolha outro horário." },
        { status: 409 }
      );
    }
  }

  // Resolve customer
  let customerId: string;

  const session = await getServerSession(authOptions);
  if (session?.user) {
    customerId = (session.user as any).id as string;
  } else {
    if (!customerPhone) {
      return NextResponse.json(
        { error: "Informe seu telefone para confirmar o agendamento." },
        { status: 400 }
      );
    }
    const cleanPhone = customerPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
    }

    let customer = await prisma.user.findFirst({ where: { phone: cleanPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: {
          name: customerName?.trim() || "Cliente",
          phone: cleanPhone,
          role: "USER",
        },
      });
    }
    customerId = customer.id;
  }

  // Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      barbershopId: barbershop.id,
      memberId,
      customerId,
      dateTime: requestedDateTime,
      totalPrice,
      durationMin,
      status: "CONFIRMED",
      notes: notes?.trim() || null,
      services: {
        create: services.map((s) => ({
          serviceId: s.id,
          priceApplied: s.price,
        })),
      },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true } } } },
      services: {
        include: { service: { select: { name: true, durationMin: true } } },
      },
    },
  });

  return NextResponse.json(
    {
      appointment: {
        id: appointment.id,
        dateTime: appointment.dateTime,
        status: appointment.status,
        totalPrice: appointment.totalPrice,
        durationMin: appointment.durationMin,
        barberName: appointment.barber.user.name,
        customerName: appointment.customer.name,
        services: appointment.services.map((s) => s.service.name),
        barbershopName: barbershop.name,
        barbershopSlug: slug,
      },
    },
    { status: 201 }
  );
}
