import { NextRequest, NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { prepareAppointmentCreatedNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getTenantSubscription, isSubscriptionActive } from "@/lib/subscription-utils";
import { directPublicBarbershopWhere, sanitizeBarbershopSlug } from "@/lib/public-barbershops";
import {
  AppointmentConflictError,
  IdempotencyKeyInvalidError,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
  ScheduleBlockConflictApptError,
} from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";
import {
  PublicBookingUnavailableError,
  PublicSlotInvalidError,
  validatePublicBookingEligibility,
} from "@/lib/appointments/public-booking-eligibility";
import { stripMetadataFromNotes, buildNotesWithMetadata } from "@/lib/appointments/notes-metadata";
import {
  findBarbershopCustomerById,
  normalizePhone,
  resolveBarbershopCustomerForBooking,
} from "@/lib/customers";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";
import {
  buildWhatsappConfirmationLink,
  generateWhatsappConfirmationToken,
  getWhatsappConfirmationExpiresAt,
  getWhatsappConfirmationTokenHint,
  getValidWhatsappPhone,
  hashWhatsappConfirmationToken,
  WHATSAPP_CONFIRMATION_STATUS_PENDING,
} from "@/lib/appointments/whatsapp-confirmation";
import {
  getIdempotencyExpiresAt,
  getIdempotencyKeyFromRequest,
  hashPublicBookingPayload,
} from "@/lib/appointments/idempotency";
import { consumeRateLimit, resolveClientIp } from "@/lib/public-rate-limit";
import { isValidBrazilMobilePhone } from "@/lib/phone-utils";
import { isCustomerOrPhoneBlocked } from "@/lib/operations/blocked-customers";


interface SessionUser {
  id?: string;
  role?: string;
  phone?: string;
  authLevel?: string;
}

function isPublicClientAuthLevel(authLevel: string | undefined) {
  return (
    authLevel === "phone_lookup" ||
    authLevel === "verified_link" ||
    authLevel === "verified_otp"
  );
}

interface PublicBookingBody {
  memberId?: string;
  serviceIds?: string[];
  services?: { serviceId: string; quantity: number }[];
  dateTime?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  idempotencyKey?: string;
  bookingMode?: "NORMAL" | "FIT_IN";
}

function getUtcWeekRange(inputDate: Date) {
  const date = new Date(inputDate);
  const day = date.getUTCDay();
  const daysFromMonday = (day + 6) % 7;

  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday)
  );
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

  return { weekStart, weekEnd };
}

function jsonError(error: unknown) {
  if (
    error instanceof AppointmentConflictError ||
    error instanceof IdempotencyKeyReusedError ||
    error instanceof IdempotencyKeyRequiredError ||
    error instanceof IdempotencyKeyInvalidError ||
    error instanceof InvalidServiceSelectionError ||
    error instanceof ProfessionalNotAvailableError ||
    error instanceof ProfessionalServiceMismatchError ||
    error instanceof ScheduleBlockConflictApptError ||
    error instanceof PublicSlotInvalidError ||
    error instanceof PublicBookingUnavailableError
  ) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    );
  }

  throw error;
}

function isIdempotencyUniqueConstraintError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  const targetText = Array.isArray(target) ? target.join("_") : String(target ?? "");
  return targetText.includes("barbershop_id") && targetText.includes("key");
}

function isUserPhoneUniqueConstraint(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("phone") : String(target ?? "").includes("phone");
}

import { isRetryableTransactionError } from "@/lib/transactions/is-retryable-transaction-error";

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

function buildAppointmentPayload(
  appointment: Awaited<ReturnType<typeof createAppointmentWithScheduleLock>>,
  barbershop: { name: string },
  slug: string,
  whatsappConfirmation?: {
    token?: string;
    tokenHint: string;
    expiresAt: Date;
    message?: string;
    link?: string;
  }
) {
  return {
    appointment: {
      id: appointment.id,
      dateTime: appointment.dateTime.toISOString(),
      status: appointment.status,
      totalPrice: appointment.totalPrice.toString(),
      durationMin: appointment.durationMin,
      barberName: appointment.barber.user.name,
      customerName: appointment.customer.name,
      services: appointment.services.map((service) => service.service.name),
      barbershopName: barbershop.name,
      barbershopSlug: slug,
    },
    ...(whatsappConfirmation && {
      whatsappConfirmation: {
        status: WHATSAPP_CONFIRMATION_STATUS_PENDING,
        ...(whatsappConfirmation.token && { token: whatsappConfirmation.token }),
        tokenHint: whatsappConfirmation.tokenHint,
        expiresAt: whatsappConfirmation.expiresAt.toISOString(),
        ...(whatsappConfirmation.message && { message: whatsappConfirmation.message }),
        ...(whatsappConfirmation.link && { link: whatsappConfirmation.link }),
      },
    }),
  };
}

