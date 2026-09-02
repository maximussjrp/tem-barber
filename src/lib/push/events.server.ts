import "server-only";

import prisma from "@/lib/prisma";
import { Notification, Prisma } from "@prisma/client";

export interface EventPreparationResult {
  created: Notification[];
  duplicateCount: number;
  failureCount: number;
}

/**
 * Extracts and sanitizes the first name from a customer name string.
 * Strips control characters, trims whitespace, and returns the first token.
 * Returns null if the result is empty or invalid.
 */
export function getSafeFirstName(rawName?: string | null): string | null {
  if (!rawName || typeof rawName !== "string") return null;

  // Strip control characters (ASCII 0-31 and 127) and normalize whitespace
  const sanitized = rawName.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (!sanitized) return null;

  const firstToken = sanitized.split(/\s+/)[0]?.trim();
  if (!firstToken || firstToken.length === 0) return null;

  // Enforce reasonable single-token length bound (max 40 chars for a first name)
  return firstToken.slice(0, 40);
}

function isPrismaP2002Error(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

interface CreateNotificationInput {
  userId: string;
  barbershopId: string | null;
  eventKey: string;
  title: string;
  content: string;
  type: string;
  target: string;
}

/**
 * Attempts to create a single Notification row idempotently.
 * Handles P2002 eventKey constraint by re-reading the existing notification.
 */
async function createNotificationIdempotently(
  input: CreateNotificationInput
): Promise<{ status: "CREATED"; notification: Notification } | { status: "DUPLICATE" } | { status: "FAILED" }> {
  // Truncate title and content safely to guarantee schema/SW bounds
  const title = input.title.trim().slice(0, 80);
  const content = input.content.trim().slice(0, 180);

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        barbershopId: input.barbershopId,
        eventKey: input.eventKey,
        title,
        content,
        type: input.type,
        target: input.target,
      },
    });
    return { status: "CREATED", notification };
  } catch (err: unknown) {
    if (isPrismaP2002Error(err)) {
      try {
        const existing = await prisma.notification.findUnique({
          where: { eventKey: input.eventKey },
        });
        if (existing) {
          return { status: "DUPLICATE" };
        }
      } catch {
        // Fall through to FAILED if re-read fails
      }
    }
    return { status: "FAILED" };
  }
}

/**
 * APPOINTMENT_CREATED: Only emitted for NORMAL appointments (never FIT_IN).
 */
export async function prepareAppointmentCreatedNotifications(params: {
  appointment: {
    id: string;
    barbershopId: string;
    memberId: string;
    bookingMode?: string | null;
    customer?: { name?: string | null } | null;
  };
  actorUserId?: string | null;
}): Promise<EventPreparationResult> {
  const { appointment, actorUserId } = params;

  if (appointment.bookingMode !== "NORMAL") {
    return { created: [], duplicateCount: 0, failureCount: 0 };
  }

  try {
    const activeMembers = await prisma.barbershopMember.findMany({
      where: {
        barbershopId: appointment.barbershopId,
        isActive: true,
        OR: [
          { id: appointment.memberId },
          { role: { in: ["OWNER", "MANAGER"] } },
        ],
      },
      select: { userId: true },
    });

    const recipientUserIds = Array.from(
      new Set(activeMembers.map((m) => m.userId))
    ).filter((uid) => (actorUserId ? uid !== actorUserId : true));

    if (recipientUserIds.length === 0) {
      return { created: [], duplicateCount: 0, failureCount: 0 };
    }

    const firstName = getSafeFirstName(appointment.customer?.name);
    const title = "Novo agendamento";
    const content = firstName
      ? `${firstName} fez um novo agendamento. Confira sua agenda.`
      : "Novo agendamento recebido. Confira sua agenda.";
    const target = "MEMBER_AGENDA";
    const type = "APPOINTMENT_CREATED";

    const created: Notification[] = [];
    let duplicateCount = 0;
    let failureCount = 0;

    for (const userId of recipientUserIds) {
      const eventKey = `APPOINTMENT_CREATED:${appointment.id}:${userId}`;
      const outcome = await createNotificationIdempotently({
        userId,
        barbershopId: appointment.barbershopId,
        eventKey,
        title,
        content,
        type,
        target,
      });

      if (outcome.status === "CREATED") {
        created.push(outcome.notification);
      } else if (outcome.status === "DUPLICATE") {
        duplicateCount++;
      } else {
        failureCount++;
      }
    }

    return { created, duplicateCount, failureCount };
  } catch {
    return { created: [], duplicateCount: 0, failureCount: 1 };
  }
}

/**
 * APPOINTMENT_CANCELLED_BY_CUSTOMER: Emitted when customer cancels an appointment.
 */
