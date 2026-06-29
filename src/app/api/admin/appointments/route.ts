import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, AppointmentStatus } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import { AppointmentConflictError } from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";
import { normalizePhone, resolveBarbershopCustomerForBooking } from "@/lib/customers";
import { todayIsoBR, nowBR } from "@/lib/time-utils";

interface AdminAppointmentBody {
  memberId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  serviceIds?: string[];
  dateTime?: string;
  notes?: string;
}

function conflictResponse(error: AppointmentConflictError) {
  return NextResponse.json(
    { error: error.code, message: error.message },
    { status: error.status }
  );
}

function isRetryableTransactionError(error: unknown) {
  const errStr = String(error);
  if (errStr.includes("TransactionWriteConflict") || errStr.includes("WriteConflict")) {
    return true;
  }

  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as any).message);
    if (
      msg.includes("TransactionWriteConflict") ||
      msg.includes("could not serialize access") ||
      msg.includes("write conflict") ||
      msg.includes("deadlock")
    ) {
      return true;
    }
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return (
    error.code === "P2034" ||
    error.message.includes("could not serialize access") ||
    error.message.includes("write conflict") ||
    error.message.includes("deadlock")
  );
}

function isUserPhoneUniqueConstraint(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("phone") : String(target ?? "").includes("phone");
}

