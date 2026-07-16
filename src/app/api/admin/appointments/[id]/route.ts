import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import {
  AppointmentConflictError,
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
} from "@/lib/appointments/errors";
import {
  calculateAppointmentTotals,
  mapAppointmentServiceSnapshots,
} from "@/lib/appointments/calculate-appointment";
import { rescheduleAppointmentWithScheduleLock } from "@/lib/appointments/reschedule-appointment";
import { validateProfessionalServiceCapability } from "@/lib/appointments/professional-service-capability";

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
      services: { include: { service: { select: { id: true, name: true, durationMin: true } } } },
      comandas: { select: { id: true, status: true, total: true, paidTotal: true } },
      whatsappConfirmation: {
        select: {
          status: true,
          tokenHint: true,
          expiresAt: true,
          confirmedAt: true,
          confirmedById: true,
        },
      },
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
    include: { services: { select: { serviceId: true } } },
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

  let totalPrice = Number(existing.totalPrice);
  let durationMin = existing.durationMin;

  const targetMemberId = memberId ?? existing.memberId;
  const targetServiceIds =
    serviceIds && serviceIds.length > 0
      ? serviceIds
      : existing.services.map((service) => service.serviceId);
  const targetDateTime = dateTime
    ? new Date(dateTime.endsWith("Z") ? dateTime : dateTime + "Z")
    : existing.dateTime;

  if (Number.isNaN(targetDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  let updated;
  try {
    updated = await prisma.$transaction(
      async (tx) => {
        let serviceCreateData: { serviceId: string; priceApplied: string | number }[] | undefined;

        if (memberId || (serviceIds && serviceIds.length > 0)) {
          const { services } = await validateProfessionalServiceCapability(tx, {
            barbershopId,
            memberId: targetMemberId,
            serviceIds: targetServiceIds,
          });

          if (serviceIds && serviceIds.length > 0) {
            const totals = calculateAppointmentTotals(services);
            totalPrice = totals.totalPrice;
            durationMin = totals.durationMin;
            serviceCreateData = mapAppointmentServiceSnapshots(services);
          }
        }

        return rescheduleAppointmentWithScheduleLock(tx, {
          id,
          barbershopId,
          memberId: targetMemberId,
          dateTime: targetDateTime,
          notes,
          totalPrice,
          durationMin,
          serviceCreateData,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    if (
      error instanceof InvalidServiceSelectionError ||
      error instanceof ProfessionalNotAvailableError ||
      error instanceof ProfessionalServiceMismatchError
    ) {
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

  // Cancelar comanda junto se for status terminal (CANCELLED ou NO_SHOW)
  if (status && ["CANCELLED", "NO_SHOW"].includes(status)) {
    const existingComanda = await prisma.comanda.findFirst({
      where: { appointmentId: id, barbershopId: barbershopIdPatch, status: { not: "CANCELLED" } },
      include: {
        payments: { where: { status: "CONFIRMED" } },
        items: {
          include: {
            stockMovements: true,
            commissionEntry: true,
          },
        },
      },
    });

    if (existingComanda) {
      if (existingComanda.status !== "OPEN") {
        return NextResponse.json(
          { error: `Não é possível marcar como ${status === "NO_SHOW" ? "Falta" : "Cancelado"} pois a comanda associada já avançou (status: ${existingComanda.status}).` },
          { status: 422 }
        );
      }

      const hasPayments = existingComanda.payments.length > 0;
      const hasFinancial = await prisma.financialEntry.count({ where: { comandaId: existingComanda.id } }) > 0;
      const hasStock = existingComanda.items.some(i => i.stockMovements.length > 0);
      const hasCommissions = existingComanda.items.some(i => i.commissionEntry !== null);

      if (hasPayments || hasFinancial || hasStock || hasCommissions) {
        return NextResponse.json(
          { error: "A comanda possui efeitos financeiros, comissões ou estoque baixado. Realize o cancelamento da comanda manualmente (com estorno, se aplicável)." },
          { status: 422 }
        );
      }

      const updatedTransaction = await prisma.$transaction(async (tx) => {
        await tx.comanda.update({
          where: { id: existingComanda.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });

        return tx.appointment.update({
          where: { id },
          data: {
            status: status as ValidStatus,
            ...(notes !== undefined && { notes }),
          },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
            services: { include: { service: { select: { id: true, name: true, durationMin: true } } } },
            comandas: { select: { id: true, status: true, total: true, paidTotal: true } },
            whatsappConfirmation: {
              select: {
                status: true,
                tokenHint: true,
                expiresAt: true,
                confirmedAt: true,
                confirmedById: true,
              },
            },
          },
        });
      });

      return NextResponse.json(updatedTransaction);
    }
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
      services: { include: { service: { select: { id: true, name: true, durationMin: true } } } },
      comandas: { select: { id: true, status: true, total: true, paidTotal: true } },
      whatsappConfirmation: {
        select: {
          status: true,
          tokenHint: true,
          expiresAt: true,
          confirmedAt: true,
          confirmedById: true,
        },
      },
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
