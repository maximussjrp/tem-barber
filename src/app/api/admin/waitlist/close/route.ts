import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { canManageWaitlist } from "@/lib/waitlist/permissions";

// POST /api/admin/waitlist/close — close active waitlist session and expire pending entries
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
    where: {
      barbershopId,
      status: { in: ["OPEN", "PAUSED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    return NextResponse.json(
      { error: "NO_ACTIVE_SESSION", message: "Nenhuma fila ativa encontrada para fechar." },
      { status: 404 }
    );
  }

  const now = new Date();

  const [updatedSession] = await prisma.$transaction([
    prisma.onlineWaitlistSession.update({
      where: { id: session.id },
      data: { status: "CLOSED", closedAt: now },
    }),
    prisma.onlineWaitlistEntry.updateMany({
      where: {
        sessionId: session.id,
        status: { in: ["WAITING", "CALLED"] },
      },
      data: { status: "EXPIRED" },
    }),
  ]);

  return NextResponse.json({ session: updatedSession });
}
