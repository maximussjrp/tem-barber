import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientesPage from "@/app/admin/clientes/page";
import ClienteDetailPage from "@/app/admin/clientes/[id]/page";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useParams: () => ({ id: "client-1" }),
}));

const clientPayload = {
  id: "client-1",
  name: "Ana Manual",
  email: "ana@test.com",
  phone: "5517991089190",
  createdAt: "2026-08-01T00:00:00.000Z",
  sources: { link: true, appointment: false, comanda: false, club: false },
  stats: {
    total: 0,
    completed: 0,
    cancelled: 0,
    noShows: 0,
    totalSpent: 0,
    lastVisit: null,
    nextAppointmentAt: null,
    openComandas: 0,
    closedComandas: 0,
    hasClubSubscription: false,
    isBlocked: false,
    lastContactedAt: null,
    contactLogCount: 0,
  },
};

const contactedClientPayload = {
  ...clientPayload,
  id: "client-2",
  name: "Bruno Contato",
  phone: "5517991089191",
  stats: {
    ...clientPayload.stats,
    lastContactedAt: "2026-08-05T12:00:00.000Z",
    contactLogCount: 2,
  },
};

const detailPayload = {
  id: "client-1",
  name: "Ana Manual",
  email: "ana@test.com",
  phone: "5517991089190",
  createdAt: "2026-08-01T00:00:00.000Z",
  birthDate: "1990-05-10",
  notes: "<script>alert(1)</script>",
  barbershopName: "Barbearia A",
  bookingUrl: "/barbearia-a/agendar",
  contactHistoryConfigured: false,
  isBlocked: false,
  blockRecord: null,
  clubSubscription: null,
  comandaSummary: { open: 0, closed: 0 },
  whatsapp: {
    link: "https://wa.me/5517991089190?text=Oi",
    messages: {
      APPOINTMENT_DIRECT: "Oi, Ana. Aqui é da Barbearia A. Vi que você ainda não tem horário marcado essa semana.",
      WEEK_OPEN: "Oi, Ana. Aqui é da Barbearia A. A agenda da semana já está aberta.",
      RETURN_REMINDER: "Oi, Ana. Tudo certo? Já faz um tempo desde seu último atendimento aqui na Barbearia A.",
      POST_SERVICE_FEEDBACK: "Oi, Ana. Aqui é da Barbearia A. Passando para saber se ficou tudo certo com seu atendimento.",
      // legacy support
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

describe("P1 Clientes/CRM LOTE A UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("mostra estado vazio amigável e botão Novo cliente", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clients: [], total: 0, page: 1, pageSize: 30 }),
    }) as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Nenhum cliente encontrado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo cliente" })).toBeInTheDocument();
    expect(screen.getByText("Cadastre um cliente manualmente ou ajuste a busca e os filtros.")).toBeInTheDocument();
  });

  it("cadastra cliente manual e não envia barbershopId pelo body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clients: [], total: 0, page: 1, pageSize: 30 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "client-new" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clients: [clientPayload], total: 1, page: 1, pageSize: 30 }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Cliente Novo");
    await userEvent.type(screen.getByLabelText("WhatsApp"), "(17) 99108-9190");
    await userEvent.type(screen.getByLabelText("Data de nascimento opcional"), "1992-05-14");
    await userEvent.type(screen.getByLabelText("Observações opcionais"), "Cliente VIP");
    await userEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/admin/clientes/client-new"));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({
      name: "Cliente Novo",
      phone: "(17) 99108-9190",
      birthDate: "1992-05-14",
      notes: "Cliente VIP",
    });
    expect(body).not.toHaveProperty("barbershopId");
  });

  it("lista cliente manual, filtra e oferece WhatsApp sem registrar contato", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clients: [clientPayload], total: 1, page: 1, pageSize: 30 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Ana Manual")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sem agendamento" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("filter=without_appointment"));

    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/5517991089190"));
    expect(screen.queryByRole("button", { name: "Copiar mensagem" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("contact"));
  });

  it("mostra métricas, último contato e filtros de contato na listagem", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clients: [clientPayload, contactedClientPayload],
        total: 2,
        page: 1,
        pageSize: 30,
        contactMetrics: { neverContacted: 1, noContact30: 1, recentlyContacted: 1 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Ana Manual")).toBeInTheDocument();
    expect(screen.getByText("Bruno Contato")).toBeInTheDocument();
    expect(screen.getByText("Nunca contatado")).toBeInTheDocument();
    expect(screen.getByText("Último contato: 05/08/2026")).toBeInTheDocument();
    expect(screen.getAllByText("Nunca contatados").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Sem contato há 30 dias").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Sem contato há 60 dias" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sem contato há 90 dias" })).toBeInTheDocument();
    expect(screen.getAllByText("Contatados recentemente").length).toBeGreaterThanOrEqual(2);

    await userEvent.click(screen.getByRole("button", { name: "Sem contato há 30 dias" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("filter=no_contact_30"));
  });

  it("ficha mostra WhatsApp manual e estado vazio de histórico de contato", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...detailPayload, logs: [] }),
    }) as unknown as typeof fetch;

    render(<ClienteDetailPage />);

    expect(await screen.findByText("Ana Manual")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp manual")).toBeInTheDocument();
    expect(screen.queryByText("Histórico de contato ainda não configurado.")).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum contato registrado ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar contato feito" })).toBeInTheDocument();
    expect(screen.getByText("Abrir WhatsApp não registra contato automaticamente.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar mensagem" })).not.toBeInTheDocument();

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/5517991089190"),
      "_blank",
      "noopener,noreferrer"
    );
    openSpy.mockRestore();
  });

  it("edita data de nascimento e observacoes apenas pelo perfil da barbearia", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ birthDate: "1993-06-15", notes: "Observacao atualizada" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<ClienteDetailPage />);
    const birthDate = await screen.findByLabelText("Data de nascimento");
    expect(birthDate).toHaveValue("1990-05-10");
    await userEvent.clear(birthDate);
    await userEvent.type(birthDate, "1993-06-15");
    const notes = screen.getByLabelText("Observações");
    expect(notes).toHaveValue("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    await userEvent.clear(notes);
    await userEvent.type(notes, "Observacao atualizada");
    await userEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));

    await screen.findByText("Perfil da barbearia salvo.");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/clients/client-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      birthDate: "1993-06-15",
      notes: "Observacao atualizada",
    });
  });
});