export async function prepareAppointmentCancelledByCustomerNotifications(params: {
  appointment: {
    id: string;
    barbershopId: string;
    memberId: string;
    status: string;
    updatedAt: Date;
    customer?: { name?: string | null } | null;
  };
  previousStatus: string;
  actorUserId?: string | null;
}): Promise<EventPreparationResult> {
  const { appointment, previousStatus, actorUserId } = params;

  if (previousStatus === "CANCELLED" || appointment.status !== "CANCELLED") {
    return { created: [], duplicateCount: 0, failureCount: 0 };
  }

  try {
    const activeMembers = await prisma.barbershopMember.findMany({
      where: {
        barbershopId: appointment.barbershopId,
        isActive: true,
        OR: [
          { id: appointment.memberId },
          { role: { in: ["OWNER", "MANAGER"] } },
        ],
      },
      select: { userId: true },
    });

    const recipientUserIds = Array.from(
      new Set(activeMembers.map((m) => m.userId))
    ).filter((uid) => (actorUserId ? uid !== actorUserId : true));

    if (recipientUserIds.length === 0) {
      return { created: [], duplicateCount: 0, failureCount: 0 };
    }

    const firstName = getSafeFirstName(appointment.customer?.name);
    const title = "Agendamento cancelado";
    const content = firstName
      ? `${firstName} cancelou um agendamento. Confira sua agenda.`
      : "Um agendamento foi cancelado pelo cliente. Confira sua agenda.";
    const target = "MEMBER_AGENDA";
    const type = "APPOINTMENT_CANCELLED_BY_CUSTOMER";
    const updatedAtIso = new Date(appointment.updatedAt).toISOString();

    const created: Notification[] = [];
    let duplicateCount = 0;
    let failureCount = 0;

    for (const userId of recipientUserIds) {
      const eventKey = `APPOINTMENT_CANCELLED_BY_CUSTOMER:${appointment.id}:${updatedAtIso}:${userId}`;
      const outcome = await createNotificationIdempotently({
        userId,
        barbershopId: appointment.barbershopId,
        eventKey,
        title,
        content,
        type,
        target,
      });

      if (outcome.status === "CREATED") {
        created.push(outcome.notification);
      } else if (outcome.status === "DUPLICATE") {
        duplicateCount++;
      } else {
        failureCount++;
      }
    }

    return { created, duplicateCount, failureCount };
  } catch {
    return { created: [], duplicateCount: 0, failureCount: 1 };
  }
}

/**
 * APPOINTMENT_CANCELLED_BY_STAFF: Emitted when staff cancels an appointment.
 */
export async function prepareAppointmentCancelledByStaffNotifications(params: {
  appointment: {
    id: string;
    barbershopId: string;
    customerId?: string | null;
    status: string;
    updatedAt: Date;
  };
  previousStatus: string;
  actorUserId?: string | null;
}): Promise<EventPreparationResult> {
  const { appointment, previousStatus, actorUserId } = params;

  if (
    previousStatus === "CANCELLED" ||
    appointment.status !== "CANCELLED" ||
    !appointment.customerId
  ) {
    return { created: [], duplicateCount: 0, failureCount: 0 };
  }

  if (actorUserId && appointment.customerId === actorUserId) {
    return { created: [], duplicateCount: 0, failureCount: 0 };
  }

  try {
    const userId = appointment.customerId;
    const title = "Agendamento cancelado";
    const content =
      "Seu agendamento foi cancelado. Consulte sua conta para conferir os detalhes.";
    const target = "CLIENT_APPOINTMENTS";
    const type = "APPOINTMENT_CANCELLED_BY_STAFF";
    const updatedAtIso = new Date(appointment.updatedAt).toISOString();
    const eventKey = `APPOINTMENT_CANCELLED_BY_STAFF:${appointment.id}:${updatedAtIso}:${userId}`;

    const outcome = await createNotificationIdempotently({
      userId,
      barbershopId: appointment.barbershopId,
      eventKey,
      title,
      content,
      type,
      target,
    });

    if (outcome.status === "CREATED") {
      return { created: [outcome.notification], duplicateCount: 0, failureCount: 0 };
    }
    if (outcome.status === "DUPLICATE") {
      return { created: [], duplicateCount: 1, failureCount: 0 };
    }
    return { created: [], duplicateCount: 0, failureCount: 1 };
  } catch {
    return { created: [], duplicateCount: 0, failureCount: 1 };
  }
}

/**
 * WAITLIST_CALLED: Emitted when a waitlist entry transitions to CALLED.
 */
export async function prepareWaitlistCalledNotifications(params: {
  entry: {
    id: string;
    barbershopId: string;
    customerId?: string | null;
    status: string;
    calledAt?: Date | null;
  };
}): Promise<EventPreparationResult> {
  const { entry } = params;

  if (entry.status !== "CALLED" || !entry.customerId || !entry.calledAt) {
    return { created: [], duplicateCount: 0, failureCount: 0 };
  }

  try {
    const userId = entry.customerId;
    const title = "É a sua vez";
    const content = "Você foi chamado para atendimento.";
    const target = "WAITLIST";
    const type = "WAITLIST_CALLED";
    const calledAtIso = new Date(entry.calledAt).toISOString();
    const eventKey = `WAITLIST_CALLED:${entry.id}:${calledAtIso}:${userId}`;

    const outcome = await createNotificationIdempotently({
      userId,
      barbershopId: entry.barbershopId,
      eventKey,
      title,
      content,
      type,
      target,
    });

    if (outcome.status === "CREATED") {
      return { created: [outcome.notification], duplicateCount: 0, failureCount: 0 };
    }
    if (outcome.status === "DUPLICATE") {
      return { created: [], duplicateCount: 1, failureCount: 0 };
    }
    return { created: [], duplicateCount: 0, failureCount: 1 };
  } catch {
    return { created: [], duplicateCount: 0, failureCount: 1 };
  }
}
