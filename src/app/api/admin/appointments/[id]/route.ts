import { NextRequest, NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { prepareAppointmentCancelledByStaffNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";
import { Prisma } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import {
  AppointmentConflictError,
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
  ScheduleBlockConflictApptError,
} from "@/lib/appointments/errors";
import {
  calculateAppointmentTotals,
  mapAppointmentServiceSnapshots,
} from "@/lib/appointments/calculate-appointment";
import { rescheduleAppointmentWithScheduleLock } from "@/lib/appointments/reschedule-appointment";
import { validateProfessionalServiceCapability } from "@/lib/appointments/professional-service-capability";
import { lockAppointmentSchedule } from "@/lib/appointments/appointment-lock";
import {
  extractServiceQuantities,
  stripMetadataFromNotes,
  buildNotesWithMetadata,
} from "@/lib/appointments/notes-metadata";

const VALID_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];
const HARD_DELETE_ALLOWED_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED"] as const;

class AppointmentDeleteError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
    this.name = "AppointmentDeleteError";
  }
}

class ExecutorCorrectionRequiredError extends Error {
  readonly code = "EXECUTOR_CORRECTION_REQUIRED";
  readonly status = 409;
  constructor(message = "Alteração de executor exige operação versionada de correção de executor.") {
    super(message);
    this.name = "ExecutorCorrectionRequiredError";
  }
}

function hasNonZeroDecimal(value: unknown) {
  return Number(value ?? 0) !== 0;
}

function isCleanDeletableComanda(comanda: {
  status: string;
  paidTotal: unknown;
  startedAt?: Date | null;
  closedAt?: Date | null;
  payments: unknown[];
  items: Array<{
    status: string;
    completedAt?: Date | null;
    stockMovements: unknown[];
    commissionEntry?: unknown | null;
    commissionEntries?: unknown[];
    clubBenefitUsage: unknown | null;
    clubPointEntry: unknown | null;
  }>;
}) {
  if (!["OPEN", "CANCELLED"].includes(comanda.status)) return false;
  if (comanda.startedAt || comanda.closedAt || hasNonZeroDecimal(comanda.paidTotal)) return false;
  if (comanda.payments.length > 0) return false;

  return comanda.items.every((item) => (
    item.status !== "DONE" &&
    !item.completedAt &&
    item.stockMovements.length === 0 &&
    (item.commissionEntry === null || item.commissionEntry === undefined) &&
    (!item.commissionEntries || item.commissionEntries.length === 0) &&
    item.clubBenefitUsage === null &&
    item.clubPointEntry === null
  ));
}

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
          confirmationMethod: true,
          manualConfirmationReason: true,
        },
      },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  const cleaned = {
    ...appointment,
    notes: stripMetadataFromNotes(appointment.notes),
  };

  return NextResponse.json(cleaned);
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
    services?: { serviceId: string; quantity: number }[];
    dateTime?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { memberId, serviceIds, services: bodyServices, dateTime, notes } = body;

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

  let rawServices: { serviceId: string; quantity: number }[] = [];
  let isServiceListModified = false;

  if (bodyServices && bodyServices.length > 0) {
    isServiceListModified = true;
    bodyServices.forEach((s) => {
      if (s.serviceId) {
        const qty = Number(s.quantity) || 1;
        rawServices.push({ serviceId: s.serviceId, quantity: Math.min(5, Math.max(1, qty)) });
      }
    });
  } else if (serviceIds && serviceIds.length > 0) {
    isServiceListModified = true;
    const uniqueIds = Array.from(new Set(serviceIds));
    rawServices = uniqueIds.map((id) => ({ serviceId: id, quantity: 1 }));
  }

  // Aggregate duplicate serviceIds, Cap at 5
  const serviceQtyMap = new Map<string, number>();
  rawServices.forEach((s) => {
    const existingQty = serviceQtyMap.get(s.serviceId) ?? 0;
    serviceQtyMap.set(s.serviceId, Math.min(5, existingQty + s.quantity));
  });

  const normalizedServices = Array.from(serviceQtyMap.entries()).map(([serviceId, quantity]) => ({
    serviceId,
    quantity,
  }));

  const targetMemberId = memberId ?? existing.memberId;
  const targetServiceIds = isServiceListModified
    ? normalizedServices.map((s) => s.serviceId)
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

        if (memberId && memberId !== existing.memberId) {
          const linkedItemWithCommission = await tx.comandaItem.findFirst({
            where: {
              comanda: { appointmentId: id, barbershopId },
              commissionEntries: { some: { isCurrent: true } },
            },
          });
          if (linkedItemWithCommission) {
            throw new ExecutorCorrectionRequiredError(
              "Não é possível alterar o profissional do agendamento pois já existem comissões geradas para a comanda vinculada. Utilize a correção versionada de executor."
            );
          }
        }

        if (memberId || isServiceListModified) {
          const { services } = await validateProfessionalServiceCapability(tx, {
            barbershopId,
            memberId: targetMemberId,
            serviceIds: targetServiceIds,
          });

          // Apply quantities
          if (isServiceListModified) {
            const qtyMap = new Map(normalizedServices.map(s => [s.serviceId, s.quantity]));
            services.forEach(s => {
              s.quantity = qtyMap.get(s.id) ?? 1;
            });
            const totals = calculateAppointmentTotals(services);
            totalPrice = totals.totalPrice;
            durationMin = totals.durationMin;
            serviceCreateData = mapAppointmentServiceSnapshots(services);
          } else {
            // If service list did not change, keep current quantities from existing notes metadata
            const currentQtyMap = extractServiceQuantities(existing.notes);
            services.forEach(s => {
              s.quantity = currentQtyMap[s.id] ?? 1;
            });
            const totals = calculateAppointmentTotals(services);
            totalPrice = totals.totalPrice;
            durationMin = totals.durationMin;
          }
        }

        // Clean user notes and merge metadata
        const inputNotes = notes !== undefined ? notes : stripMetadataFromNotes(existing.notes);
        const cleanUserNotes = stripMetadataFromNotes(inputNotes);

        let finalQtyMap: Record<string, number> = {};
        if (isServiceListModified) {
          normalizedServices.forEach((s) => {
            if (s.quantity > 1) {
              finalQtyMap[s.serviceId] = s.quantity;
            }
          });
        } else {
          finalQtyMap = extractServiceQuantities(existing.notes);
        }

        const updatedNotes = buildNotesWithMetadata(cleanUserNotes, finalQtyMap);

        return rescheduleAppointmentWithScheduleLock(tx, {
          id,
          barbershopId,
          memberId: targetMemberId,
          dateTime: targetDateTime,
          notes: updatedNotes !== null ? updatedNotes : undefined,
          totalPrice,
          durationMin,
          serviceCreateData,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof ExecutorCorrectionRequiredError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    if (error instanceof AppointmentConflictError || error instanceof ScheduleBlockConflictApptError) {
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
            commissionEntries: true,
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
      const hasCommissions = existingComanda.items.some(i => i.commissionEntries.length > 0);

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
                confirmationMethod: true,
                manualConfirmationReason: true,
              },
            },
          },
        });
      });

      if (updatedTransaction.status === "CANCELLED") {
        const prepared = await prepareAppointmentCancelledByStaffNotifications({
          appointment: updatedTransaction,
          previousStatus: existing.status,
          actorUserId: data!.userId,
        });

        if (prepared.created.length > 0) {
          after(async () => {
            try {
              await deliverCreatedNotifications(prepared.created);
            } catch {
              // Contained failure
            }
          });
        }
      }

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
          confirmationMethod: true,
          manualConfirmationReason: true,
        },
      },
    },
  });

  if (updated.status === "CANCELLED") {
    const prepared = await prepareAppointmentCancelledByStaffNotifications({
      appointment: updated,
      previousStatus: existing.status,
      actorUserId: data!.userId,
    });

    if (prepared.created.length > 0) {
      after(async () => {
        try {
          await deliverCreatedNotifications(prepared.created);
        } catch {
          // Contained failure
        }
      });
    }
  }

  return NextResponse.json(updated);
}