async function runSerializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw new AppointmentConflictError("A reserva ainda esta sendo processada. Tente novamente.");
}

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

  let startOfDay: Date;
  let endOfDay: Date;
  let targetDateStr: string;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    targetDateStr = dateStr;
    const [y, m, d] = dateStr.split("-").map(Number);
    startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  } else {
    targetDateStr = todayIsoBR();
    const [y, m, d] = targetDateStr.split("-").map(Number);
    startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  }

  const where: Prisma.AppointmentWhereInput = {
    barbershopId,
    dateTime: { gte: startOfDay, lte: endOfDay },
  };

  if (memberIdFilter) where.memberId = memberIdFilter;
  if (
    statusFilter &&
    statusFilter !== "ALL" &&
    Object.values(AppointmentStatus).includes(statusFilter as AppointmentStatus)
  ) {
    where.status = statusFilter as AppointmentStatus;
  }

  const [appointments, total, barbershop] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        barber: {
          include: { user: { select: { name: true, avatarUrl: true } } },
        },
        services: {
          include: { service: { select: { id: true, name: true, durationMin: true } } },
        },
        comandas: {
          select: { id: true, status: true, total: true, paidTotal: true },
        },
      },
      orderBy: { dateTime: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
    prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { name: true, slug: true },
    }),
  ]);

  const dayOfWeek = startOfDay.getUTCDay();
  const rawMembers = await prisma.barbershopMember.findMany({
    where: {
      barbershopId,
      isActive: true,
      services: { some: {} },
    },
    include: { 
      user: { select: { name: true } },
      workingHours: {
        where: { dayOfWeek, isActive: true },
      },
      timeOffs: {
        where: {
          startDate: { lte: endOfDay },
          endDate: { gte: startOfDay },
        },
      },
    },
    orderBy: { user: { name: "asc" } },
  });

  const toMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };

  const isToday = targetDateStr === todayIsoBR();
  const brNow = nowBR();
  const brNowMinutes = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();

  const members = [];
  for (const member of rawMembers) {
    if (member.timeOffs.length > 0) {
      members.push({
        id: member.id,
        user: { name: member.user.name },
        startTime: "",
        endTime: "",
        freeSlots: [],
      });
      continue;
    }

    const wh = member.workingHours[0];
    if (!wh) {
      members.push({
        id: member.id,
        user: { name: member.user.name },
        startTime: "",
        endTime: "",
        freeSlots: [],
      });
      continue;
    }

    const workStart = toMinutes(wh.startTime);
    const workEnd = toMinutes(wh.endTime);
    const breakStart = wh.breakStart ? toMinutes(wh.breakStart) : null;
    const breakEnd = wh.breakEnd ? toMinutes(wh.breakEnd) : null;

    // Get busy times for this member today
    const appts = await prisma.appointment.findMany({
      where: {
        memberId: member.id,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    });

    const busy = appts.map((a) => {
      const dt = new Date(a.dateTime);
      const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      return { start: startMin, end: startMin + a.durationMin };
    });

    const freeSlots: number[] = [];
    const SLOT_INTERVAL = 30;

    for (let start = workStart; start + SLOT_INTERVAL <= workEnd; start += SLOT_INTERVAL) {
      const end = start + SLOT_INTERVAL;

      if (breakStart !== null && breakEnd !== null) {
        if (start < breakEnd && end > breakStart) continue;
      }

      const conflict = busy.some((b) => start < b.end && end > b.start);
      if (conflict) continue;

      if (isToday && start <= brNowMinutes) continue;

      freeSlots.push(start);
    }

    members.push({
      id: member.id,
      user: { name: member.user.name },
      startTime: wh.startTime,
      endTime: wh.endTime,
      freeSlots,
    });
  }

  return NextResponse.json({
    appointments,
    total,
    page,
    pageSize,
    members,
    barbershopName: barbershop?.name ?? "",
    barbershopSlug: barbershop?.slug ?? "",
  });
}

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  let body: AdminAppointmentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const { memberId, customerId, customerName, customerPhone, serviceIds, dateTime, notes } = body;

  if (!memberId || !serviceIds?.length || !dateTime) {
    return NextResponse.json(
      { error: "memberId, serviceIds e dateTime sao obrigatorios." },
      { status: 400 }
    );
  }

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;
  const requestedDateTime = new Date(dateTime.endsWith("Z") ? dateTime : dateTime + "Z");
  if (Number.isNaN(requestedDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  try {
    const result = await runSerializableTransaction(
      async (tx) => {
        const member = await tx.barbershopMember.findFirst({
          where: {
            id: memberId,
            barbershopId,
            isActive: true,
            services: { some: {} },
          },
        });
      if (!member) {
        return {
          error: NextResponse.json({ error: "Barbeiro nao encontrado." }, { status: 404 }),
        };
      }

      let resolvedCustomerId: string;
      try {
        const customer = await resolveBarbershopCustomerForBooking(tx, {
          barbershopId,
          customerId,
          customerName,
          customerPhone: normalizePhone(customerPhone),
        });
        resolvedCustomerId = customer.id;
      } catch (resolveError) {
        if (resolveError instanceof Error && resolveError.message === "CUSTOMER_NOT_FOUND_IN_BARBERSHOP") {
          return {
            error: NextResponse.json({ error: "Cliente nao encontrado nesta barbearia." }, { status: 404 }),
          };
        }
        if (resolveError instanceof Error && resolveError.message === "CUSTOMER_PHONE_REQUIRED") {
          return {
            error: NextResponse.json(
              { error: "Informe customerId ou customerPhone." },
              { status: 400 }
            ),
          };
        }
        throw resolveError;
      }

      const services = await tx.service.findMany({
        where: {
          id: { in: serviceIds },
          barbershopId,
          isActive: true,
        },
      });

      if (services.length !== serviceIds.length) {
        return {
          error: NextResponse.json(
            { error: "Um ou mais servicos nao foram encontrados ou estao inativos." },
            { status: 400 }
          ),
        };
      }

      const { totalPrice, durationMin } = calculateAppointmentTotals(services);
      const appointment = await createAppointmentWithScheduleLock(tx, {
        barbershopId,
        memberId,
        customerId: resolvedCustomerId,
        dateTime: requestedDateTime,
        totalPrice,
        durationMin,
        services,
        notes: notes ?? null,
      });

        return { appointment };
      }
    );

    if ("error" in result && result.error) return result.error;
    return NextResponse.json(result.appointment, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return conflictResponse(error);
    }
    if (isUserPhoneUniqueConstraint(error)) {
      return NextResponse.json(
        { error: "Telefone ja cadastrado fora desta barbearia. Nao foi criado cliente duplicado." },
        { status: 409 }
      );
    }
    throw error;
  }
}
