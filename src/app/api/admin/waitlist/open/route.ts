import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canManageWaitlist } from "@/lib/waitlist/permissions";

// POST /api/admin/waitlist/open - open or resume a waitlist session for tenant
export async function POST(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const { barbershopId, userId, role } = auth.data;

  if (!canManageWaitlist(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: { title?: string; notes?: string; defaultLockBeforeAppointmentMinutes?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional.
  }

  const existingActiveSession = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId, status: { in: ["OPEN", "PAUSED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existingActiveSession?.status === "OPEN") {
    return NextResponse.json(
      { error: "ALREADY_OPEN", message: "Já existe uma fila aberta para esta barbearia." },
      { status: 409 }
    );
  }

  if (existingActiveSession?.status === "PAUSED") {
    const session = await prisma.onlineWaitlistSession.update({
      where: { id: existingActiveSession.id },
      data: {
        status: "OPEN",
        closedAt: null,
        title: body.title?.trim() || existingActiveSession.title,
        notes: body.notes?.trim() || existingActiveSession.notes,
        defaultLockBeforeAppointmentMinutes:
          body.defaultLockBeforeAppointmentMinutes ?? existingActiveSession.defaultLockBeforeAppointmentMinutes,
      },
    });

    return NextResponse.json({ session }, { status: 200 });
  }

  const session = await prisma.onlineWaitlistSession.create({
    data: {
      barbershopId,
      status: "OPEN",
      title: body.title?.trim() || null,
      notes: body.notes?.trim() || null,
      defaultLockBeforeAppointmentMinutes: body.defaultLockBeforeAppointmentMinutes ?? 20,
      createdById: userId,
    },
  });

  return NextResponse.json({ session }, { status: 201 });
}
