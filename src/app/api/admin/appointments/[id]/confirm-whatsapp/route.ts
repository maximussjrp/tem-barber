import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyWhatsappConfirmationToken,
  WHATSAPP_CONFIRMATION_STATUS_CONFIRMED,
  WHATSAPP_CONFIRMATION_STATUS_PENDING,
} from "@/lib/appointments/whatsapp-confirmation";
import { getAdminSession } from "@/lib/api-auth";

type ConfirmationMode = "TOKEN" | "MANUAL_OVERRIDE";

type SafeWhatsappConfirmation = {
  id: string;
  appointmentId: string;
  barbershopId: string;
  status: string;
  tokenHint: string;
  expiresAt: Date | null;
  confirmedAt: Date | null;
  confirmedById: string | null;
  confirmationMethod: string | null;
  manualConfirmationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const safeWhatsappConfirmationSelect = {
  id: true,
  appointmentId: true,
  barbershopId: true,
  status: true,
  tokenHint: true,
  expiresAt: true,
  confirmedAt: true,
  confirmedById: true,
  confirmationMethod: true,
  manualConfirmationReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

function sanitizeWhatsappConfirmation(
  confirmation: SafeWhatsappConfirmation
): SafeWhatsappConfirmation {
  return {
    id: confirmation.id,
    appointmentId: confirmation.appointmentId,
    barbershopId: confirmation.barbershopId,
    status: confirmation.status,
    tokenHint: confirmation.tokenHint,
    expiresAt: confirmation.expiresAt,
    confirmedAt: confirmation.confirmedAt,
    confirmedById: confirmation.confirmedById,
    confirmationMethod: confirmation.confirmationMethod,
    manualConfirmationReason: confirmation.manualConfirmationReason,
    createdAt: confirmation.createdAt,
    updatedAt: confirmation.updatedAt,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  if (!data?.barbershopId) {
    return NextResponse.json(
      { error: "Sem barbearia vinculada." },
      { status: 403 }
    );
  }

  let body: { token?: string; mode?: ConfirmationMode; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const mode: ConfirmationMode = body.mode === "MANUAL_OVERRIDE" ? "MANUAL_OVERRIDE" : "TOKEN";
  const token = body.token?.trim();
  const reason = body.reason?.trim();

  if (mode === "TOKEN" && !token) {
    return NextResponse.json(
      { error: "TOKEN_REQUIRED", message: "Informe o codigo de confirmacao." },
      { status: 400 }
    );
  }

  if (mode === "MANUAL_OVERRIDE" && !reason) {
    return NextResponse.json(
      { error: "MANUAL_REASON_REQUIRED", message: "Informe o motivo da confirmação manual." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const appointment = await prisma.appointment.findFirst({
    where: { id, barbershopId: data.barbershopId },
    select: {
      id: true,
      barbershopId: true,
      memberId: true,
      whatsappConfirmation: {
        select: {
          id: true,
          appointmentId: true,
          barbershopId: true,
          status: true,
          tokenHash: true,
          tokenHint: true,
          expiresAt: true,
          confirmedAt: true,
          confirmedById: true,
          confirmationMethod: true,
          manualConfirmationReason: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Agendamento nao encontrado." }, { status: 404 });
  }

  const canConfirmAny = ["OWNER", "MANAGER"].includes(data.role);
  const canConfirmOwn =
    data.role === "BARBER" && !!data.memberId && appointment.memberId === data.memberId;
  if (!canConfirmAny && !canConfirmOwn) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Sem permissão para confirmar este agendamento." },
      { status: 403 }
    );
  }

  const confirmation = appointment.whatsappConfirmation;
  if (!confirmation) {
    return NextResponse.json(
      { error: "WHATSAPP_CONFIRMATION_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (confirmation.status === WHATSAPP_CONFIRMATION_STATUS_CONFIRMED) {
    return NextResponse.json({
      whatsappConfirmation: sanitizeWhatsappConfirmation(confirmation),
    });
  }

  if (confirmation.status !== WHATSAPP_CONFIRMATION_STATUS_PENDING) {
    return NextResponse.json(
      { error: "WHATSAPP_CONFIRMATION_NOT_PENDING" },
      { status: 409 }
    );
  }

  if (
    mode === "TOKEN" &&
    confirmation.expiresAt &&
    confirmation.expiresAt <= new Date()
  ) {
    return NextResponse.json(
      {
        error: "WHATSAPP_CONFIRMATION_EXPIRED",
        message: "Codigo de confirmacao expirado.",
      },
      { status: 409 }
    );
  }

  if (
    mode === "TOKEN" &&
    !verifyWhatsappConfirmationToken(token as string, confirmation.tokenHash)
  ) {
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
      confirmationMethod: mode,
      manualConfirmationReason: mode === "MANUAL_OVERRIDE" ? reason : null,
    },
    select: safeWhatsappConfirmationSelect,
  });

  return NextResponse.json({
    whatsappConfirmation: sanitizeWhatsappConfirmation(updated),
  });
}
