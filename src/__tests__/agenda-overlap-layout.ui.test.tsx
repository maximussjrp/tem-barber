import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AdminSchedulePage, { computeAppointmentLayouts } from "@/app/admin/agendamentos/page";

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

function createDummyAppt(overrides: Partial<Parameters<typeof computeAppointmentLayouts>[0][number]>) {
  return {
    id: "app-1",
    dateTime: "2026-07-28T09:00:00.000Z",
    totalPrice: "50.00",
    durationMin: 30,
    status: "CONFIRMED" as const,
    notes: null,
    customer: { id: "cust-1", name: "Cliente Teste", phone: "(17) 99999-8888" },
    barber: { id: "barber-1", user: { name: "Barbeiro 1", avatarUrl: null } },
    services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 }, priceApplied: "50.00" }],
    ...overrides,
  };
}

describe("P1 UX Agenda - Overlap and Fit-in Reason Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1 - dois agendamentos sobrepostos do mesmo barbeiro não têm left/width iguais sobrepondo 100%", () => {
    const appA = createDummyAppt({ id: "A", dateTime: "2026-07-28T09:00:00.000Z", durationMin: 30 });
    const appB = createDummyAppt({ id: "B", dateTime: "2026-07-28T09:10:00.000Z", durationMin: 30 });

    const layouts = computeAppointmentLayouts([appA, appB]);

    const layoutA = layouts.find((l) => l.appointment.id === "A")!;
    const layoutB = layouts.find((l) => l.appointment.id === "B")!;

    expect(layoutA.widthPct).toBeLessThan(100);
    expect(layoutB.widthPct).toBeLessThan(100);
    expect(layoutA.leftPct).not.toEqual(layoutB.leftPct);
  });

  it("T2 - dois agendamentos sobrepostos ficam lado a lado (~50% width cada)", () => {
    const appA = createDummyAppt({ id: "A", dateTime: "2026-07-28T09:00:00.000Z", durationMin: 30 });
    const appB = createDummyAppt({ id: "B", dateTime: "2026-07-28T09:10:00.000Z", durationMin: 30 });

    const layouts = computeAppointmentLayouts([appA, appB]);

    expect(layouts).toHaveLength(2);
    expect(layouts[0].widthPct).toBe(50);
    expect(layouts[1].widthPct).toBe(50);
    expect(layouts[0].leftPct).toBe(0);
    expect(layouts[1].leftPct).toBe(50);
  });

  it("T3 - três agendamentos sobrepostos dividem a largura (~33.33% width cada)", () => {
    const appA = createDummyAppt({ id: "A", dateTime: "2026-07-28T09:00:00.000Z", durationMin: 30 });
    const appB = createDummyAppt({ id: "B", dateTime: "2026-07-28T09:10:00.000Z", durationMin: 30 });
    const appC = createDummyAppt({ id: "C", dateTime: "2026-07-28T09:20:00.000Z", durationMin: 30 });

    const layouts = computeAppointmentLayouts([appA, appB, appC]);

    expect(layouts).toHaveLength(3);
    expect(layouts[0].widthPct).toBeCloseTo(33.33, 1);
    expect(layouts[1].widthPct).toBeCloseTo(33.33, 1);
    expect(layouts[2].widthPct).toBeCloseTo(33.33, 1);
    expect(layouts[0].leftPct).toBeCloseTo(0, 1);
    expect(layouts[1].leftPct).toBeCloseTo(33.33, 1);
    expect(layouts[2].leftPct).toBeCloseTo(66.66, 1);
  });

  it("T4 - agendamentos consecutivos 09:00–09:30 e 09:30–10:00 não são tratados como sobrepostos", () => {
    const appA = createDummyAppt({ id: "A", dateTime: "2026-07-28T09:00:00.000Z", durationMin: 30 });
    const appB = createDummyAppt({ id: "B", dateTime: "2026-07-28T09:30:00.000Z", durationMin: 30 });

    const layouts = computeAppointmentLayouts([appA, appB]);

    expect(layouts[0].widthPct).toBe(100);
    expect(layouts[0].leftPct).toBe(0);
    expect(layouts[1].widthPct).toBe(100);
    expect(layouts[1].leftPct).toBe(0);
  });

  it("T5 - agendamentos de barbeiros diferentes não dividem largura entre si", () => {
    const appBarber1 = createDummyAppt({
      id: "A1",
      dateTime: "2026-07-28T09:00:00.000Z",
      durationMin: 30,
      barber: { id: "barber-1", user: { name: "Barbeiro 1", avatarUrl: null } },
    });
    const appBarber2 = createDummyAppt({
      id: "A2",
      dateTime: "2026-07-28T09:00:00.000Z",
      durationMin: 30,
      barber: { id: "barber-2", user: { name: "Barbeiro 2", avatarUrl: null } },
    });

    const layoutsB1 = computeAppointmentLayouts([appBarber1]);
    const layoutsB2 = computeAppointmentLayouts([appBarber2]);

    expect(layoutsB1[0].widthPct).toBe(100);
    expect(layoutsB2[0].widthPct).toBe(100);
  });

  it("Extra - Overlap em cadeia (A 09:00-09:30, B 09:20-09:50, C 09:40-10:10)", () => {
    const appA = createDummyAppt({ id: "A", dateTime: "2026-07-28T09:00:00.000Z", durationMin: 30 });
    const appB = createDummyAppt({ id: "B", dateTime: "2026-07-28T09:20:00.000Z", durationMin: 30 });
    const appC = createDummyAppt({ id: "C", dateTime: "2026-07-28T09:40:00.000Z", durationMin: 30 });

    const layouts = computeAppointmentLayouts([appA, appB, appC]);

    const layoutA = layouts.find((l) => l.appointment.id === "A")!;
    const layoutB = layouts.find((l) => l.appointment.id === "B")!;
    const layoutC = layouts.find((l) => l.appointment.id === "C")!;

    // Maximum concurrent is 2, so width is 50%
    expect(layoutA.widthPct).toBe(50);
    expect(layoutB.widthPct).toBe(50);
    expect(layoutC.widthPct).toBe(50);

    // A and C reuse column 0 (left = 0%)
    expect(layoutA.leftPct).toBe(0);
    expect(layoutB.leftPct).toBe(50);
    expect(layoutC.leftPct).toBe(0);
  });

  it("T6, T7, T8, T9, T10 - Modal de Encaixe permite criar sem motivo e renderiza visualmente", async () => {
    const mockAppointments = [
      createDummyAppt({
        id: "fit-1",
        dateTime: "2026-07-28T10:00:00.000Z",
        bookingMode: "FIT_IN",
        fitInReason: null,
        notes: "Cliente pediu agua",
      }),
    ];

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/admin/appointments")) {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () =>
              Promise.resolve(
                createDummyAppt({
                  id: "fit-created",
                  bookingMode: "FIT_IN",
                  fitInReason: null,
                })
              ),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              appointments: mockAppointments,
              scheduleBlocks: [],
              members: [{ id: "barber-1", user: { name: "Joao Barber" }, startTime: "09:00", endTime: "18:00" }],
              barbershopName: "Tem Barber",
              barbershopSlug: "tem-barber",
            }),
        } as Response);
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "svc-1", name: "Corte", durationMin: 30, price: "50.00" }]),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    });

    render(<AdminSchedulePage />);

    // T9: Card de encaixe mantém indicação visual "ENCAIXE"
    expect(await screen.findByText("ENCAIXE")).toBeInTheDocument();

    // T6 & T8: Criar Encaixe sem motivo no Modal
    fireEvent.click(await screen.findByRole("button", { name: /\+ Op/i }));
    fireEvent.click(await screen.findByText(/\+ NOVO ENCAIXE/i));

    expect(await screen.findByText("Novo Encaixe")).toBeInTheDocument();

    // Selecionar Barbeiro
    fireEvent.change(screen.getByTitle("Barbeiro"), {
      target: { value: "barber-1" },
    });

    // Selecionar Serviço
    fireEvent.click(screen.getByText("Corte"));

    // Telefone
    fireEvent.change(screen.getByTitle("Telefone do cliente"), {
      target: { value: "(17) 99999-8888" },
    });

    // Submeter formulário sem motivo
    fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/appointments",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"bookingMode":"FIT_IN"'),
        })
      );
    });

    // T10: Coluna do barbeiro mantém classe min-w-[280px] lg:min-w-[320px] sem quebrar responsivo
    const barberHeader = screen.getByText("Joao Barber", { selector: "p" });
    expect(barberHeader.closest("div")?.className).toContain("min-w-[280px]");
  });
});
