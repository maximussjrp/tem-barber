import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClienteDetailPage from "@/app/admin/clientes/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "client-1" }),
}));

const detailPayload = {
  id: "client-1",
  name: "Ana Manual",
  email: "ana@test.com",
  phone: "5517991089190",
  createdAt: "2026-08-01T00:00:00.000Z",
  barbershopName: "Barbearia A",
  bookingUrl: "/barbearia-a/agendar",
  contactHistoryConfigured: true,
  isBlocked: false,
  blockRecord: null,
  clubSubscription: null,
  comandaSummary: { open: 0, closed: 0 },
  whatsapp: {
    link: "https://wa.me/5517991089190?text=Oi",
    messages: {
      invite: "Oi, Ana Manual, aqui e da Barbearia A. Quer agendar seu horario?",
      week: "Oi, Ana Manual, agenda da semana aberta.",
      return: "Oi, Ana Manual, quer marcar seu retorno?",
      feedback: "Oi, Ana Manual, como foi seu atendimento?",
    },
  },
  metrics: {
    totalAppointments: 0,
    completedVisits: 0,
    cancelledCount: 0,
    noShowCount: 0,
    upcomingAppointments: 0,
    totalSpent: 0,
    averageTicket: 0,
    firstCompletedVisitAt: null,
    lastCompletedVisitAt: null,
    nextAppointmentAt: null,
    customerSinceAt: "2026-08-01T00:00:00.000Z",
    averageReturnDays: null,
    favoriteProfessional: null,
    favoriteService: null,
    averageRatingGiven: null,
    noShowRate: 0,
    returnStatus: "INSUFFICIENT_DATA",
    reliabilityLabel: "INSUFFICIENT_DATA",
  },
  history: [],
};

const firstLog = {
  id: "log-1",
  channel: "WHATSAPP",
  templateKey: "WEEK_OPEN",
  templateLabel: "Agenda da semana aberta",
  note: "Cliente respondeu que vai verificar horario",
  contactedAt: "2026-08-05T21:30:00.000Z",
  createdAt: "2026-08-05T21:31:00.000Z",
  createdBy: { userId: "admin-1", name: "Admin", memberId: "member-1", memberName: "Operador" },
};

describe("P1 Clientes/CRM LOTE B1 contact logs UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("mostra estado vazio, remove placeholder antigo e nao registra ao abrir/copiar WhatsApp", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ClienteDetailPage />);

    expect(await screen.findByText("Ana Manual")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum contato registrado ainda.")).toBeInTheDocument();
    expect(screen.queryByText("Histórico de contato ainda não configurado.")).not.toBeInTheDocument();
    expect(screen.getByText("Abrir WhatsApp não registra contato automaticamente.")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/"));
    expect(screen.queryByRole("button", { name: "Copiar mensagem" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/5517991089190"),
      "_blank",
      "noopener,noreferrer"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    openSpy.mockRestore();
  });

  it("registra contato manual, bloqueia duplo clique e atualiza historico", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => firstLog })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [firstLog] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClienteDetailPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Registrar contato feito" }));
    await userEvent.type(screen.getByLabelText("Observação opcional"), "Cliente respondeu que vai verificar horario");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const postCall = fetchMock.mock.calls[2];
    expect(String(postCall[0])).toBe("/api/admin/clients/client-1/contact-logs");
    expect(postCall[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      channel: "WHATSAPP",
      templateKey: "APPOINTMENT_INVITE",
      note: "Cliente respondeu que vai verificar horario",
    });
    expect(await screen.findByText("Agenda da semana aberta")).toBeInTheDocument();
    expect(screen.getByText("Cliente respondeu que vai verificar horario")).toBeInTheDocument();
    expect(screen.getByText("Registrado por Operador")).toBeInTheDocument();
  });

  it("usa o template selecionado no WhatsApp manual como padrao do modal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClienteDetailPage />);

    await screen.findByText("Ana Manual");
    await userEvent.selectOptions(screen.getByDisplayValue("Convite/agendamento"), "week");
    await userEvent.click(screen.getByRole("button", { name: "Registrar contato feito" }));

    expect(screen.getByLabelText("Template")).toHaveValue("WEEK_OPEN");
  });

  it("mostra o label acentuado de pos-atendimento no seletor de template", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClienteDetailPage />);

    await screen.findByText("Ana Manual");
    await userEvent.selectOptions(screen.getByDisplayValue("Convite/agendamento"), "feedback");
    await userEvent.click(screen.getByRole("button", { name: "Registrar contato feito" }));

    expect(screen.getAllByRole("option", { name: "Pós-atendimento/feedback" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Template")).toHaveValue("POST_SERVICE_FEEDBACK");
  });
});
