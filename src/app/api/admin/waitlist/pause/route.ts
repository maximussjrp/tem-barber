import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canManageWaitlist } from "@/lib/waitlist/permissions";

// POST /api/admin/waitlist/pause — pause active OPEN waitlist session
export async function POST(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const { barbershopId, role } = auth.data;

  if (!canManageWaitlist(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const session = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId, status: "OPEN" },
  });

  if (!session) {
    return NextResponse.json(
      { error: "NO_OPEN_SESSION", message: "Nenhuma fila aberta encontrada para pausar." },
      { status: 404 }
    );
  }

  const updatedSession = await prisma.onlineWaitlistSession.update({
    where: { id: session.id },
    data: { status: "PAUSED" },
  });

  return NextResponse.json({ session: updatedSession });
}
