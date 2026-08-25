/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureComandaMock, recalculateMock, registerPaymentMock, closeComandaMock, sessionMock, prismaMock } = vi.hoisted(() => ({
  ensureComandaMock: vi.fn(),
  recalculateMock: vi.fn(),
  registerPaymentMock: vi.fn(),
  closeComandaMock: vi.fn(),
  sessionMock: vi.fn(),
  prismaMock: { appointment: { findFirst: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/operations/comandas", () => ({
  ensureComandaForAppointment: ensureComandaMock,
  recalculateComandaTotals: recalculateMock,
  OperationalError: class OperationalError extends Error {
    constructor(public code: string, message: string, public status = 400) { super(message); }
  },
}));
vi.mock("@/lib/operations/payments", () => ({
  registerPayment: registerPaymentMock,
  closeComanda: closeComandaMock,
}));
vi.mock("@/lib/operations/permissions", () => ({ isLegacyOwnComanda: vi.fn(() => true) }));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/member-api-auth", () => ({ getMemberSession: sessionMock }));

import { NextRequest } from "next/server";
import { PATCH as statusPatch } from "@/app/api/member/agenda/[id]/status/route";
import {
  deriveOperationalState,
  memberCheckoutLeaveForCash,
  memberCheckoutPayNow,
} from "@/lib/operations/member-checkout";

const baseAppointment = {
  id: "appointment-1",
  barbershopId: "shop-1",
  memberId: "member-1",
  status: "CONFIRMED",
  dateTime: new Date("2026-08-25T13:00:00.000Z"),
  customer: { id: "customer-1", name: "Cliente", phone: "11999999999" },
  services: [],
};

function makeComanda(remainingTotal: string, items = [{ id: "own-1", executorId: "member-1", status: "DONE", type: "SERVICE", total: "35.00" }]) {
  return {
    id: "comanda-1",
    barbershopId: "shop-1",
    appointmentId: "appointment-1",
    status: "OPEN",
    total: remainingTotal,
    remainingTotal,
    paidTotal: "0.00",
    items,
    payments: [],
  };
}

function makeTx(comanda: ReturnType<typeof makeComanda>, appointment = baseAppointment) {
  const tx = {
    appointment: { findFirst: vi.fn(), update: vi.fn() },
    comanda: { findUnique: vi.fn(), findFirst: vi.fn() },
    comandaItem: { update: vi.fn() },
  } as any;
  tx.appointment.findFirst.mockResolvedValue(appointment);
  tx.comanda.findFirst.mockResolvedValue(comanda);
  tx.comandaItem.update.mockImplementation(async ({ where, data }: any) => {
    const item = comanda.items.find((row: any) => row.id === where.id);
    if (item) Object.assign(item, data);
    return item;
  });
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureComandaMock.mockImplementation(async (_tx: unknown, input: { appointmentId: string }) => ({ id: "comanda-1", appointmentId: input.appointmentId }));
  recalculateMock.mockImplementation(async (_tx: unknown, id: string) => ({ ...currentComanda, id }));
  closeComandaMock.mockResolvedValue({ id: "comanda-1", status: "CLOSED", remainingTotal: "0.00" });
  registerPaymentMock.mockResolvedValue({ id: "payment-1" });
  sessionMock.mockResolvedValue({ error: null, data: { userId: "user-1", memberId: "member-1", barbershopId: "shop-1" } });
});

let currentComanda: ReturnType<typeof makeComanda>;
const input = () => ({
  barbershopId: "shop-1",
  appointmentId: "appointment-1",
  memberId: "member-1",
  mode: "pay_now" as const,
  method: "PIX" as const,
  userId: "user-1",
});

describe("member checkout backend A-K", () => {
  it("A/B: receives exactly the server remaining balance", async () => {
    currentComanda = makeComanda("35.00");
    await memberCheckoutPayNow(makeTx(currentComanda), input());
    expect(registerPaymentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 35, method: "PIX" }));
    expect(closeComandaMock).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    currentComanda = makeComanda("50.00");
    await memberCheckoutPayNow(makeTx(currentComanda), input());
    expect(registerPaymentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 50 }));
    expect(registerPaymentMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 70 }));
  });

  it("C: closes without creating a payment when remaining is zero", async () => {
    currentComanda = makeComanda("0.00");
    await memberCheckoutPayNow(makeTx(currentComanda), input());
    expect(registerPaymentMock).not.toHaveBeenCalled();
    expect(closeComandaMock).toHaveBeenCalledOnce();
  });

  it("D/E: distinguishes same-tenant scope from cross-tenant not-found", async () => {
    currentComanda = makeComanda("35.00");
    const otherBarberTx = makeTx(currentComanda);
    otherBarberTx.appointment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "appointment-1", barbershopId: "shop-1" });
    await expect(memberCheckoutPayNow(otherBarberTx, input())).rejects.toMatchObject({ code: "COMANDA_SCOPE_FORBIDDEN", status: 403 });

    const crossTenantTx = makeTx(currentComanda);
    crossTenantTx.appointment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "appointment-1", barbershopId: "shop-2" });
    await expect(memberCheckoutPayNow(crossTenantTx, input())).rejects.toMatchObject({ code: "APPOINTMENT_NOT_FOUND", status: 404 });
    expect(registerPaymentMock).not.toHaveBeenCalled();
  });

  it("F: idempotency produces one financial effect", async () => {
    currentComanda = makeComanda("35.00");
    const effects = new Set<string>();
    registerPaymentMock.mockImplementation(async (_tx: unknown, value: { idempotencyKey?: string }) => {
      if (value.idempotencyKey) effects.add(value.idempotencyKey);
      return { id: "payment-1" };
    });
    await memberCheckoutPayNow(makeTx(currentComanda), { ...input(), idempotencyKey: "same-key" });
    await memberCheckoutPayNow(makeTx(currentComanda), { ...input(), idempotencyKey: "same-key" });
    expect(effects.size).toBe(1);
  });

  it("G: completes own pending service before payment and close", async () => {
    currentComanda = makeComanda("35.00", [{ id: "own-1", executorId: "member-1", status: "PENDING", type: "SERVICE", total: "35.00" }]);
    await memberCheckoutPayNow(makeTx(currentComanda), input());
    expect(currentComanda.items[0].status).toBe("DONE");
    expect(closeComandaMock).toHaveBeenCalledOnce();
  });

  it("H: blocks team pending before any mutation", async () => {
    currentComanda = makeComanda("70.00", [
      { id: "own-1", executorId: "member-1", status: "PENDING", type: "SERVICE", total: "35.00" },
      { id: "team-1", executorId: "member-2", status: "PENDING", type: "SERVICE", total: "35.00" },
    ]);
    await expect(memberCheckoutPayNow(makeTx(currentComanda), input())).rejects.toMatchObject({ code: "TEAM_SERVICE_PENDING", status: 409 });
    expect(currentComanda.items.every((item) => item.status === "PENDING")).toBe(true);
    expect(registerPaymentMock).not.toHaveBeenCalled();
    expect(closeComandaMock).not.toHaveBeenCalled();
  });

  it("I: rejects direct COMPLETED patch without updating the appointment", async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({ id: "appointment-1", memberId: "member-1", status: "CONFIRMED" });
    const response = await statusPatch(
      new NextRequest("http://localhost/api/member/agenda/appointment-1/status", { method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) }),
      { params: Promise.resolve({ id: "appointment-1" }) }
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "CHECKOUT_REQUIRED" });
    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it("J: leave-for-cash completes service but keeps payment and appointment open", async () => {
    currentComanda = makeComanda("35.00", [{ id: "own-1", executorId: "member-1", status: "PENDING", type: "SERVICE", total: "35.00" }]);
    const tx = makeTx(currentComanda);
    const result = await memberCheckoutLeaveForCash(tx, { ...input(), mode: "leave_for_cash", method: undefined });
    expect(currentComanda.items[0].status).toBe("DONE");
    expect(registerPaymentMock).not.toHaveBeenCalled();
    expect(closeComandaMock).not.toHaveBeenCalled();
    expect(result.remainingTotal).toBe("35.00");
    expect(deriveOperationalState(baseAppointment, currentComanda, false, true)).toBe("AWAITING_PAYMENT");
  });

  it("K: admin can receive the outstanding balance after leave-for-cash", async () => {
    currentComanda = makeComanda("35.00");
    await memberCheckoutLeaveForCash(makeTx(currentComanda), { ...input(), mode: "leave_for_cash", method: undefined });
    await registerPaymentMock({}, { amount: 35, method: "PIX" });
    await closeComandaMock({}, "shop-1", "comanda-1");
    expect(registerPaymentMock).toHaveBeenCalledWith({}, { amount: 35, method: "PIX" });
    expect(closeComandaMock).toHaveBeenCalledWith({}, "shop-1", "comanda-1");
  });

  it.each([10, 50])("rejects client amount %s even when server balance is 35", async (amount) => {
    currentComanda = makeComanda("35.00");
    await expect(memberCheckoutPayNow(makeTx(currentComanda), { ...input(), amount })).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    expect(registerPaymentMock).not.toHaveBeenCalled();
  });

  it.each([
    ["COMPLETED", undefined, undefined, "COMPLETED"],
    ["CONFIRMED", "OPEN", "35.00", "ACTIVE"],
    ["CONFIRMED", "OPEN", "35.00", "AWAITING_PAYMENT"],
    ["CANCELLED", undefined, undefined, "ACTIVE"],
    ["NO_SHOW", undefined, undefined, "ACTIVE"],
  ])("production state %s", (status, comandaStatus, remaining, expected) => {
    const hasCompleted = expected === "AWAITING_PAYMENT";
    expect(deriveOperationalState({ status }, comandaStatus ? { status: comandaStatus, remainingTotal: remaining } : undefined, false, hasCompleted)).toBe(expected);
  });
});
