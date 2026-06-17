import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, AppointmentStatus } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import { AppointmentConflictError } from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";

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
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return (
    error.code === "P2034" ||
    error.message.includes("could not serialize access") ||
    error.message.includes("write conflict") ||
    error.message.includes("deadlock")
  );
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
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-").map(Number);
    startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  } else {
    const now = new Date();
    startOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    endOfDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
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
        comandas: {
          select: { id: true, status: true, total: true, paidTotal: true },
        },
      },
      orderBy: { dateTime: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
  ]);

  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId, isActive: true },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  return NextResponse.json({ appointments, total, page, pageSize, members });
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
  const requestedDateTime = new Date(dateTime);
  if (Number.isNaN(requestedDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  try {
    const result = await runSerializableTransaction(
      async (tx) => {
        const member = await tx.barbershopMember.findFirst({
          where: { id: memberId, barbershopId, isActive: true },
        });
      if (!member) {
        return {
          error: NextResponse.json({ error: "Barbeiro nao encontrado." }, { status: 404 }),
        };
      }

      let resolvedCustomerId = customerId;
      if (!resolvedCustomerId) {
        if (!customerPhone) {
          return {
            error: NextResponse.json(
              { error: "Informe customerId ou customerPhone." },
              { status: 400 }
            ),
          };
        }
        const cleanPhone = customerPhone.replace(/\D/g, "");
        let customer = await tx.user.findFirst({ where: { phone: cleanPhone } });
        if (!customer) {
          customer = await tx.user.create({
            data: { name: customerName ?? "Cliente", phone: cleanPhone, role: "USER" },
          });
        }
        resolvedCustomerId = customer.id;
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
    throw error;
  }
}
