import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { deriveOperationalState, memberCheckoutPayNow } from "@/lib/operations/member-checkout";

describe("member checkout rules", () => {
  it("marks confirmed open appointments with remaining balance as awaiting payment", () => {
    expect(
      deriveOperationalState(
        { status: "CONFIRMED" },
        { status: "OPEN", remainingTotal: 50 },
        false,
        true
      )
    ).toBe("AWAITING_PAYMENT");

    expect(
      deriveOperationalState(
        { status: "CONFIRMED" },
        { status: "OPEN", remainingTotal: 50 },
        true,
        true
      )
    ).toBe("ACTIVE");

    expect(
      deriveOperationalState(
        { status: "CONFIRMED" },
        { status: "OPEN", remainingTotal: 50 },
        false,
        false
      )
    ).toBe("ACTIVE");

    expect(
      deriveOperationalState({ status: "CANCELLED" }, undefined, false, false)
    ).toBe("ACTIVE");

    expect(
      deriveOperationalState({ status: "NO_SHOW" }, undefined, false, false)
    ).toBe("ACTIVE");

    expect(
      deriveOperationalState({ status: "COMPLETED" }, undefined, false, false)
    ).toBe("COMPLETED");
  });

  it("requires pay_now to match the server-authoritative remaining total exactly", async () => {
    const tx = {
      appointment: {
        findFirst: vi.fn().mockResolvedValue({
          id: "appt-1",
          barbershopId: "shop-1",
          memberId: "member-1",
          customer: { id: "cust-1", name: "Cliente", phone: "11999999999" },
          services: [],
        }),
      },
      comanda: {
        findUnique: vi.fn().mockResolvedValue({
          id: "comanda-1",
          barbershopId: "shop-1",
          appointmentId: "appt-1",
          status: "OPEN",
          remainingTotal: "50.00",
          total: "50.00",
          items: [{ id: "item-1", executorId: "member-1", status: "DONE" }],
          payments: [],
          customerName: "Cliente",
          customerPhone: "11999999999",
          customerId: null,
          subtotal: "50.00",
          discountTotal: "0.00",
          surchargeTotal: "0.00",
          paidTotal: "0.00",
        }),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "comanda-1",
          barbershopId: "shop-1",
          appointmentId: "appt-1",
          status: "OPEN",
          remainingTotal: "50.00",
          total: "50.00",
          items: [{ id: "item-1", executorId: "member-1", status: "DONE" }],
          payments: [],
          customerName: "Cliente",
          customerPhone: "11999999999",
          customerId: null,
          subtotal: "50.00",
          discountTotal: "0.00",
          surchargeTotal: "0.00",
          paidTotal: "0.00",
        }),
        update: vi.fn().mockResolvedValue({
          id: "comanda-1",
          status: "OPEN",
          remainingTotal: "50.00",
        }),
      },
      comandaItem: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: "item-1", executorId: "member-1", status: "DONE", type: "SERVICE", total: "50.00", clubBenefitUsage: null, serviceId: null, productId: null, requestedClubPlanBenefitId: null },
        ]),
      },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      memberCheckoutPayNow(tx, {
        barbershopId: "shop-1",
        appointmentId: "appt-1",
        memberId: "member-1",
        mode: "pay_now",
        method: "CASH",
        amount: "10.00",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });
});
