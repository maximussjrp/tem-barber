import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComandaDetailPage from "@/app/admin/comandas/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "comanda-1" }),
}));

const baseComanda = {
  id: "comanda-1",
  appointmentId: null,
  customerName: "Cliente Teste",
  customerPhone: null,
  status: "CLOSED",
  subtotal: "70.00",
  discountTotal: "0.00",
  surchargeTotal: "0.00",
  total: "70.00",
  paidTotal: "70.00",
  remainingTotal: "0.00",
  items: [],
  payments: [
    {
      id: "payment-1",
      method: "PIX",
      amount: "70.00",
      status: "CONFIRMED",
      paidAt: "2026-07-29T10:00:00.000Z",
    },
  ],
  createdAt: "2026-07-29T09:00:00.000Z",
  openedAt: "2026-07-29T09:00:00.000Z",
  closedAt: "2026-07-29T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetch(canReopen: boolean) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/admin/comandas/comanda-1") {
      return jsonResponse({
        ...baseComanda,
        permissions: { canReopen },
      });
    }
    if (url === "/api/admin/services") return jsonResponse([]);
    if (url === "/api/admin/products") return jsonResponse({ products: [] });
    if (url === "/api/admin/appointments") return jsonResponse({ members: [] });
    return jsonResponse({});
  });
}

describe("reabertura de comanda fechada na UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra botao reabrir para OWNER", async () => {
    mockFetch(true);

    render(<ComandaDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Reabrir comanda" }).length).toBeGreaterThan(0);
    });
  });

  it("nao mostra botao reabrir para BARBER", async () => {
    mockFetch(false);

    render(<ComandaDetailPage />);

    await screen.findByText("Cliente Teste");
    expect(screen.queryByRole("button", { name: "Reabrir comanda" })).not.toBeInTheDocument();
  });
});
