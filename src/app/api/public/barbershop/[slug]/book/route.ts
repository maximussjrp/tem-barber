import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import {
  AppointmentConflictError,
  IdempotencyKeyInvalidError,
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
} from "@/lib/appointments/errors";
import { calculateAppointmentTotals } from "@/lib/appointments/calculate-appointment";
import { createAppointmentWithScheduleLock } from "@/lib/appointments/create-appointment";
import {
  findBarbershopCustomerById,
  normalizePhone,
  resolveBarbershopCustomerForBooking,
} from "@/lib/customers";
import {
  getIdempotencyExpiresAt,
  getIdempotencyKeyFromRequest,
  hashPublicBookingPayload,
} from "@/lib/appointments/idempotency";

interface SessionUser {
  id?: string;
}

interface PublicBookingBody {
  memberId?: string;
  serviceIds?: string[];
  dateTime?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  idempotencyKey?: string;
}

function jsonError(error: unknown) {
  if (
    error instanceof AppointmentConflictError ||
    error instanceof IdempotencyKeyReusedError ||
    error instanceof IdempotencyKeyRequiredError ||
    error instanceof IdempotencyKeyInvalidError
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

function buildAppointmentPayload(
  appointment: Awaited<ReturnType<typeof createAppointmentWithScheduleLock>>,
  barbershop: { name: string },
  slug: string
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

  const { memberId, serviceIds, dateTime, customerName, customerPhone, notes } = body;

  if (!memberId || !serviceIds?.length || !dateTime) {
    return NextResponse.json(
      { error: "memberId, serviceIds e dateTime sao obrigatorios." },
      { status: 400 }
    );
  }

  const requestedDateTime = new Date(dateTime);
  if (Number.isNaN(requestedDateTime.getTime())) {
    return NextResponse.json({ error: "dateTime invalido." }, { status: 400 });
  }

  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 404 });
  }

  let idempotencyKey: string;
  let requestHash: string;
  try {
    idempotencyKey = getIdempotencyKeyFromRequest(request, body);
    requestHash = hashPublicBookingPayload({
      memberId,
      serviceIds,
      dateTime,
      customerName,
      customerPhone,
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

  const session = await getServerSession(authOptions);

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

      const member = await tx.barbershopMember.findFirst({
        where: { id: memberId, barbershopId: barbershop.id, isActive: true },
      });
      if (!member) {
        return {
          error: NextResponse.json({ error: "Barbeiro nao disponivel." }, { status: 404 }),
        };
      }

      const services = await tx.service.findMany({
        where: { id: { in: serviceIds }, barbershopId: barbershop.id, isActive: true },
      });
      if (services.length !== serviceIds.length) {
        return {
          error: NextResponse.json({ error: "Um ou mais servicos invalidos." }, { status: 400 }),
        };
      }

      const { totalPrice, durationMin } = calculateAppointmentTotals(services);

      let customerId: string | undefined;
      if (session?.user) {
        const sessionCustomerId = (session.user as SessionUser).id;
        if (sessionCustomerId) {
          const scopedCustomer = await findBarbershopCustomerById(
            tx,
            barbershop.id,
            sessionCustomerId
          );
          customerId = scopedCustomer?.id ?? sessionCustomerId;
        }
      } else {
        if (!customerPhone) {
          return {
            error: NextResponse.json(
              { error: "Informe seu telefone para confirmar o agendamento." },
              { status: 400 }
            ),
          };
        }

        const cleanPhone = normalizePhone(customerPhone);
        if (cleanPhone.length < 10) {
          return {
            error: NextResponse.json({ error: "Telefone invalido." }, { status: 400 }),
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

      const appointment = await createAppointmentWithScheduleLock(tx, {
        barbershopId: barbershop.id,
        memberId,
        customerId,
        dateTime: requestedDateTime,
        totalPrice,
        durationMin,
        services,
        notes: notes?.trim() || null,
      });

      const result = buildAppointmentPayload(appointment, barbershop, slug);
      await tx.idempotencyKey.update({
        where: { barbershopId_key: { barbershopId: barbershop.id, key: idempotencyKey } },
        data: { result },
      });

        return { replay: false, result };
      }
    );

    if ("error" in transactionResult && transactionResult.error) {
      return transactionResult.error;
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
