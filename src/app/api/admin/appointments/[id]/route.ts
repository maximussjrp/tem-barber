import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import { AppointmentConflictError } from "@/lib/appointments/errors";
import {
  calculateAppointmentTotals,
  mapAppointmentServiceSnapshots,
} from "@/lib/appointments/calculate-appointment";
import { rescheduleAppointmentWithScheduleLock } from "@/lib/appointments/reschedule-appointment";

const VALID_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

// GET /api/admin/appointments/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;

  const appointment = await prisma.appointment.findFirst({
    where: { id, barbershopId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: { include: { service: { select: { name: true, durationMin: true } } } },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  return NextResponse.json(appointment);
}

// PUT /api/admin/appointments/[id] — full edit (reschedule, change barber/services)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopId = data!.barbershopId;

  let body: {
    memberId?: string;
    serviceIds?: string[];
    dateTime?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { memberId, serviceIds, dateTime, notes } = body;

  const existing = await prisma.appointment.findFirst({
    where: { id, barbershopId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Não é possível editar agendamentos finalizados." },
      { status: 422 }
    );
  }

  // Validate new member if provided
  if (memberId) {
    const member = await prisma.barbershopMember.findFirst({
      where: { id: memberId, barbershopId, isActive: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Barbeiro não encontrado." }, { status: 404 });
    }
  }

  let totalPrice = Number(existing.totalPrice);
  let durationMin = existing.durationMin;
  let serviceCreateData: { serviceId: string; priceApplied: string | number }[] | undefined;

  if (serviceIds && serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, barbershopId, isActive: true },
    });
    if (services.length !== serviceIds.length) {
      return NextResponse.json(
        { error: "Um ou mais serviços inválidos." },
        { status: 400 }
      );
    }
    const totals = calculateAppointmentTotals(services);
    totalPrice = totals.totalPrice;
    durationMin = totals.durationMin;
    serviceCreateData = mapAppointmentServiceSnapshots(services);
  }

  const targetMemberId = memberId ?? existing.memberId;
  const targetDateTime = dateTime ? new Date(dateTime) : existing.dateTime;

  if (Number.isNaN(targetDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  let updated;
  try {
    updated = await prisma.$transaction(
      (tx) =>
        rescheduleAppointmentWithScheduleLock(tx, {
          id,
          barbershopId,
          memberId: targetMemberId,
          dateTime: targetDateTime,
          notes,
          totalPrice,
          durationMin,
          serviceCreateData,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    throw error;
  }

  return NextResponse.json(updated);
}

// PATCH /api/admin/appointments/[id] — update status or cancel with reason
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }
  const barbershopIdPatch = data!.barbershopId;

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { status, notes } = body;

  if (status && !VALID_STATUSES.includes(status as ValidStatus)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const existing = await prisma.appointment.findFirst({
    where: { id, barbershopId: barbershopIdPatch },
  });

  if (!existing) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      ...(status && { status: status as ValidStatus }),
      ...(notes !== undefined && { notes }),
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: { include: { service: { select: { name: true, durationMin: true } } } },
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/admin/appointments/[id] — hard delete only if PENDING/CANCELLED
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const existingDel = await prisma.appointment.findFirst({
    where: { id, barbershopId: data!.barbershopId },
  });

  if (!existingDel) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  if (!["PENDING", "CANCELLED"].includes(existingDel.status)) {
    return NextResponse.json(
      { error: "Só é possível excluir agendamentos pendentes ou cancelados." },
      { status: 422 }
    );
  }

  await prisma.appointment.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
