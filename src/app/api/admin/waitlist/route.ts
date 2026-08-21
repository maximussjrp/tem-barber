import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canManageWaitlist } from "@/lib/waitlist/permissions";
import { getWaitlistPublicUrl } from "@/lib/public-url";

interface EntryWithMemberRelations {
  preferredMember?: { user?: { name?: string | null } | null } | null;
  calledByMember?: { user?: { name?: string | null } | null } | null;
}

function maskPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return "****";
  return `****-${digits.slice(-4)}`;
}

function getPreferredMemberName(entry: EntryWithMemberRelations) {
  return entry.preferredMember?.user?.name ?? null;
}

function getCalledByMemberName(entry: EntryWithMemberRelations) {
  return entry.calledByMember?.user?.name ?? null;
}

// GET /api/admin/waitlist - get current active or recent waitlist session with summary
export async function GET(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const { barbershopId, role } = auth.data;

  if (!canManageWaitlist(role) && role !== "BARBER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const barbershop = await prisma.barbershop.findFirst({
    where: { id: barbershopId },
    select: { id: true, name: true, slug: true },
  });

  const teamMembers = await prisma.barbershopMember.findMany({
    where: { barbershopId, isActive: true },
    select: { id: true, user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const members = teamMembers.map((m) => ({
    id: m.id,
    name: m.user.name || "Profissional",
  }));
  const currentMemberId = role === "BARBER"
    ? teamMembers.find((member) => member.user.id === auth.data.userId)?.id ?? null
    : null;

  const session = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId },
    orderBy: [
      { status: "asc" },
      { createdAt: "desc" },
    ],
    include: {
      entries: {
        orderBy: [
          { positionWeight: "asc" },
          { createdAt: "asc" },
        ],
        include: {
          service: { select: { id: true, name: true, durationMin: true, price: true } },
          preferredMember: { include: { user: { select: { id: true, name: true } } } },
          calledByMember: { include: { user: { select: { id: true, name: true } } } },
          customer: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!session) {
    return NextResponse.json({
      barbershop,
      publicUrl: barbershop ? getWaitlistPublicUrl(barbershop.slug, request) : null,
      members,
      currentMemberId,
      session: null,
      summary: {
        total: 0,
        waiting: 0,
        called: 0,
        inService: 0,
        completed: 0,
        canceled: 0,
        expired: 0,
      },
    });
  }

  let waitingPosition = 0;
  const entries = session.entries.map((entry) => {
    const currentPosition = entry.status === "WAITING" ? ++waitingPosition : null;

    return {
      id: entry.id,
      sessionId: entry.sessionId,
      barbershopId: entry.barbershopId,
      customerId: entry.customerId,
      customerName: entry.customerName,
      maskedPhone: maskPhone(entry.customerPhone),
      serviceId: entry.serviceId,
      serviceName: entry.service?.name ?? null,
      preferredMemberId: entry.preferredMemberId,
      preferredMemberName: getPreferredMemberName(entry),
      calledByMemberId: entry.calledByMemberId,
      calledByMemberName: getCalledByMemberName(entry),
      queueNumber: entry.queueNumber,
      currentPosition,
      status: entry.status,
      skipCount: entry.skipCount,
      noShowCount: entry.noShowCount,
      calledAt: entry.calledAt,
      canceledAt: entry.canceledAt,
      completedAt: entry.completedAt,
      joinedAt: entry.createdAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });

  const summary = {
    total: entries.length,
    waiting: entries.filter((e) => e.status === "WAITING").length,
    called: entries.filter((e) => e.status === "CALLED" || e.status === "FIT_IN_CREATED").length,
    inService: entries.filter((e) => e.status === "IN_SERVICE").length,
    completed: entries.filter((e) => e.status === "COMPLETED").length,
    canceled: entries.filter((e) => e.status.startsWith("CANCELED") || e.status === "NO_SHOW").length,
    expired: entries.filter((e) => e.status === "EXPIRED").length,
  };

  const sanitizedSession = {
    id: session.id,
    barbershopId: session.barbershopId,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    title: session.title,
    notes: session.notes,
    defaultLockBeforeAppointmentMinutes: session.defaultLockBeforeAppointmentMinutes,
    createdById: session.createdById,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    entries,
  };

  return NextResponse.json({
    barbershop,
    publicUrl: barbershop ? getWaitlistPublicUrl(barbershop.slug, request) : null,
    members,
    currentMemberId,
    session: sanitizedSession,
    summary,
  });
}
