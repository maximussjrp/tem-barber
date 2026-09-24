import { NextRequest, NextResponse, after } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import { checkMemberPermission } from "@/lib/permissions/engine";
import { lockComandaRow, OperationalError } from "@/lib/operations/comandas";
import { prepareAppointmentCancelledByStaffNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";

const VALID_STATUSES = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<string, ValidStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const role = data!.role || "BARBER";
  const canEdit = await checkMemberPermission(data!.memberId, role, "AGENDA_EDIT_OWN");
  if (!canEdit) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", message: "Você não possui permissão para alterar o status do agendamento." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const barbershopId = data!.barbershopId;
  const memberId = data!.memberId;

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { status, notes } = body;

  if (!status || !VALID_STATUSES.includes(status as ValidStatus)) {
    return NextResponse.json(
      { error: "Status inválido. Use: CONFIRMED, COMPLETED, NO_SHOW ou CANCELLED." },
      { status: 400 }
    );
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id, barbershopId, memberId },
  });

  if (!appointment) {
    return NextResponse.json(
      { error: "Agendamento não encontrado." },
      { status: 404 }
    );
  }

  const previousStatus = appointment.status;

  const allowed = ALLOWED_TRANSITIONS[appointment.status] ?? [];
  if (!allowed.includes(status as ValidStatus)) {
    return NextResponse.json(
      {
        error: `Transição inválida: ${appointment.status} → ${status}.`,
      },
      { status: 422 }
    );
  }

  // DECISION #11: Block direct COMPLETED bypass
  if (status === "COMPLETED") {
    return NextResponse.json(
      {
        error: "CHECKOUT_REQUIRED",
        message: "Finalize o atendimento pelo fluxo de atendimento e pagamento.",
      },
      { status: 422 }
    );
  }

  if (["CANCELLED", "NO_SHOW"].includes(status)) {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const targetComanda = await tx.comanda.findFirst({
          where: { appointmentId: id, barbershopId, status: { not: "CANCELLED" } },
          select: { id: true },
        });

        if (targetComanda) {
          await lockComandaRow(tx, barbershopId, targetComanda.id);

          const lockedComanda = await tx.comanda.findUnique({
            where: { id: targetComanda.id },
            include: {
              payments: { where: { status: "CONFIRMED" } },
              items: {
                include: {
                  stockMovements: true,
                  commissionEntries: true,
                },
              },
            },
          });

          if (!lockedComanda || lockedComanda.status !== "OPEN") {
            throw new OperationalError(
              "COMANDA_NOT_OPEN",
              `Não é possível cancelar o agendamento pois a comanda associada já avançou (status: ${lockedComanda?.status || "UNKNOWN"}).`,
              422
            );
          }

          const hasPayments = lockedComanda.payments.length > 0;
          const hasFinancial = (await tx.financialEntry.count({ where: { comandaId: lockedComanda.id } })) > 0;
          const hasStock = lockedComanda.items.some((i) => i.stockMovements.length > 0);
          const hasCommissions = lockedComanda.items.some((i) => i.commissionEntries.length > 0);

          if (hasPayments || hasFinancial || hasStock || hasCommissions) {
            throw new OperationalError(
              "COMANDA_HAS_FINANCIAL_EFFECTS",
              "A comanda possui efeitos financeiros, comissões ou estoque baixado. O cancelamento deve ser tratado com a gerência.",
              422
            );
          }

          await tx.comanda.update({
            where: { id: lockedComanda.id },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });
        }

        return tx.appointment.update({
          where: { id },
          data: {
            status: status as ValidStatus,
            ...(notes !== undefined && { notes }),
          },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
            services: {
              include: { service: { select: { id: true, name: true, durationMin: true } } },
            },
          },
        });
      });

      if (updated.status === "CANCELLED") {
        const prepared = await prepareAppointmentCancelledByStaffNotifications({
          appointment: updated,
          previousStatus,
          actorUserId: data!.userId,
        });

        if (prepared.created.length > 0) {
          after(async () => {
            try {
              await deliverCreatedNotifications(prepared.created);
            } catch {
              // Contained failure
            }
          });
        }
      }

      return NextResponse.json(updated);
    } catch (err: unknown) {
      if (err instanceof OperationalError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        );
      }
      throw err;
    }
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: status as ValidStatus,
      ...(notes !== undefined && { notes }),
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      barber: { include: { user: { select: { name: true, avatarUrl: true } } } },
      services: {
        include: { service: { select: { id: true, name: true, durationMin: true } } },
      },
    },
  });

  if (updated.status === "CANCELLED") {
    const prepared = await prepareAppointmentCancelledByStaffNotifications({
      appointment: updated,
      previousStatus,
      actorUserId: data!.userId,
    });

    if (prepared.created.length > 0) {
      after(async () => {
        try {
          await deliverCreatedNotifications(prepared.created);
        } catch {
          // Contained failure
        }
      });
    }
  }

  return NextResponse.json(updated);
}
