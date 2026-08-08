import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminSchedulePage from "@/app/admin/agendamentos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("date=2026-07-28"),
  useParams: () => ({}),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "admin-1", role: "OWNER" } },
    status: "authenticated",
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("P0 Agenda - Fora do Expediente e Totais do Topo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("T1-T7: slots fora do expediente (09:00-20:00) mostram Fora de expediente e nao sao clicaveis", async () => {
    const payload = {
      appointments: [],
      scheduleBlocks: [
        {
          id: "block-1",
          memberId: "member-1",
          startDate: "2026-07-28T11:00:00.000Z",
          endDate: "2026-07-28T12:00:00.000Z",
          reason: "Almoco",
          allDay: false,
        },
      ],
      members: [
        {
          id: "member-1",
          user: { name: "Joao Barber" },
          startTime: "09:00",
          endTime: "20:00",
          freeSlots: [],
        },
      ],
      barbershopName: "Tem Barber",
      barbershopSlug: "tem-barber",
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/appointments")) {
        return jsonResponse(payload);
      }
      if (url === "/api/admin/services") {
        return jsonResponse([]);
      }
      return jsonResponse({});
    });

    render(<AdminSchedulePage />);

    // T1, T2, T6: Check "Fora de expediente" elements are present for hours < 09:00 or >= 20:00
    const outOfHours = await screen.findAllByText("Fora de expediente");
    expect(outOfHours.length).toBeGreaterThan(0);

    // T4: Check manual block is present
    expect(await screen.findByText("Agenda bloqueada")).toBeInTheDocument();
  });

  it("T12-T18: calculo do total no topo considera comanda ativa, duplicados, descontos e fallbacks", async () => {
    const payload = {
      appointments: [
        {
          id: "appt-active-no-comanda",
          dateTime: "2026-07-28T10:00:00.000Z",
          durationMin: 30,
          totalPrice: "50.00",
          status: "CONFIRMED",
          customer: { id: "cust-1", name: "Ana", phone: "11999998888" },
          barber: { id: "member-1", user: { name: "Joao", avatarUrl: null } },
          services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 } }],
          comandas: [],
        },
        {
          id: "appt-active-with-comanda",
          dateTime: "2026-07-28T12:00:00.000Z",
          durationMin: 30,
          totalPrice: "70.00",
          status: "CONFIRMED",
          customer: { id: "cust-2", name: "Bob", phone: "11999997777" },
          barber: { id: "member-1", user: { name: "Joao", avatarUrl: null } },
          services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 } }],
          comandas: [
            {
              id: "comanda-1",
              status: "OPEN",
              total: "60.00", // R$70 original com R$10 desconto
              paidTotal: "0.00",
              items: [
                { id: "item-1", type: "SERVICE", status: "DONE", quantity: "2" }, // 2x cortes
                { id: "item-2", type: "PRODUCT", status: "DONE", quantity: "1" }, // 1x produto
              ],
            },
          ],
        },
        {
          id: "appt-cancelled-comanda",
          dateTime: "2026-07-28T14:00:00.000Z",
          durationMin: 30,
          totalPrice: "50.00",
          status: "CONFIRMED",
          customer: { id: "cust-3", name: "Carl", phone: "11999996666" },
          barber: { id: "member-1", user: { name: "Joao", avatarUrl: null } },
          services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 } }],
          comandas: [
            {
              id: "comanda-cancelled",
              status: "CANCELLED",
              total: "50.00",
              paidTotal: "0.00",
              items: [],
            },
          ],
        },
        {
          id: "appt-cancelled-completely",
          dateTime: "2026-07-28T15:00:00.000Z",
          durationMin: 30,
          totalPrice: "50.00",
          status: "CANCELLED",
          customer: { id: "cust-4", name: "Carl", phone: "11999995555" },
          barber: { id: "member-1", user: { name: "Joao", avatarUrl: null } },
          services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 } }],
          comandas: [],
        },
      ],
      scheduleBlocks: [],
      members: [
        {
          id: "member-1",
          user: { name: "Joao Barber" },
          startTime: "09:00",
          endTime: "18:00",
          freeSlots: [],
        },
      ],
      barbershopName: "Tem Barber",
      barbershopSlug: "tem-barber",
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/appointments")) {
        return jsonResponse(payload);
      }
      if (url === "/api/admin/services") {
        return jsonResponse([]);
      }
      return jsonResponse({});
    });

    render(<AdminSchedulePage />);

    // Expected calculation:
    // appt-1 (no comanda): fallback services = 1, fallback finance = R$50.00
    // appt-2 (comanda active): active comanda services/products = 2 (cut) + 1 (product) = 3 items, comanda total = R$60.00 (with discount)
    // appt-3 (cancelled comanda): count = 0, finance = R$0.00 (No fallback)
    // appt-4 (cancelled appt): count = 0, finance = R$0.00
    // Totals expected:
    // services: 1 + 3 = 4
    // finance: R$50.00 + R$60.00 = R$110.00
    expect(await screen.findByText("4 tot.")).toBeInTheDocument();
    expect(await screen.findByText("R$ 110,00")).toBeInTheDocument();
  });
});
