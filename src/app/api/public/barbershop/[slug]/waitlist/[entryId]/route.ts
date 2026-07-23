import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyWaitlistPublicToken } from "@/lib/waitlist/token";
import { calculateEntryPosition } from "@/lib/waitlist/positions";
import { sanitizeWaitlistPublicTrackingResponse } from "@/lib/waitlist/serializers";

interface Params {
  params: Promise<{ slug: string; entryId: string }>;
}

// GET /api/public/barbershop/[slug]/waitlist/[entryId] — track entry status using token
export async function GET(request: NextRequest, { params }: Params) {
  const { slug, entryId } = await params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "MISSING_TOKEN", message: "Token de acesso é obrigatório." }, { status: 401 });
  }

  const entry = await prisma.onlineWaitlistEntry.findFirst({
    where: {
      id: entryId,
      barbershop: { slug },
    },
    include: {
      service: { select: { id: true, name: true, durationMin: true, price: true } },
      preferredMember: { include: { user: { select: { id: true, name: true } } } },
      calledByMember: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "ENTRY_NOT_FOUND", message: "Registro da fila não encontrado." }, { status: 404 });
  }

  if (!verifyWaitlistPublicToken(token, entry.publicTokenHash)) {
    return NextResponse.json({ error: "INVALID_TOKEN", message: "Token de acesso inválido para esta entrada." }, { status: 403 });
  }

  const currentPosition = entry.status === "WAITING"
    ? await calculateEntryPosition(prisma, entry.sessionId, entry.positionWeight, entry.createdAt)
    : 0;

  const trackingData = sanitizeWaitlistPublicTrackingResponse(entry, currentPosition);

  return NextResponse.json({ entry: trackingData });
}
