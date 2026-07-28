import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminSchedulePage from "@/app/admin/agendamentos/page";
import MemberAgendaPage from "@/app/member/agenda/page";

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

const adminPayload = {
  appointments: [
    {
      id: "appt-1",
      dateTime: "2026-07-28T10:00:00.000Z",
      durationMin: 30,
      totalPrice: "50.00",
      status: "CONFIRMED",
      notes: null,
      customer: { id: "cust-1", name: "Ana Cliente", phone: "17999998888" },
      barber: { id: "member-1", user: { name: "Joao Barber", avatarUrl: null } },
      services: [{ service: { id: "svc-1", name: "Corte", durationMin: 30 } }],
      comandas: [],
      whatsappConfirmation: null,
    },
  ],
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
  members: [{ id: "member-1", user: { name: "Joao Barber" }, startTime: "09:00", endTime: "18:00", freeSlots: [540, 570] }],
  barbershopName: "Tem Barber",
  barbershopSlug: "tem-barber",
};

const memberAppointments = [
  {
    id: "appt-1",
    dateTime: "2026-07-28T10:00:00.000Z",
    durationMin: 30,
    totalPrice: "50.00",
    status: "CONFIRMED",
    notes: null,
    customer: { name: "Ana Cliente", phone: "17999998888" },
    barbershop: { name: "Tem Barber" },
    services: [{ service: { name: "Corte", durationMin: 30 }, priceApplied: "50.00" }],
  },
];

const memberBlocks = [
  {
    id: "member-block-1",
    startDate: "2026-07-28T13:00:00.000Z",
    endDate: "2026-07-28T14:00:00.000Z",
    reason: "Reuniao",
    allDay: false,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockAdminFetch(deleteStatus = 200, appointmentStatus: "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
  let blockDeleted = false;
  let appointmentDeleted = false;
  const appointments = adminPayload.appointments.map((appointment) => ({
    ...appointment,
    status: appointmentStatus,
  }));
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/appointments/appt-1") && init?.method === "DELETE") {
      if (deleteStatus === 200) appointmentDeleted = true;
      return jsonResponse(deleteStatus === 200 ? { success: true } : { error: "Bloqueado" }, deleteStatus);
    }
    if (url.startsWith("/api/admin/schedule-blocks/block-1") && init?.method === "DELETE") {
      blockDeleted = true;
      return jsonResponse({ success: true });
    }
    if (url === "/api/admin/schedule-blocks" && init?.method === "POST") {
      return jsonResponse({ id: "block-2" }, 201);
    }
    if (url.startsWith("/api/admin/appointments")) {
      return jsonResponse({
        ...adminPayload,
        appointments: appointmentDeleted ? [] : appointments,
        scheduleBlocks: blockDeleted ? [] : adminPayload.scheduleBlocks,
      });
    }
    if (url === "/api/admin/services") return jsonResponse([{ id: "svc-1", name: "Corte", durationMin: 30, price: "50.00" }]);
    return jsonResponse({});
  });
}

function mockMemberFetch() {
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/member/schedule-blocks" && init?.method === "POST") return jsonResponse({ id: "member-block-2" }, 201);
    if (url.startsWith("/api/member/schedule-blocks/member-block-1") && init?.method === "DELETE") return jsonResponse({ success: true });
    if (url.startsWith("/api/member/schedule-blocks")) return jsonResponse(memberBlocks);
    if (url.startsWith("/api/member/agenda")) return jsonResponse(memberAppointments);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Agenda operations UI", () => {
  it("mostra botao + Opcoes", async () => {
    mockAdminFetch();
    render(<AdminSchedulePage />);
    expect(await screen.findByRole("button", { name: /\+ Op/i })).toBeInTheDocument();
  });

  it("opcao Novo Encaixe abre modal de encaixe", async () => {
    mockAdminFetch();
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /\+ Op/i }));
    fireEvent.click(await screen.findByText(/\+ NOVO ENCAIXE/i));
    expect(await screen.findByText("Novo Encaixe")).toBeInTheDocument();
  });

  it("opcao Bloquear Agenda abre ScheduleBlockModal", async () => {
    mockAdminFetch();
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /\+ Op/i }));
    fireEvent.click(await screen.findByText(/BLOQUEAR AGENDA/i));
    expect(await screen.findByRole("button", { name: "Bloquear agenda" })).toBeInTheDocument();
  });

  it("bloqueio renderiza na coluna correta", async () => {
    mockAdminFetch();
    const { container } = render(<AdminSchedulePage />);
    expect(await screen.findByText("Almoco")).toBeInTheDocument();
    expect(container.textContent).toContain("Joao Barber");
  });

  it("exclusao visual do bloqueio remove item", async () => {
    mockAdminFetch();
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByText("Almoco"));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir bloqueio" }));
    await waitFor(() => expect(screen.queryByText("Almoco")).not.toBeInTheDocument());
  });

  it("exclusao visual do Appointment remove item", async () => {
    mockAdminFetch();
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByText("Ana Cliente"));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir agendamento" }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(screen.queryByText("Ana Cliente")).not.toBeInTheDocument());
  });

  it("erro 422 mantem Appointment", async () => {
    mockAdminFetch(422);
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByText("Ana Cliente"));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir agendamento" }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));
    expect(await screen.findByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
  });

  it("CANCELLED permite excluir", async () => {
    mockAdminFetch(200, "CANCELLED");
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByText("Ana Cliente"));
    expect(await screen.findByRole("button", { name: "Excluir agendamento" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("CONFIRMED mantem Cancelar e Excluir como acoes separadas", async () => {
    mockAdminFetch(200, "CONFIRMED");
    render(<AdminSchedulePage />);
    fireEvent.click(await screen.findByText("Ana Cliente"));
    expect(await screen.findByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir agendamento" })).toBeInTheDocument();
  });

  it("BARBER ve bloquear propria agenda", async () => {
    mockMemberFetch();
    render(<MemberAgendaPage />);
    expect(await screen.findByText("Bloquear propria agenda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bloquear" })).toBeInTheDocument();
  });

  it("BARBER nao escolhe outro profissional", async () => {
    mockMemberFetch();
    render(<MemberAgendaPage />);
    await screen.findByText("Bloquear propria agenda");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("BARBER exclui bloqueio proprio visualmente", async () => {
    mockMemberFetch();
    render(<MemberAgendaPage />);
    expect(await screen.findByText("Reuniao")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(screen.queryByText("Reuniao")).not.toBeInTheDocument());
  });
});
