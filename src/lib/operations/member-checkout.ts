import { Prisma, PaymentMethod } from "@prisma/client";
import {
  ensureComandaForAppointment,
  recalculateComandaTotals,
  OperationalError,
} from "./comandas";
import { isLegacyOwnComanda } from "./permissions";
import { registerPayment } from "./payments";
import { closeComanda } from "./payments";
import { toCents } from "./money";

/**
 * Member checkout modes
 */
export type CheckoutMode = "pay_now" | "leave_for_cash";

/**
 * Operational state derived from appointment/comanda state
 * Not persisted; for UI/API consumption only.
 */
export type OperationalState = "ACTIVE" | "AWAITING_PAYMENT" | "COMPLETED";

/**
 * Input for member checkout finalization
 */
export interface MemberCheckoutInput {
  barbershopId: string;
  appointmentId: string;
  memberId: string;
  mode: CheckoutMode;
  method?: PaymentMethod; // Required for pay_now, ignored for leave_for_cash
  amount?: string | number; // Required for pay_now, ignored for leave_for_cash
  userId: string; // Authenticated user ID for audit trail
  idempotencyKey?: string;
}

/**
 * Context returned by GET checkout endpoint
 */
export interface CheckoutContext {
  appointment: {
    id: string;
    status: string;
    dateTime: string;
    customer: { name: string; phone: string };
  };
  comanda: {
    id: string;
    status: string;
    customerName: string;
    subtotal: string;
    discountTotal: string;
    surchargeTotal: string;
    total: string;
    paidTotal: string;
    remainingTotal: string;
  };
  items: Array<{
    id: string;
    type: string;
    description: string;
    quantity: string;
    unitPrice: string;
    total: string;
    status: string;
    executorId: string | null;
  }>;
  operationalState: OperationalState;
  canPayNow: boolean;
  canLeaveForCash: boolean;
  hasTeamPendingService: boolean;
  payments: Array<{
    id: string;
    method: string;
    amount: string;
    paidAt: string;
  }>;
}

/**
 * Derives operational state from appointment + comanda state
 * DECISION #2: State is derived/DTO, not persisted
 */
export function deriveOperationalState(
  appointment: { status: string },
  comanda?: {
    status: string;
    remainingTotal?: unknown;
  },
  hasOwnPendingService = false,
  hasOwnCompletedService = false
): OperationalState {
  const remainingTotal = Number(comanda?.remainingTotal ?? 0);

  // COMPLETED: appointment is COMPLETED
  if (appointment.status === "COMPLETED" || comanda?.status === "CLOSED") {
    return "COMPLETED";
  }

  // AWAITING_PAYMENT: service done but payment pending
  // DECISION #1: Appointment stays CONFIRMED during leave_for_cash,
  // but comanda OPEN + remainingTotal > 0 = AWAITING_PAYMENT
  if (
    appointment.status === "CONFIRMED" &&
    comanda?.status === "OPEN" &&
    remainingTotal > 0 &&
    !hasOwnPendingService &&
    hasOwnCompletedService
  ) {
    return "AWAITING_PAYMENT";
  }

  // ACTIVE: service still pending or in progress
  return "ACTIVE";
}

/**
 * Determines if BARBER owns this appointment and can checkout
 */
async function validateOwnAppointment(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  barbershopId: string,
  memberId: string
) {
  const appointment = await tx.appointment.findFirst({
    where: {
      id: appointmentId,
      barbershopId,
      memberId, // BARBER is executor
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      services: { include: { service: true } },
    },
  });

  if (!appointment) {
    const existingAppointment = await tx.appointment.findFirst({
      where: { id: appointmentId },
      select: { id: true, barbershopId: true },
    });
    if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
      throw new OperationalError("APPOINTMENT_NOT_FOUND", "Agendamento nao encontrado.", 404);
    }
    throw new OperationalError(
      "COMANDA_SCOPE_FORBIDDEN",
      "Este agendamento não pertence ao profissional autenticado.",
      403
    );
  }

  return appointment;
}

