import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyWhatsappConfirmationToken,
  WHATSAPP_CONFIRMATION_STATUS_CONFIRMED,
  WHATSAPP_CONFIRMATION_STATUS_PENDING,
} from "@/lib/appointments/whatsapp-confirmation";
import { getAdminSession } from "@/lib/api-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  if (!data?.barbershopId || !["OWNER", "MANAGER"].includes(data.role)) {
    return NextResponse.json(
      { error: "Apenas OWNER ou MANAGER podem confirmar WhatsApp." },
      { status: 403 }
    );
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "TOKEN_REQUIRED", message: "Informe o codigo de confirmacao." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const appointment = await prisma.appointment.findFirst({
    where: { id, barbershopId: data.barbershopId },
    select: {
      id: true,
      barbershopId: true,
      whatsappConfirmation: true,
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Agendamento nao encontrado." }, { status: 404 });
  }

  const confirmation = appointment.whatsappConfirmation;
  if (!confirmation) {
    return NextResponse.json(
      { error: "WHATSAPP_CONFIRMATION_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (confirmation.status === WHATSAPP_CONFIRMATION_STATUS_CONFIRMED) {
    return NextResponse.json({ whatsappConfirmation: confirmation });
  }

  if (confirmation.status !== WHATSAPP_CONFIRMATION_STATUS_PENDING) {
    return NextResponse.json(
      { error: "WHATSAPP_CONFIRMATION_NOT_PENDING" },
      { status: 409 }
    );
  }

  if (confirmation.expiresAt && confirmation.expiresAt <= new Date()) {
    return NextResponse.json(
      {
        error: "WHATSAPP_CONFIRMATION_EXPIRED",
        message: "Codigo de confirmacao expirado.",
      },
      { status: 409 }
    );
  }

  if (!verifyWhatsappConfirmationToken(token, confirmation.tokenHash)) {
    return NextResponse.json(
      {
        error: "INVALID_WHATSAPP_CONFIRMATION_TOKEN",
        message: "Codigo de confirmacao invalido.",
      },
      { status: 422 }
    );
  }

  const updated = await prisma.appointmentWhatsappConfirmation.update({
    where: { appointmentId: appointment.id },
    data: {
      status: WHATSAPP_CONFIRMATION_STATUS_CONFIRMED,
      confirmedAt: new Date(),
      confirmedById: data.userId,
    },
  });

  return NextResponse.json({ whatsappConfirmation: updated });
}
