import { NextRequest, NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { prepareAppointmentCreatedNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";
import { Prisma, AppointmentStatus } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import {
  AppointmentConflictError,
  FitInNotAllowedError,
  FitInReasonRequiredError,
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
  ScheduleBlockConflictApptError,
} from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";
import { createFitInAppointmentWithScheduleLock } from "@/lib/appointments/create-fit-in-appointment";
import { validateProfessionalServiceCapability } from "@/lib/appointments/professional-service-capability";
import { isRetryableTransactionError } from "@/lib/transactions/is-retryable-transaction-error";
import { normalizePhone, resolveBarbershopCustomerForBooking } from "@/lib/customers";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";
import { todayIsoBR, nowBR } from "@/lib/time-utils";
import { isNormalizedTimeOffOverlapping, normalizeStoredTimeOffInterval } from "@/lib/schedule-blocks";
import { stripMetadataFromNotes, buildNotesWithMetadata } from "@/lib/appointments/notes-metadata";

interface AdminAppointmentBody {
  memberId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  serviceIds?: string[];
  services?: { serviceId: string; quantity: number }[];
  dateTime?: string;
  notes?: string;
  bookingMode?: "NORMAL" | "FIT_IN";
  fitInReason?: string;
}

function conflictResponse(error: AppointmentConflictError) {
  return NextResponse.json(
    { error: error.code, message: error.message },
    { status: error.status }
  );
}

function appointmentValidationResponse(
  error:
    | InvalidServiceSelectionError
    | ProfessionalNotAvailableError
    | ProfessionalServiceMismatchError
    | FitInReasonRequiredError
    | FitInNotAllowedError
) {
  return NextResponse.json(
    { error: error.code, message: error.message },
    { status: error.status }
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

  const [appointments, total, barbershop, scheduleBlocksRaw] = await Promise.all([
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
          select: {
            id: true,
            status: true,
            total: true,
            paidTotal: true,
            items: {
              select: {
                id: true,
                type: true,
                status: true,
                quantity: true,
                serviceId: true,
                productId: true,
              },
            },
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
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.appointment.count({ where }),
    prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { name: true, slug: true },
    }),
    prisma.timeOff?.findMany
      ? prisma.timeOff.findMany({
          where: {
            member: { barbershopId, isActive: true },
            startDate: { lt: endOfDay },
            endDate: { gte: startOfDay },
          },
          select: {
            id: true,
            memberId: true,
            startDate: true,
            endDate: true,
            reason: true,
            allDay: true,
          },
          orderBy: { startDate: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const scheduleBlocks = (scheduleBlocksRaw ?? []).filter((b) =>
    isNormalizedTimeOffOverlapping(b, { start: startOfDay, end: endOfDay })
  ).map((b) => {
    const normalized = normalizeStoredTimeOffInterval(b);
    return {
      id: normalized.id,
      memberId: normalized.memberId,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      reason: normalized.reason,
      allDay: normalized.allDay,
    };
  });

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
          startDate: { lt: endOfDay },
          endDate: { gte: startOfDay },
        },
      },
      services: { select: { serviceId: true } },
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
    const wh = member.workingHours[0];
    if (!wh) {
      members.push({
        id: member.id,
        user: { name: member.user.name },
        startTime: "",
        endTime: "",
        freeSlots: [],
        serviceIds: member.services?.map((s) => s.serviceId) ?? [],
      });
      continue;
    }

    const workStart = toMinutes(wh.startTime);
    const workEnd = toMinutes(wh.endTime);
    const breakStart = wh.breakStart ? toMinutes(wh.breakStart) : null;
    const breakEnd = wh.breakEnd ? toMinutes(wh.breakEnd) : null;

    // Get busy times for this member today (appointments + timeOffs)
    const appts = await prisma.appointment.findMany({
      where: {
        barbershopId,
        memberId: member.id,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    });

    const timeOffBusy = member.timeOffs.filter((storedTimeOff) =>
      isNormalizedTimeOffOverlapping(storedTimeOff, { start: startOfDay, end: endOfDay })
    ).map((storedTimeOff) => {
      const to = normalizeStoredTimeOffInterval(storedTimeOff);
      const toStart = new Date(to.startDate);
      const toEnd = new Date(to.endDate);

      const startMin = toStart.getTime() <= startOfDay.getTime()
        ? 0
        : toStart.getUTCHours() * 60 + toStart.getUTCMinutes();

      const endMin = toEnd.getTime() >= endOfDay.getTime()
        ? 1440
        : toEnd.getUTCHours() * 60 + toEnd.getUTCMinutes();

      return { start: startMin, end: endMin };
    });

    const busy = [
      ...appts.map((a) => {
        const dt = new Date(a.dateTime);
        const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
        return { start: startMin, end: startMin + a.durationMin };
      }),
      ...timeOffBusy,
    ];

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
      serviceIds: member.services?.map((s) => s.serviceId) ?? [],
    });
  }

  const cleanedAppointments = appointments.map((a) => ({
    ...a,
    notes: stripMetadataFromNotes(a.notes),
  }));

  return NextResponse.json({
    appointments: cleanedAppointments,
    scheduleBlocks,
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

  const {
    memberId,
    customerId,
    customerName,
    customerPhone,
    serviceIds,
    services: bodyServices,
    dateTime,
    notes,
    bookingMode,
    fitInReason,
  } = body;

  if (!memberId || (!serviceIds?.length && !bodyServices?.length) || !dateTime) {
    return NextResponse.json(
      { error: "memberId, serviceIds/services e dateTime sao obrigatorios." },
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

  if (bookingMode && bookingMode !== "NORMAL" && bookingMode !== "FIT_IN") {
    return NextResponse.json({ error: "bookingMode invalido." }, { status: 400 });
  }

  const requestedBookingMode = bookingMode === "FIT_IN" ? "FIT_IN" : "NORMAL";

  try {
    const result = await runSerializableTransaction(
      async (tx) => {
        if (requestedBookingMode === "FIT_IN" && !["OWNER", "MANAGER"].includes(data!.role)) {
          throw new FitInNotAllowedError();
        }

        const normalizedFitInReason = fitInReason?.trim() || null;

        let rawServices: { serviceId: string; quantity: number }[] = [];
        if (bodyServices && bodyServices.length > 0) {
          bodyServices.forEach((s) => {
            if (s.serviceId) {
              const qty = Number(s.quantity) || 1;
              rawServices.push({ serviceId: s.serviceId, quantity: Math.min(5, Math.max(1, qty)) });
            }
          });
        } else if (serviceIds && serviceIds.length > 0) {
          const uniqueIds = Array.from(new Set(serviceIds));
          rawServices = uniqueIds.map((id) => ({ serviceId: id, quantity: 1 }));
        }

        // Aggregate duplicate serviceIds, Cap at 5
        const serviceQtyMap = new Map<string, number>();
        rawServices.forEach((s) => {
          const existing = serviceQtyMap.get(s.serviceId) ?? 0;
          serviceQtyMap.set(s.serviceId, Math.min(5, existing + s.quantity));
        });

        const normalizedServices = Array.from(serviceQtyMap.entries()).map(([serviceId, quantity]) => ({
          serviceId,
          quantity,
        }));

        const targetServiceIds = normalizedServices.map((s) => s.serviceId);

        const { services } = await validateProfessionalServiceCapability(tx, {
          barbershopId,
          memberId,
          serviceIds: targetServiceIds,
        });

        // Apply quantities
        const qtyMap = new Map(normalizedServices.map(s => [s.serviceId, s.quantity]));
        services.forEach(s => {
          s.quantity = qtyMap.get(s.id) ?? 1;
        });

        let resolvedCustomerId: string;
        try {
          if (customerPhone && !customerId) {
            const canonicalPhone = normalizePhone(customerPhone);
            if (!validateBrazilianMobilePhone(canonicalPhone)) {
              return {
                error: NextResponse.json({ error: "Informe um WhatsApp válido com DDD." }, { status: 400 }),
              };
            }
          }

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

        const { totalPrice, durationMin } = calculateAppointmentTotals(services);

        const cleanUserNotes = stripMetadataFromNotes(notes);
        const activeQtyMap: Record<string, number> = {};
        normalizedServices.forEach((s) => {
          if (s.quantity > 1) {
            activeQtyMap[s.serviceId] = s.quantity;
          }
        });
        const updatedNotes = buildNotesWithMetadata(cleanUserNotes, activeQtyMap);

        if (requestedBookingMode === "FIT_IN") {
          const { appointment } = await createFitInAppointmentWithScheduleLock(tx, {
            barbershopId,
            memberId,
            customerId: resolvedCustomerId,
            dateTime: requestedDateTime,
            totalPrice,
            durationMin,
            services,
            notes: updatedNotes,
            fitInReason: normalizedFitInReason,
            fitInCreatedById: data!.userId,
          });

          return { appointment };
        }

        const appointment = await createAppointmentWithScheduleLock(tx, {
          barbershopId,
          memberId,
          customerId: resolvedCustomerId,
          dateTime: requestedDateTime,
          totalPrice,
          durationMin,
          services,
          notes: updatedNotes,
        });

        return { appointment };
      }
    );

    if ("error" in result && result.error) return result.error;

    if (result.appointment) {
      const prepared = await prepareAppointmentCreatedNotifications({
        appointment: result.appointment,
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

    return NextResponse.json(result.appointment, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return conflictResponse(error);
    }
    if (error instanceof ScheduleBlockConflictApptError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    if (
      error instanceof InvalidServiceSelectionError ||
      error instanceof ProfessionalNotAvailableError ||
      error instanceof ProfessionalServiceMismatchError ||
      error instanceof FitInReasonRequiredError ||
      error instanceof FitInNotAllowedError
    ) {
      return appointmentValidationResponse(error);
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
