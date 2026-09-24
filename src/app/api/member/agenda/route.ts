import { NextRequest, NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import { Prisma } from "@prisma/client";
import { stripMetadataFromNotes, buildNotesWithMetadata } from "@/lib/appointments/notes-metadata";
import { deriveOperationalState } from "@/lib/operations/member-checkout";
import { toCents } from "@/lib/operations/money";
import { localDateToUTCBoundary, shiftDateISO, todayIsoBR } from "@/lib/time-utils";
import {
  AppointmentConflictError,
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
  ScheduleBlockConflictApptError,
} from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";
import { validateProfessionalServiceCapability } from "@/lib/appointments/professional-service-capability";
import { normalizePhone, resolveBarbershopCustomerForBooking } from "@/lib/customers";
import { prepareAppointmentCreatedNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";
import { checkMemberPermission } from "@/lib/permissions/engine";
import {
  MemberTemporalAvailabilityError,
  validateMemberTemporalAvailability,
} from "@/lib/agenda/working-hours-validation";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const dateStr = request.nextUrl.searchParams.get("date");

  let targetDate: Date;
  let targetDateStr: string;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    targetDateStr = dateStr;
    const [y, m, d] = dateStr.split("-").map(Number);
    targetDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  } else {
    const now = new Date();
    targetDateStr = todayIsoBR();
    targetDate = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    );
  }

  const startOfDay = new Date(targetDate);
  const endOfDay = new Date(targetDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const productionStart = localDateToUTCBoundary(targetDateStr);
  const productionEnd = localDateToUTCBoundary(shiftDateISO(targetDateStr, 1));

  // Buscar dados do membro atual (horários, serviços)
  const currentMember = await prisma.barbershopMember.findUnique({
    where: { id: data!.memberId },
    include: {
      user: { select: { name: true, avatarUrl: true } },
      barbershop: { select: { id: true, name: true, slug: true } },
      workingHours: {
        where: { dayOfWeek: targetDate.getUTCDay(), isActive: true },
      },
      services: {
        select: {
          serviceId: true,
          service: {
            select: {
              id: true,
              name: true,
              durationMin: true,
              price: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: data!.barbershopId,
      memberId: data!.memberId,
      dateTime: { gte: startOfDay, lte: endOfDay },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barbershop: { select: { id: true, name: true, slug: true } },
      barber: {
        select: {
          id: true,
          user: { select: { name: true, avatarUrl: true } },
        },
      },
      services: {
        include: {
          service: { select: { id: true, name: true, durationMin: true, price: true } },
        },
      },
      comandas: {
        select: {
          id: true,
          status: true,
          total: true,
          paidTotal: true,
          items: { select: { id: true, type: true, status: true, quantity: true, completedAt: true, total: true, executorId: true } },
        },
      },
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
    orderBy: { dateTime: "asc" },
  });

  const cleaned = appointments.map((a) => {
    const comanda = a.comandas?.[0];
    const hasOwnPendingService = comanda?.items?.some(
      (item) => item.executorId === data!.memberId && item.status === "PENDING"
    );
    const hasOwnCompletedService = comanda?.items?.some(
      (item) => item.executorId === data!.memberId && item.status === "DONE"
    );
    const productionItems =
      comanda?.items?.filter(
        (item) =>
          item.type === "SERVICE" &&
          item.status === "DONE" &&
          item.executorId === data!.memberId &&
          item.completedAt &&
          item.completedAt >= productionStart &&
          item.completedAt < productionEnd
      ) ?? [];

    const productionValue =
      productionItems.reduce((sum, item) => sum + toCents(item.total), 0) / 100;

    const operationalState = deriveOperationalState(
      a as unknown as Parameters<typeof deriveOperationalState>[0],
      comanda ? (comanda as unknown as Parameters<typeof deriveOperationalState>[1]) : undefined,
      hasOwnPendingService || false,
      hasOwnCompletedService || false
    );

    const whatsappConfirmation = a.whatsappConfirmation ?? null;

    return {
      id: a.id,
      dateTime: a.dateTime.toISOString(),
      totalPrice: a.totalPrice.toString(),
      durationMin: a.durationMin,
      status: a.status,
      bookingMode: a.bookingMode,
      fitInReason: a.fitInReason,
      notes: stripMetadataFromNotes(a.notes),
      customer: a.customer,
      barber: a.barber,
      services: a.services.map((s) => ({
        serviceId: s.serviceId,
        service: {
          id: s.service.id,
          name: s.service.name,
          durationMin: s.service.durationMin,
          price: s.service.price.toString(),
        },
        priceApplied: s.priceApplied.toString(),
      })),
      comandas: a.comandas?.map((c) => ({
        id: c.id,
        status: c.status,
        total: c.total.toString(),
        paidTotal: c.paidTotal.toString(),
        items: c.items.map((i) => ({
          id: i.id,
          type: i.type,
          status: i.status,
          quantity: i.quantity.toString(),
        })),
      })),
      whatsappConfirmation,
      operationalState,
      productionValue,
    };
  });

  return NextResponse.json({
    appointments: cleaned,
    member: currentMember
      ? {
          id: currentMember.id,
          user: currentMember.user,
          workingHours: currentMember.workingHours,
          serviceIds: currentMember.services.map((s) => s.serviceId),
        }
      : null,
    barbershopName: currentMember?.barbershop?.name || "Tem Barber",
    barbershopSlug: currentMember?.barbershop?.slug || "",
    services: (currentMember?.services ?? [])
      .map((s) => s.service)
      .filter((s) => s && s.isActive)
      .map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        price: s.price.toString(),
      })),
  });
}

export async function POST(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  // Verificar permissão para criar agendamento na própria agenda
  const canCreate = await checkMemberPermission(data!.memberId, data!.role, "AGENDA_CREATE_OWN");
  if (!canCreate) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", message: "Você não possui permissão para criar agendamentos." },
      { status: 403 }
    );
  }

  let body: {
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    serviceIds?: string[];
    services?: { serviceId?: string; quantity?: number }[];
    dateTime?: string;
    bookingMode?: string;
    memberId?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const {
    customerId,
    customerName,
    customerPhone,
    serviceIds,
    services: bodyServices,
    dateTime,
    bookingMode,
    memberId: bodyMemberId,
    notes,
  } = body;

  if (bodyMemberId && bodyMemberId !== data!.memberId) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Não é permitido criar agendamentos para outro profissional." },
      { status: 403 }
    );
  }

  if (bookingMode === "FIT_IN") {
    return NextResponse.json(
      { error: "FIT_IN_NOT_ALLOWED", message: "Somente administradores podem criar encaixes." },
      { status: 403 }
    );
  }

  // Regra P0: O barbeiro SEMPRE agenda estritamente na própria agenda.
  const memberId = data!.memberId;

  if ((!serviceIds?.length && !bodyServices?.length) || !dateTime) {
    return NextResponse.json(
      { error: "serviceIds/services e dateTime são obrigatórios." },
      { status: 400 }
    );
  }

  const apptDate = new Date(typeof dateTime === "string" && !dateTime.endsWith("Z") ? dateTime + "Z" : dateTime);
  if (isNaN(apptDate.getTime())) {
    return NextResponse.json({ error: "Data/hora inválida." }, { status: 400 });
  }

  // Obter serviços selecionados
  let rawServicesList: { serviceId: string; quantity: number }[] = [];
  if (Array.isArray(bodyServices) && bodyServices.length > 0) {
    bodyServices.forEach((s) => {
      if (s.serviceId) {
        const qty = Number(s.quantity) || 1;
        rawServicesList.push({ serviceId: s.serviceId, quantity: Math.min(5, Math.max(1, qty)) });
      }
    });
  } else if (Array.isArray(serviceIds) && serviceIds.length > 0) {
    const uniqueIds = Array.from(new Set(serviceIds)) as string[];
    rawServicesList = uniqueIds.map((id) => ({ serviceId: id, quantity: 1 }));
  }

  // Aggregate duplicate serviceIds, Cap at 5
  const serviceQtyMap = new Map<string, number>();
  rawServicesList.forEach((s) => {
    const existing = serviceQtyMap.get(s.serviceId) ?? 0;
    serviceQtyMap.set(s.serviceId, Math.min(5, existing + s.quantity));
  });

  const normalizedServices = Array.from(serviceQtyMap.entries()).map(([serviceId, quantity]) => ({
    serviceId,
    quantity,
  }));

  const targetServiceIds = normalizedServices.map((s) => s.serviceId);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const { services } = await validateProfessionalServiceCapability(tx, {
          barbershopId: data!.barbershopId,
          memberId,
          serviceIds: targetServiceIds,
        });

        // Apply quantities
        const qtyMap = new Map(normalizedServices.map((s) => [s.serviceId, s.quantity]));
        services.forEach((s) => {
          (s as { quantity?: number }).quantity = qtyMap.get(s.id) ?? 1;
        });

        let resolvedCustomerId: string;
        try {
          const customer = await resolveBarbershopCustomerForBooking(tx, {
            barbershopId: data!.barbershopId,
            customerId,
            customerName,
            customerPhone: customerPhone ? normalizePhone(customerPhone) : undefined,
          });
          resolvedCustomerId = customer.id;
        } catch (resolveError) {
          if (resolveError instanceof Error && resolveError.message === "CUSTOMER_NOT_FOUND_IN_BARBERSHOP") {
            return {
              error: NextResponse.json({ error: "Cliente não encontrado nesta barbearia." }, { status: 404 }),
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

        const { totalPrice, durationMin } = calculateAppointmentTotals(services);

        await validateMemberTemporalAvailability(tx, {
          barbershopId: data!.barbershopId,
          memberId,
          dateTime: apptDate,
          durationMin,
        });

        const cleanUserNotes = stripMetadataFromNotes(notes || "");
        const activeQtyMap: Record<string, number> = {};
        normalizedServices.forEach((s) => {
          if (s.quantity > 1) {
            activeQtyMap[s.serviceId] = s.quantity;
          }
        });
        const updatedNotes = buildNotesWithMetadata(cleanUserNotes, activeQtyMap);

        const appointment = await createAppointmentWithScheduleLock(tx, {
          barbershopId: data!.barbershopId,
          memberId,
          customerId: resolvedCustomerId,
          dateTime: apptDate,
          totalPrice,
          durationMin,
          services,
          notes: updatedNotes,
        });

        return { appointment };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if ("error" in result && result.error) {
      return result.error;
    }

    const appointment = (result as { appointment: Parameters<typeof prepareAppointmentCreatedNotifications>[0]["appointment"] }).appointment;

    const preparedNotifications = await prepareAppointmentCreatedNotifications({
      appointment,
      actorUserId: data!.userId,
    });

    if (preparedNotifications.created.length > 0) {
      after(async () => {
        try {
          await deliverCreatedNotifications(preparedNotifications.created);
        } catch {
          // Silent delivery failure
        }
      });
    }

    return NextResponse.json(appointment, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof MemberTemporalAvailabilityError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    if (err instanceof AppointmentConflictError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 409 });
    }
    if (
      err instanceof InvalidServiceSelectionError ||
      err instanceof ProfessionalNotAvailableError ||
      err instanceof ProfessionalServiceMismatchError ||
      err instanceof ScheduleBlockConflictApptError
    ) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error("Erro ao criar agendamento na agenda do profissional:", err);
    return NextResponse.json({ error: "Erro ao criar agendamento." }, { status: 500 });
  }
}
