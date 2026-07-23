import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canViewWaitlist } from "@/lib/waitlist/permissions";
import { sanitizeWaitlistEntryResponse } from "@/lib/waitlist/serializers";

// GET /api/admin/waitlist — get current active or recent waitlist session with summary
export async function GET(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const { barbershopId, role } = auth.data;

  if (!canViewWaitlist(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const session = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId },
    orderBy: [
      { status: "asc" }, // OPEN, PAUSED come before CLOSED
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
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!session) {
    return NextResponse.json({
      session: null,
      summary: {
        total: 0,
        waiting: 0,
        called: 0,
        completed: 0,
        canceled: 0,
      },
    });
  }

  const entries = session.entries.map((e) => sanitizeWaitlistEntryResponse(e));

  const summary = {
    total: entries.length,
    waiting: entries.filter((e) => e?.status === "WAITING").length,
    called: entries.filter((e) => e?.status === "CALLED" || e?.status === "FIT_IN_CREATED").length,
    completed: entries.filter((e) => e?.status === "COMPLETED" || e?.status === "IN_SERVICE").length,
    canceled: entries.filter((e) => e?.status?.startsWith("CANCELED") || e?.status === "EXPIRED" || e?.status === "NO_SHOW").length,
  };

  const sanitizedSession = {
    ...session,
    entries,
  };

  return NextResponse.json({ session: sanitizedSession, summary });
}