async function replayIdempotentResult(
  barbershopId: string,
  key: string,
  requestHash: string
) {
  const record = await prisma.idempotencyKey.findUnique({
    where: { barbershopId_key: { barbershopId, key } },
  });

  if (!record) return null;

  if (record.requestHash !== requestHash || record.expiresAt <= new Date()) {
    throw new IdempotencyKeyReusedError();
  }

  if (!record.result) return null;

  return NextResponse.json(record.result, {
    status: 200,
    headers: { "Idempotent-Replay": "true" },
  });
}

async function replayAfterConcurrentInsert(
  barbershopId: string,
  key: string,
  requestHash: string
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const replay = await replayIdempotentResult(barbershopId, key, requestHash);
    if (replay) return replay;
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }

  throw new AppointmentConflictError("A reserva ainda esta sendo processada. Tente novamente.");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body: PublicBookingBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const { memberId, serviceIds, services: bodyServices, dateTime, customerName, customerPhone, notes, bookingMode } = body;

  if (bookingMode === "FIT_IN") {
    return NextResponse.json(
      {
        error: "FIT_IN_NOT_ALLOWED",
        message: "Encaixe operacional so pode ser criado pela equipe administrativa.",
      },
      { status: 403 }
    );
  }

  const ip = resolveClientIp(request);

  let session: Record<string, unknown> | null = null;
  let isPublicClientSession = false;
  let sessionUserId: string | null = null;
  let sessionUserPhone: string | null = null;
  try {
    session = await getServerSession(authOptions);
    const sessionUser = session?.user as SessionUser | undefined;
    if (sessionUser && isPublicClientAuthLevel(sessionUser.authLevel)) {
      isPublicClientSession = true;
      sessionUserId = sessionUser.id ?? null;
      sessionUserPhone = sessionUser.phone ?? null;
    }
  } catch {
    session = null;
    isPublicClientSession = false;
    sessionUserId = null;
    sessionUserPhone = null;
  }

  const validSessionPhone =
    isPublicClientSession && sessionUserPhone && isValidBrazilMobilePhone(sessionUserPhone)
      ? sessionUserPhone
      : null;

  const effectiveCustomerPhone = validSessionPhone || customerPhone || "";

  const normalizedPhoneKey = normalizePhone(effectiveCustomerPhone);
  const rateLimit = consumeRateLimit({
    bucket: "public-booking",
    key: `${slug}:${ip}:${normalizedPhoneKey || "no-phone"}`,
    max: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas de agendamento. Tente novamente em instantes." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  if (!memberId || (!serviceIds?.length && !bodyServices?.length) || !dateTime) {
    return NextResponse.json(
      { error: "memberId, services e dateTime sao obrigatorios." },
      { status: 400 }
    );
  }

  const requestedDateTime = new Date(dateTime.endsWith("Z") ? dateTime : dateTime + "Z");
  if (Number.isNaN(requestedDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  const safeSlug = sanitizeBarbershopSlug(slug);
  if (!safeSlug) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 404 });
  }

  const barbershop = await prisma.barbershop.findFirst({
    where: directPublicBarbershopWhere(safeSlug)!,
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 404 });
  }

  // 1. Validação de telefone brasileiro para agendamento público
  if (!isValidBrazilMobilePhone(effectiveCustomerPhone)) {
    return NextResponse.json(
      { error: "INVALID_PHONE", message: "Informe um WhatsApp válido para concluir o agendamento." },
      { status: 400 }
    );
  }

  // 2. Checar bloqueio por barbearia ANTES de criar qualquer usuário ou agendamento
  const isBlocked = await isCustomerOrPhoneBlocked({
    barbershopId: barbershop.id,
    phone: effectiveCustomerPhone,
    userId: sessionUserId,
  });

  if (isBlocked) {
    return NextResponse.json(
      { error: "CUSTOMER_BLOCKED", message: "Não foi possível concluir o agendamento por este canal. Entre em contato com a barbearia." },
      { status: 403 }
    );
  }

  // Verificar status de assinatura do tenant
  const subscription = await getTenantSubscription(barbershop.id);
  if (!isSubscriptionActive(subscription)) {
    return NextResponse.json(
      { error: "SUBSCRIPTION_SUSPENDED", message: "Esta barbearia está temporariamente indisponível para agendamentos." },
      { status: 403 }
    );
  }

  const barbershopWhatsappPhone = getValidWhatsappPhone(barbershop.phone);
  if (!barbershopWhatsappPhone) {
    return NextResponse.json(
      {
        error: "BARBERSHOP_WHATSAPP_NOT_CONFIGURED",
        message: "Esta barbearia ainda nao possui WhatsApp valido para confirmar agendamentos online.",
      },
      { status: 422 }
    );
  }

  let idempotencyKey: string;
  let requestHash: string;
  try {
    idempotencyKey = getIdempotencyKeyFromRequest(request, body);
    requestHash = hashPublicBookingPayload({
      memberId: memberId || "",
      serviceIds: serviceIds || [],
      services: bodyServices,
      dateTime: dateTime || "",
      customerName,
      customerPhone: effectiveCustomerPhone,
      notes,
    });
  } catch (error) {
    return jsonError(error);
  }

  try {
    const replay = await replayIdempotentResult(barbershop.id, idempotencyKey, requestHash);
    if (replay) return replay;
  } catch (error) {
    return jsonError(error);
  }

  try {
    const transactionResult = await runSerializableTransaction(
      async (tx) => {
        const existingKey = await tx.idempotencyKey.findUnique({
          where: { barbershopId_key: { barbershopId: barbershop.id, key: idempotencyKey } },
        });

      if (existingKey) {
        if (existingKey.requestHash !== requestHash || existingKey.expiresAt <= new Date()) {
          throw new IdempotencyKeyReusedError();
        }
        if (existingKey.result) {
          return { replay: true, result: existingKey.result };
        }
      } else {
        await tx.idempotencyKey.create({
          data: {
            barbershopId: barbershop.id,
            key: idempotencyKey,
            requestHash,
            expiresAt: getIdempotencyExpiresAt(),
          },
        });
      }

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

      const { services } = await validatePublicBookingEligibility(tx, {
        barbershopId: barbershop.id,
        memberId,
        serviceIds: targetServiceIds,
        dateTime: requestedDateTime,
        quantities: serviceQtyMap,
      });

      const { totalPrice, durationMin } = calculateAppointmentTotals(services);

      let customerId: string | undefined;
      if (isPublicClientSession && sessionUserId) {
        const scopedCustomer = await findBarbershopCustomerById(
          tx,
          barbershop.id,
          sessionUserId
        );
        customerId = scopedCustomer?.id ?? sessionUserId;
      } else {
        if (!effectiveCustomerPhone) {
          return {
            error: NextResponse.json(
              { error: "Informe seu telefone para confirmar o agendamento." },
              { status: 400 }
            ),
          };
        }

        const cleanPhone = normalizePhone(effectiveCustomerPhone);
        if (!validateBrazilianMobilePhone(cleanPhone)) {
          return {
            error: NextResponse.json({ error: "Informe um WhatsApp válido com DDD." }, { status: 400 }),
          };
        }

        const customer = await resolveBarbershopCustomerForBooking(tx, {
          barbershopId: barbershop.id,
          customerName,
          customerPhone: cleanPhone,
        });
        customerId = customer.id;
      }

      if (!customerId) {
        return {
          error: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }),
        };
      }

      const duplicateAtSameDateTime = await tx.appointment.findFirst({
        where: {
          barbershopId: barbershop.id,
          customerId,
          dateTime: requestedDateTime,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        select: { id: true },
      });

      if (duplicateAtSameDateTime) {
        return {
          error: NextResponse.json(
            {
              error: "DUPLICATE_APPOINTMENT",
              message: "Voce ja possui um agendamento neste mesmo horario para esta barbearia.",
            },
            { status: 422 }
          ),
        };
      }

      const { weekStart, weekEnd } = getUtcWeekRange(requestedDateTime);
      const activeFutureBookingsInWeek = await tx.appointment.count({
        where: {
          barbershopId: barbershop.id,
          customerId,
          dateTime: {
            gte: weekStart > new Date() ? weekStart : new Date(),
            lt: weekEnd,
          },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      });

      if (activeFutureBookingsInWeek >= 2) {
        return {
          error: NextResponse.json(
            {
              error: "WEEKLY_BOOKING_LIMIT_REACHED",
              message:
                "Você já possui o limite de agendamentos futuros nesta semana. Fale com a barbearia para ajustar.",
            },
            { status: 422 }
          ),
        };
      }

      const cleanUserNotes = stripMetadataFromNotes(notes);
      const activeQtyMap: Record<string, number> = {};
      normalizedServices.forEach((s) => {
        if (s.quantity > 1) {
          activeQtyMap[s.serviceId] = s.quantity;
        }
      });
      const updatedNotes = buildNotesWithMetadata(cleanUserNotes, activeQtyMap);

      const appointment = await createAppointmentWithScheduleLock(tx, {
        barbershopId: barbershop.id,
        memberId,
        customerId,
        dateTime: requestedDateTime,
        totalPrice,
        durationMin,
        services,
        notes: updatedNotes,
      });

      // Upsert vínculo do cliente com a barbearia
      let isWhatsappVerified = false;

      if (tx.customerBarbershopLink) {
        let link = await tx.customerBarbershopLink.findUnique({
          where: {
            barbershopId_customerId: {
              barbershopId: barbershop.id,
              customerId,
            },
          },
        });

        if (!link) {
          link = await tx.customerBarbershopLink.create({
            data: {
              barbershopId: barbershop.id,
              customerId,
            },
          });
        }

        isWhatsappVerified = Boolean(link.whatsappVerifiedAt);

        if (!isWhatsappVerified) {
          const legacyConfirmed = await tx.appointmentWhatsappConfirmation.findFirst({
            where: {
              barbershopId: barbershop.id,
              appointment: { customerId },
              status: "CONFIRMED",
            },
          });

          if (legacyConfirmed) {
            link = await tx.customerBarbershopLink.update({
              where: { id: link.id },
              data: {
                whatsappVerifiedAt: legacyConfirmed.confirmedAt || new Date(),
                whatsappVerifiedById: legacyConfirmed.confirmedById,
                whatsappVerificationMethod: legacyConfirmed.confirmationMethod,
              },
            });
            isWhatsappVerified = true;
          }
        }
      }

      let whatsappConfirmationInfo:
        | {
            token?: string;
            tokenHint: string;
            expiresAt: Date;
            message?: string;
            link?: string;
          }
        | undefined = undefined;

      if (!isWhatsappVerified) {
        const token = generateWhatsappConfirmationToken();
        const tokenHint = getWhatsappConfirmationTokenHint(token);
        const expiresAt = getWhatsappConfirmationExpiresAt();
        const whatsapp = buildWhatsappConfirmationLink({
          barbershopPhone: barbershopWhatsappPhone,
          barbershopName: barbershop.name,
          customerName: appointment.customer.name,
          services: appointment.services.map((service) => service.service.name),
          dateTime: appointment.dateTime,
          token,
        });

        if (!whatsapp) {
          return {
            error: NextResponse.json(
              {
                error: "BARBERSHOP_WHATSAPP_NOT_CONFIGURED",
                message: "Esta barbearia ainda nao possui WhatsApp valido para confirmar agendamentos online.",
              },
              { status: 422 }
            ),
          };
        }

        await tx.appointmentWhatsappConfirmation.create({
          data: {
            barbershopId: barbershop.id,
            appointmentId: appointment.id,
            customerPhone: normalizePhone(appointment.customer.phone),
            status: WHATSAPP_CONFIRMATION_STATUS_PENDING,
            tokenHash: hashWhatsappConfirmationToken(token),
            tokenHint,
            expiresAt,
          },
        });

        whatsappConfirmationInfo = {
          token,
          tokenHint,
          expiresAt,
          message: whatsapp.message,
          link: whatsapp.link,
        };
      }

      const result = buildAppointmentPayload(
        appointment,
        barbershop,
        slug,
        whatsappConfirmationInfo
      );
      const idempotencyResult = buildAppointmentPayload(
        appointment,
        barbershop,
        slug,
        whatsappConfirmationInfo
          ? {
              tokenHint: whatsappConfirmationInfo.tokenHint,
              expiresAt: whatsappConfirmationInfo.expiresAt,
            }
          : undefined
      );
      await tx.idempotencyKey.update({
        where: { barbershopId_key: { barbershopId: barbershop.id, key: idempotencyKey } },
        data: { result: idempotencyResult },
      });

      return { replay: false, result, appointment };
      }
    );

    if ("error" in transactionResult && transactionResult.error) {
      return transactionResult.error;
    }

    if (!transactionResult.replay && transactionResult.appointment) {
      const prepared = await prepareAppointmentCreatedNotifications({
        appointment: transactionResult.appointment,
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

    return NextResponse.json(transactionResult.result, {
      status: transactionResult.replay ? 200 : 201,
      headers: transactionResult.replay ? { "Idempotent-Replay": "true" } : undefined,
    });
  } catch (error) {
    if (isIdempotencyUniqueConstraintError(error)) {
      return replayAfterConcurrentInsert(barbershop.id, idempotencyKey, requestHash);
    }
    if (isUserPhoneUniqueConstraint(error)) {
      return NextResponse.json(
        { error: "Telefone ja cadastrado fora desta barbearia. Nao foi criado cliente duplicado." },
        { status: 409 }
      );
    }
    return jsonError(error);
  }
}
