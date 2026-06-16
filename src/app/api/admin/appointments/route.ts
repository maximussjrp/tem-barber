import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

// GET /api/admin/appointments?date=YYYY-MM-DD&memberId=...&status=...&page=1
export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const dateStr = sp.get("date");
  const memberIdFilter = sp.get("memberId");
  const statusFilter = sp.get("status");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = 20;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;

  // Date range — default today
  let startOfDay: Date;
  let endOfDay: Date;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-").map(Number);
    startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  } else {
    const now = new Date();
    startOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
  }

  const where: any = {
    barbershopId,
    dateTime: { gte: startOfDay, lte: endOfDay },
  };

  if (memberIdFilter) where.memberId = memberIdFilter;
  if (statusFilter && statusFilter !== "ALL") where.status = statusFilter;

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        barber: {
          include: { user: { select: { name: true, avatarUrl: true } } },
        },
        services: {
          include: { service: { select: { name: true, durationMin: true } } },
        },
      },
      orderBy: { dateTime: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);

  // Also return team list for filter dropdown
  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId, isActive: true },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  return NextResponse.json({ appointments, total, page, pageSize, members });
}

// POST /api/admin/appointments — create appointment manually
export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  let body: {
    memberId?: string;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    serviceIds?: string[];
    dateTime?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { memberId, customerId, customerName, customerPhone, serviceIds, dateTime, notes } = body;

  if (!memberId || !serviceIds?.length || !dateTime) {
    return NextResponse.json(
      { error: "memberId, serviceIds e dateTime são obrigatórios." },
      { status: 400 }
    );
  }

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;

  // Validate member belongs to barbershop
  const member = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId, isActive: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Barbeiro não encontrado." }, { status: 404 });
  }

  // Resolve or create customer
  let resolvedCustomerId = customerId;
  if (!resolvedCustomerId) {
    if (!customerPhone) {
      return NextResponse.json(
        { error: "Informe customerId ou customerPhone." },
        { status: 400 }
      );
    }
    const cleanPhone = customerPhone.replace(/\D/g, "");
    let customer = await prisma.user.findFirst({ where: { phone: cleanPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { name: customerName ?? "Cliente", phone: cleanPhone, role: "USER" },
      });
    }
    resolvedCustomerId = customer.id;
  }

  // Fetch services to compute total price and duration
  const services = await prisma.service.findMany({
    where: {
      id: { in: serviceIds },
      barbershopId,
      isActive: true,
    },
  });

  if (services.length !== serviceIds.length) {
    return NextResponse.json(
      { error: "Um ou mais serviços não foram encontrados ou estão inativos." },
      { status: 400 }
    );
  }

  const totalPrice = services.reduce((sum, s) => sum + Number(s.price), 0);
  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);

  const appointment = await prisma.appointment.create({
    data: {
      barbershopId,
      memberId,
      customerId: resolvedCustomerId,
      dateTime: new Date(dateTime),
      totalPrice,
      durationMin,
      status: "CONFIRMED",
      notes: notes ?? null,
      services: {
        create: services.map((s) => ({
          serviceId: s.id,
          priceApplied: s.price,
        })),
      },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: { include: { service: { select: { name: true, durationMin: true } } } },
    },
  });

  return NextResponse.json(appointment, { status: 201 });
}