// DELETE /api/admin/appointments/[id] — hard delete for PENDING/CONFIRMED/CANCELLED without financial/operational effects
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
  const barbershopId = data!.barbershopId;

  // Apenas perfis administrativos com tenant operacional podem excluir agendamentos.
  if (!["OWNER", "MANAGER", "SUPER_ADMIN"].includes(data!.role)) {
    return NextResponse.json(
      { error: "Apenas proprietários e gerentes podem excluir agendamentos." },
      { status: 403 }
    );
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} AND barbershop_id = ${barbershopId} FOR UPDATE`;

        const appointment = await tx.appointment.findFirst({
          where: { id, barbershopId },
          select: { id: true, status: true, memberId: true },
        });

        if (!appointment) {
          throw new AppointmentDeleteError("Agendamento nao encontrado.", 404);
        }

        await lockAppointmentSchedule(tx, barbershopId, appointment.memberId);

        if (!HARD_DELETE_ALLOWED_STATUSES.includes(appointment.status as typeof HARD_DELETE_ALLOWED_STATUSES[number])) {
          throw new AppointmentDeleteError("Este agendamento nao pode ser excluido no estado atual.");
        }

        await tx.$queryRaw`SELECT id FROM comandas WHERE appointment_id = ${id} AND barbershop_id = ${barbershopId} FOR UPDATE`;

        const waitlistEntry = await tx.onlineWaitlistEntry.findFirst({
          where: { fitInAppointmentId: id, barbershopId },
          select: { id: true },
        });

        if (waitlistEntry) {
          throw new AppointmentDeleteError("Este agendamento foi criado pela fila online. Faca a reversao pela fila antes de exclui-lo.");
        }

        const review = await tx.review.findFirst({
          where: { appointmentId: id },
          select: { id: true },
        });

        if (review) {
          throw new AppointmentDeleteError("Este agendamento possui avaliacao vinculada e nao pode ser excluido.");
        }

        const comandas = await tx.comanda.findMany({
          where: { appointmentId: id, barbershopId },
          include: {
            payments: true,
            items: {
              include: {
                stockMovements: true,
                commissionEntries: true,
                clubBenefitUsage: true,
                clubPointEntry: true,
              },
            },
          },
        });

        const comandaIds = comandas.map((comanda) => comanda.id);
        const financialEntries = comandaIds.length > 0
          ? await tx.financialEntry.count({
              where: { barbershopId, comandaId: { in: comandaIds } },
            })
          : 0;

        const hasBlockedComanda = comandas.some((comanda) => !isCleanDeletableComanda(comanda));
        if (hasBlockedComanda || financialEntries > 0) {
          throw new AppointmentDeleteError(
            "Este agendamento possui atendimento ou movimentacoes vinculadas e nao pode ser excluido. Cancele ou estorne a comanda antes de continuar."
          );
        }

        for (const comanda of comandas) {
          await tx.comanda.delete({ where: { id: comanda.id } });
        }
        await tx.appointment.delete({ where: { id: appointment.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AppointmentDeleteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
