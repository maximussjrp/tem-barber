import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as finalizePost } from "@/app/api/admin/comandas/[id]/finalize/route";

const {
  closeComandaMock,
  MockOperationalError,
  prismaMock,
  recalculateComandaTotalsMock,
  registerPaymentMock,
  requireOperationalSessionMock,
} = vi.hoisted(() => ({
  closeComandaMock: vi.fn(),
  MockOperationalError: class MockOperationalError extends Error {
    constructor(
      public code: string,
      message: string,
      public status = 400
    ) {
      super(message);
    }
  },
  prismaMock: {
    $transaction: vi.fn(),
    comanda: {
      findFirst: vi.fn(),
    },
    payment: {
      create: vi.fn(),
    },
    financialEntry: {
      create: vi.fn(),
    },
  },
  recalculateComandaTotalsMock: vi.fn(),
  registerPaymentMock: vi.fn(),
  requireOperationalSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return {
    ...actual,
    requireOperationalSession: requireOperationalSessionMock,
  };
});
vi.mock("@/lib/operations/comandas", () => ({
  comandaInclude: {},
  OperationalError: MockOperationalError,
  recalculateComandaTotals: recalculateComandaTotalsMock,
}));
vi.mock("@/lib/operations/payments", () => ({
  closeComanda: closeComandaMock,
  registerPayment: registerPaymentMock,
}));

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/comandas/comanda-1/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("finalizacao apos reabertura de comanda ja paga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock));
    prismaMock.comanda.findFirst.mockResolvedValue({
      id: "comanda-1",
      barbershopId: "shop-1",
      status: "PENDING_PAYMENT",
      customerId: "customer-1",
      items: [{ id: "item-1", type: "SERVICE", status: "DONE", executorId: "barber-1" }],
      appointment: { memberId: "barber-1" },
    });
    recalculateComandaTotalsMock.mockResolvedValue({
      id: "comanda-1",
      remainingTotal: "0.00",
    });
    closeComandaMock.mockResolvedValue({
      id: "comanda-1",
      status: "CLOSED",
    });
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: {
        userId: "owner-user",
        memberId: "owner-member",
        role: "OWNER",
        barbershopId: "shop-1",
      },
    });
  });

  it("fechar novamente com saldo zero nao duplica Payment nem FinancialEntry", async () => {
    const res = await finalizePost(request({ payments: [] }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });

    expect(res.status).toBe(200);
    expect(registerPaymentMock).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(prismaMock.financialEntry.create).not.toHaveBeenCalled();
    expect(closeComandaMock).toHaveBeenCalledWith(prismaMock, "shop-1", "comanda-1");
  });
});
