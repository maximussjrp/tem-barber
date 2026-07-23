import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canManageWaitlist } from "@/lib/waitlist/permissions";

// POST /api/admin/waitlist/open — open a new waitlist session for tenant
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
    // Body is optional
  }

  const existingOpenSession = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId, status: "OPEN" },
  });

  if (existingOpenSession) {
    return NextResponse.json(
      { error: "ALREADY_OPEN", message: "Já existe uma fila aberta para esta barbearia." },
      { status: 409 }
    );
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