/**
 * Validates that all BARBER's own items are completable
 * and checks for TEAM pending services (which block checkout)
 */
async function validateOwnServices(
  tx: Prisma.TransactionClient,
  comanda: { items: Array<{ executorId: string | null; status: string; id: string }> },
  memberId: string
) {
  const ownItems = comanda.items.filter((item) => item.executorId === memberId);
  const teamPendingItems = comanda.items.filter(
    (item) => item.executorId !== memberId && item.status === "PENDING"
  );

  if (teamPendingItems.length > 0) {
    throw new OperationalError(
      "TEAM_SERVICE_PENDING",
      "Existe serviço de outro profissional pendente nesta comanda.",
      409
    );
  }

  return { ownItems, teamPendingItems };
}

/**
 * Completes all own PENDING items atomically
 * DECISION #15: Validate EVERYTHING first, then mutate
 * DECISION #16: Atomicity — no half-state
 */
async function completeOwnItems(
  tx: Prisma.TransactionClient,
  ownItems: Array<{ id: string; status: string }>
) {
  const now = new Date();
  for (const item of ownItems.filter((i) => i.status === "PENDING")) {
    await tx.comandaItem.update({
      where: { id: item.id },
      data: {
        status: "DONE",
        completedAt: now,
      },
    });
  }
}

/**
 * Member PAY_NOW checkout flow
 * DECISION #8: All steps must complete atomically; full payment required
 */
