import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getMemberSession } from "@/lib/member-api-auth";
import { checkMemberPermission } from "@/lib/permissions/engine";
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
import {
  MemberTemporalAvailabilityError,
  validateMemberTemporalAvailability,
} from "@/lib/agenda/working-hours-validation";
import {
  extractServiceQuantities,
  stripMetadataFromNotes,
  buildNotesWithMetadata,
} from "@/lib/appointments/notes-metadata";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const canEdit = await checkMemberPermission(data!.memberId, data!.role, "AGENDA_EDIT_OWN");
  if (!canEdit) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", message: "Você não possui permissão para editar agendamentos." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const barbershopId = data!.barbershopId;
  const memberId = data!.memberId;

  let body: {
    memberId?: string;
    serviceIds?: string[];
    services?: { serviceId?: string; quantity?: number }[];
    dateTime?: string;
    bookingMode?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const {
    memberId: bodyMemberId,
    serviceIds,
    services: bodyServices,
    dateTime,
    bookingMode,
    notes,
  } = body;

  if (bodyMemberId && bodyMemberId !== memberId) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Não é permitido transferir agendamento para outro profissional." },
      { status: 403 }
    );
  }

  if (bookingMode === "FIT_IN") {
    return NextResponse.json(
      { error: "FIT_IN_NOT_ALLOWED", message: "Encaixes não são permitidos na agenda do profissional." },
      { status: 403 }
    );
  }

  const existing = await prisma.appointment.findFirst({
    where: { id, barbershopId, memberId },
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
    const uniqueIds = Array.from(new Set(serviceIds)) as string[];
    rawServices = uniqueIds.map((sid) => ({ serviceId: sid, quantity: 1 }));
  }

  const serviceQtyMap = new Map<string, number>();
  rawServices.forEach((s) => {
    const existingQty = serviceQtyMap.get(s.serviceId) ?? 0;
    serviceQtyMap.set(s.serviceId, Math.min(5, existingQty + s.quantity));
  });

  const normalizedServices = Array.from(serviceQtyMap.entries()).map(([serviceId, quantity]) => ({
    serviceId,
    quantity,
  }));

  const targetServiceIds = isServiceListModified
    ? normalizedServices.map((s) => s.serviceId)
    : existing.services.map((service) => service.serviceId);

  const targetDateTime = dateTime
    ? new Date(typeof dateTime === "string" && !dateTime.endsWith("Z") ? dateTime + "Z" : dateTime)
    : existing.dateTime;

  if (Number.isNaN(targetDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime inválido." }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        let serviceCreateData: { serviceId: string; priceApplied: string | number }[] | undefined;

        const { services } = await validateProfessionalServiceCapability(tx, {
          barbershopId,
          memberId,
          serviceIds: targetServiceIds,
        });

        if (isServiceListModified) {
          const qtyMap = new Map(normalizedServices.map((s) => [s.serviceId, s.quantity]));
          services.forEach((s) => {
            s.quantity = qtyMap.get(s.id) ?? 1;
          });
          const totals = calculateAppointmentTotals(services);
          totalPrice = totals.totalPrice;
          durationMin = totals.durationMin;
          serviceCreateData = mapAppointmentServiceSnapshots(services);
        } else {
          const currentQtyMap = extractServiceQuantities(existing.notes);
          services.forEach((s) => {
            s.quantity = currentQtyMap[s.id] ?? 1;
          });
          const totals = calculateAppointmentTotals(services);
          totalPrice = totals.totalPrice;
          durationMin = totals.durationMin;
        }

        await validateMemberTemporalAvailability(tx, {
          barbershopId,
          memberId,
          dateTime: targetDateTime,
          durationMin,
          excludeAppointmentId: id,
        });

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
          memberId,
          dateTime: targetDateTime,
          notes: updatedNotes !== null ? updatedNotes : undefined,
          totalPrice,
          durationMin,
          serviceCreateData,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof MemberTemporalAvailabilityError) {
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
    console.error("Erro ao atualizar agendamento do membro:", error);
    return NextResponse.json({ error: "Erro ao atualizar agendamento." }, { status: 500 });
  }
}
