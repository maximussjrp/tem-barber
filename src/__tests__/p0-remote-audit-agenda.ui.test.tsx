import React from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentModal } from "@/components/agenda/AppointmentModal";
import { CancelModal } from "@/components/agenda/CancelModal";
import { AppointmentBlock } from "@/components/agenda/AppointmentBlock";
import { Appointment, Service, Member } from "@/components/agenda/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("date=2026-07-28"),
  useParams: () => ({}),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "barber-user-1", role: "BARBER" } },
    status: "authenticated",
  }),
}));

const mockMember: Member = {
  id: "member-barber-1",
  user: { name: "Barbeiro Teste" },
  startTime: "09:00",
  endTime: "19:00",
  freeSlots: [540, 570],
  serviceIds: ["svc-1"],
};

const mockServices: Service[] = [
  {
    id: "svc-1",
    name: "Corte Cabelo",
    price: "50.00",
    durationMin: 30,
  },
];

const mockAppointment: Appointment = {
  id: "appt-123",
  dateTime: "2026-07-28T10:00:00.000Z",
  durationMin: 30,
  totalPrice: "50.00",
  status: "CONFIRMED",
  notes: null,
  customer: { id: "cust-1", name: "Carlos Silva", phone: "11988887777" },
  barber: { id: "member-barber-1", user: { name: "Barbeiro Teste", avatarUrl: null } },
  services: [
    {
      serviceId: "svc-1",
      service: { id: "svc-1", name: "Corte Cabelo", durationMin: 30 },
      priceApplied: "50.00",
    },
  ],
  whatsappConfirmation: {
    status: "PENDING",
    tokenHint: "123456",
  },
  comandas: [],
};

describe("P0 Remote Audit - Agenda UI Adapters and Scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("AppointmentModal em mode='member' envia CREATE para /api/member/agenda e nunca para /api/admin/appointments", async () => {
    const fetchCalls: { url: string; method: string }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/api/member/agenda")) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ ...mockAppointment, id: "new-appt-1" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });

    const onSaved = vi.fn();
    render(
      <AppointmentModal
        appointment={null}
        members={[mockMember]}
        barbershopServices={mockServices}
        currentDate="2026-07-28"
        mode="member"
        scopedMemberId="member-barber-1"
        initialState={{
          dateTime: "2026-07-28T10:00",
          serviceIds: ["svc-1"],
          customerName: "Cliente Teste",
          customerPhone: "11999998888",
        }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /^criar agendamento$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const postCall = fetchCalls.find((c) => c.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall?.url).toBe("/api/member/agenda");
    expect(fetchCalls.some((c) => c.url.includes("/api/admin/appointments"))).toBe(false);
  });

  it("AppointmentModal em mode='member' envia EDIT para /api/member/agenda/[id] e nunca para /api/admin/appointments/[id]", async () => {
    const fetchCalls: { url: string; method: string }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/api/member/agenda/appt-123")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockAppointment, notes: "Observação atualizada" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });

    const onSaved = vi.fn();
    render(
      <AppointmentModal
        appointment={mockAppointment}
        members={[mockMember]}
        barbershopServices={mockServices}
        currentDate="2026-07-28"
        mode="member"
        scopedMemberId="member-barber-1"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /^salvar$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const putCall = fetchCalls.find((c) => c.method === "PUT");
    expect(putCall).toBeDefined();
    expect(putCall?.url).toBe("/api/member/agenda/appt-123");
    expect(fetchCalls.some((c) => c.url.includes("/api/admin/appointments"))).toBe(false);
  });

  it("AppointmentModal em mode='member' busca clientes através de /api/member/clients/search", async () => {
    const fetchCalls: { url: string }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      fetchCalls.push({ url });
      if (url.includes("/api/member/clients/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ clients: [{ id: "c-1", name: "Carlos", phone: "11988887777" }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <AppointmentModal
        appointment={null}
        members={[mockMember]}
        barbershopServices={mockServices}
        currentDate="2026-07-28"
        mode="member"
        scopedMemberId="member-barber-1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/digite nome ou telefone/i);
    fireEvent.change(searchInput, { target: { value: "Carlos" } });

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.startsWith("/api/member/clients/search?q=Carlos"))).toBe(true);
    });
    expect(fetchCalls.some((c) => c.url.includes("/api/admin/clients/search"))).toBe(false);
  });

  it("CancelModal em mode='member' chama PATCH /api/member/agenda/[id]/status", async () => {
    const fetchCalls: { url: string; method: string; body: unknown }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      fetchCalls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...mockAppointment, status: "CANCELLED" }),
      });
    });

    const onCancelled = vi.fn();
    render(
      <CancelModal
        appointment={mockAppointment}
        mode="member"
        onClose={vi.fn()}
        onCancelled={onCancelled}
      />
    );

    const reasonInput = screen.getByTitle("Motivo do cancelamento");
    fireEvent.change(reasonInput, { target: { value: "Cliente precisou reagendar" } });

    const confirmBtn = screen.getByRole("button", { name: /confirmar/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onCancelled).toHaveBeenCalled();
    });

    const patchCall = fetchCalls.find((c) => c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall?.url).toBe("/api/member/agenda/appt-123/status");
    expect(patchCall?.body).toEqual({
      status: "CANCELLED",
      notes: "Cliente precisou reagendar",
    });
    expect(fetchCalls.some((c) => c.url.includes("/api/admin/appointments"))).toBe(false);
  });

  it("AppointmentBlock em mode='member' oculta ação administrativa de confirmação WhatsApp", () => {
    render(
      <AppointmentBlock
        appointment={mockAppointment}
        mode="member"
        isOpen={true}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onStatusChange={vi.fn()}
        onAppointmentUpdated={vi.fn()}
        onOpenComanda={vi.fn()}
        onToggleOpen={vi.fn()}
        barbershopName="Tem Barber"
      />
    );

    // O botão administrativo "Confirmar com código" ou "Confirmar sem código" não deve estar na árvore
    expect(screen.queryByText(/confirmar com código/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confirmar sem código/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/TB-000000/i)).not.toBeInTheDocument();
  });
});
