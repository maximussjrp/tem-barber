import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyWaitlistPublicToken } from "@/lib/waitlist/token";

interface Params {
  params: Promise<{ slug: string; entryId: string }>;
}

// POST /api/public/barbershop/[slug]/waitlist/[entryId]/leave — leave waitlist
export async function POST(request: NextRequest, { params }: Params) {
  const { slug, entryId } = await params;
  const { searchParams } = new URL(request.url);

  let body: { token?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional if query param is present
  }

  const token = body.token || searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "MISSING_TOKEN", message: "Token de acesso é obrigatório." }, { status: 401 });
  }

  const entry = await prisma.onlineWaitlistEntry.findFirst({
    where: {
      id: entryId,
      barbershop: { slug },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "ENTRY_NOT_FOUND", message: "Registro da fila não encontrado." }, { status: 404 });
  }

  if (!verifyWaitlistPublicToken(token, entry.publicTokenHash)) {
    return NextResponse.json({ error: "INVALID_TOKEN", message: "Token de acesso inválido." }, { status: 403 });
  }

  if (entry.status !== "WAITING" && entry.status !== "CALLED") {
    return NextResponse.json(
      { error: "CANNOT_LEAVE", message: "Apenas agendamentos aguardando ou chamados podem ser cancelados." },
      { status: 400 }
    );
  }

  const updatedEntry = await prisma.onlineWaitlistEntry.update({
    where: { id: entry.id },
    data: {
      status: "CANCELED_BY_CUSTOMER",
      canceledAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    status: updatedEntry.status,
    canceledAt: updatedEntry.canceledAt,
  });
}