export async function memberCheckoutPayNow(
  tx: Prisma.TransactionClient,
  input: MemberCheckoutInput & { method: PaymentMethod }
) {
  // 1. Validate appointment ownership (DECISION #17)
  await validateOwnAppointment(
    tx,
    input.appointmentId,
    input.barbershopId,
    input.memberId
  );

  // 2. Ensure/get comanda
  const comanda = await ensureComandaForAppointment(tx, {
    barbershopId: input.barbershopId,
    appointmentId: input.appointmentId,
  });

  // 3. Validate own services (DECISION #15 validate first)
  const fullComanda = await tx.comanda.findFirst({
    where: { id: comanda.id },
    include: { items: true, payments: true },
  });
  if (!fullComanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);

  const { ownItems, teamPendingItems } = await validateOwnServices(tx, fullComanda, input.memberId);

  // TEAM pending blocks immediately, before any mutations
  if (teamPendingItems.length > 0) {
    throw new OperationalError(
      "TEAM_SERVICE_PENDING",
      "Existe serviço de outro profissional pendente nesta comanda.",
      409
    );
  }

  // 4. Complete own items (DECISION #16 mutation after validation)
  await completeOwnItems(tx, ownItems);

  // 5. Recalculate totals
  const updated = await recalculateComandaTotals(tx, fullComanda.id);

  const expectedAmountCents = toCents(updated.remainingTotal);
  if (input.amount != null) {
    throw new OperationalError(
      "AMOUNT_MISMATCH",
      "O valor do pagamento é calculado exclusivamente pelo servidor.",
      422
    );
  }

  // 6. Register payment when there is an outstanding balance.
  if (expectedAmountCents > 0) {
    await registerPayment(tx, {
      barbershopId: input.barbershopId,
      comandaId: fullComanda.id,
      method: input.method,
      amount: expectedAmountCents / 100,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  // 7. Close comanda (triggers appointment COMPLETED internally)
  const closed = await closeComanda(tx, input.barbershopId, fullComanda.id);

  return closed;
}

/**
 * Member LEAVE_FOR_CASH checkout flow
 * DECISION #1: Appointment stays CONFIRMED, Comanda stays OPEN
 * DECISION #9: No payment, commission not released, operationalState derives to AWAITING_PAYMENT
 */
export async function memberCheckoutLeaveForCash(
  tx: Prisma.TransactionClient,
  input: MemberCheckoutInput
) {
  // 1. Validate appointment ownership
  await validateOwnAppointment(
    tx,
    input.appointmentId,
    input.barbershopId,
    input.memberId
  );

  // 2. Ensure/get comanda
  const comanda = await ensureComandaForAppointment(tx, {
    barbershopId: input.barbershopId,
    appointmentId: input.appointmentId,
  });

  // 3. Validate own services
  const fullComanda = await tx.comanda.findFirst({
    where: { id: comanda.id },
    include: { items: true, payments: true },
  });
  if (!fullComanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);

  const { ownItems, teamPendingItems } = await validateOwnServices(tx, fullComanda, input.memberId);

  // TEAM pending blocks immediately
  if (teamPendingItems.length > 0) {
    throw new OperationalError(
      "TEAM_SERVICE_PENDING",
      "Existe serviço de outro profissional pendente nesta comanda.",
      409
    );
  }

  // 4. Complete own items
  await completeOwnItems(tx, ownItems);

  // 5. Recalculate totals (no payment, so remainingTotal preserved)
  const updated = await recalculateComandaTotals(tx, fullComanda.id);

  // Return comanda WITHOUT closing (stays OPEN, appointment stays CONFIRMED)
  return updated;
}

/**
 * Get checkout context for member
 * Called by GET /api/member/agenda/[id]/checkout
 */
export async function getMemberCheckoutContext(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  barbershopId: string,
  memberId: string
): Promise<CheckoutContext> {
  // Validate ownership
  const appointment = await validateOwnAppointment(tx, appointmentId, barbershopId, memberId);

  // Ensure comanda exists
  const comanda = await ensureComandaForAppointment(tx, {
    barbershopId,
    appointmentId,
  });

  // Full comanda state
  const fullComanda = await tx.comanda.findFirst({
    where: { id: comanda.id },
    include: {
      items: true,
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!fullComanda) throw new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);

  // Validate scope via isLegacyOwnComanda
  if (!isLegacyOwnComanda(fullComanda, memberId)) {
    throw new OperationalError(
      "COMANDA_SCOPE_FORBIDDEN",
      "Esta comanda não pertence ao profissional autenticado.",
      403
    );
  }

  // Check for team pending services
  const ownItems = fullComanda.items.filter((item) => item.executorId === memberId);
  const hasOwnPendingService = ownItems.some((item) => item.status === "PENDING");
  const hasOwnCompletedService = ownItems.some((item) => item.status === "DONE");
  const hasTeamPendingService = fullComanda.items.some(
    (item) => item.executorId !== memberId && item.status === "PENDING"
  );

  // Derive operational state
  const operationalState = deriveOperationalState(
    appointment,
    fullComanda,
    hasOwnPendingService,
    hasOwnCompletedService
  );

  // Can pay now if: remainingTotal > 0 and no team pending
  const canPayNow = toCents(fullComanda.remainingTotal) > 0 && !hasTeamPendingService;

  // Can leave for cash if: not yet COMPLETED
  const canLeaveForCash = appointment.status !== "COMPLETED";

  return {
    appointment: {
      id: appointment.id,
      status: appointment.status,
      dateTime: appointment.dateTime.toISOString(),
      customer: {
        name: appointment.customer.name,
        phone: appointment.customer.phone || "",
      },
    },
    comanda: {
      id: fullComanda.id,
      status: fullComanda.status,
      customerName: fullComanda.customerName,
      subtotal: fullComanda.subtotal.toString(),
      discountTotal: fullComanda.discountTotal.toString(),
      surchargeTotal: fullComanda.surchargeTotal.toString(),
      total: fullComanda.total.toString(),
      paidTotal: fullComanda.paidTotal.toString(),
      remainingTotal: fullComanda.remainingTotal.toString(),
    },
    items: fullComanda.items.map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
      status: item.status,
      executorId: item.executorId,
    })),
    operationalState,
    canPayNow,
    canLeaveForCash,
    hasTeamPendingService,
    payments: fullComanda.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount.toString(),
      paidAt: p.paidAt.toISOString(),
    })),
  };
}
