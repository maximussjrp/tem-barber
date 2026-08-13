import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentModal } from "@/app/admin/agendamentos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const members = [{ id: "member-a", user: { name: "Bruno Smoke" } }];
const services = [{ id: "svc-a", name: "Corte", price: "40.00", durationMin: 30 }];
const customer = { id: "customer-a", name: "Maria Souza", phone: "(17) 98888-8888" };

function renderModal(onSaved = vi.fn()) {
  return render(
    <AppointmentModal
      appointment={null}
      members={members}
      barbershopServices={services}
      currentDate="2026-07-20"
      initialState={{ memberId: "member-a", dateTime: "2026-07-20T12:00" }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clients: [customer] }),
    })
  );
});

describe("busca de cliente no modal de agendamento", () => {
  it("remove campo separado e usa Cliente para buscar por nome", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.queryByTitle("Buscar cliente cadastrado")).not.toBeInTheDocument();

    await user.type(screen.getByTitle("Cliente"), "ma");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=ma",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText("Clientes encontrados")).toBeInTheDocument();
  });

  it("campo Cliente busca por telefone e selecionar preenche nome e telefone", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Cliente"), "98888");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=98888",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    await user.click(await screen.findByText("Maria Souza"));

    expect(screen.getByTitle("Cliente")).toHaveValue("Maria Souza");
    expect(screen.getByTitle("Telefone do cliente")).toHaveValue("(17) 98888-8888");
    expect(screen.getByText("Cliente selecionado:")).toBeInTheDocument();
  });

  it("campo Telefone sugere cliente existente por telefone parcial", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Telefone do cliente"), "98888");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=98888",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText((content) => content.includes("Maria Souza"))).toBeInTheDocument();
    expect(screen.getByText("Usar este cliente")).toBeInTheDocument();
  });

  it("editar Cliente depois de selecionar limpa customerId antes de salvar", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/appointments" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ id: "appointment-a" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ clients: [customer] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderModal(onSaved);

    await user.click(screen.getByTitle("Corte"));
    await user.type(screen.getByTitle("Cliente"), "maria");
    await user.click(await screen.findByText("Maria Souza"));
    await user.clear(screen.getByTitle("Cliente"));
    await user.type(screen.getByTitle("Cliente"), "Mariana Nova");
    await user.click(screen.getByText("Criar agendamento"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find(([input]) => input === "/api/admin/appointments");
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      customerName: "Mariana Nova",
      customerPhone: "(17) 98888-8888",
    });
    expect(JSON.parse(String(postCall?.[1]?.body))).not.toHaveProperty("customerId");
  });

  it("salvar com cliente selecionado envia customerId existente", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/appointments" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ id: "appointment-a" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ clients: [customer] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderModal(onSaved);

    await user.click(screen.getByTitle("Corte"));
    await user.type(screen.getByTitle("Cliente"), "maria");
    await user.click(await screen.findByText("Maria Souza"));
    await user.click(screen.getByText("Criar agendamento"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find(([input]) => input === "/api/admin/appointments");
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      customerId: "customer-a",
      customerName: "Maria Souza",
      customerPhone: "(17) 98888-8888",
    });
  });

  it("exibe mensagem humana de erro e nao INVALID_SERVICE_SELECTION ao receber falha no agendamento", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/appointments" && init?.method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "INVALID_SERVICE_SELECTION",
            message: "Um ou mais serviços selecionados não estão mais disponíveis. Atualize a seleção e tente novamente."
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ clients: [customer] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderModal(onSaved);

    await user.click(screen.getByTitle("Corte"));
    await user.type(screen.getByTitle("Cliente"), "Maria Souza");
    await user.click(await screen.findByText("Maria Souza"));
    await user.click(screen.getByText("Criar agendamento"));

    expect(await screen.findByText("Um ou mais serviços selecionados não estão mais disponíveis. Atualize a seleção e tente novamente.")).toBeInTheDocument();
    expect(screen.queryByText("INVALID_SERVICE_SELECTION")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("desabilita servico nao executado pelo profissional selecionado", async () => {
    const customMembers = [
      { id: "member-barba-only", user: { name: "Barbeiro Barba Only" }, serviceIds: ["svc-barba"] },
    ];
    const customServices = [
      { id: "svc-corte", name: "Corte", price: "40.00", durationMin: 30 },
      { id: "svc-barba", name: "Barba", price: "30.00", durationMin: 30 },
    ];

    render(
      <AppointmentModal
        appointment={null}
        members={customMembers}
        barbershopServices={customServices}
        currentDate="2026-07-20"
        initialState={{ memberId: "member-barba-only", dateTime: "2026-07-20T12:00" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const corteCheckbox = screen.getByTitle("Corte");
    expect(corteCheckbox).toBeDisabled();
    expect(screen.getByText("Não disponível para este profissional")).toBeInTheDocument();

    const barbaCheckbox = screen.getByTitle("Barba");
    expect(barbaCheckbox).not.toBeDisabled();
  });

  it("ao trocar de profissional, remove apenas os servicos incompativeis mantendo quantities dos validos", async () => {
    const customMembers = [
      { id: "member-both", user: { name: "Barbeiro Completo" }, serviceIds: ["svc-corte", "svc-barba"] },
      { id: "member-corte-only", user: { name: "Barbeiro Corte Only" }, serviceIds: ["svc-corte"] },
    ];
    const customServices = [
      { id: "svc-corte", name: "Corte", price: "40.00", durationMin: 30 },
      { id: "svc-barba", name: "Barba", price: "30.00", durationMin: 30 },
    ];

    const user = userEvent.setup();
    render(
      <AppointmentModal
        appointment={null}
        members={customMembers}
        barbershopServices={customServices}
        currentDate="2026-07-20"
        initialState={{ memberId: "member-both", dateTime: "2026-07-20T12:00" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await user.click(screen.getByTitle("Corte"));
    await user.click(screen.getByTitle("Barba"));

    const plusButtons = screen.getAllByRole("button", { name: "+" });
    expect(plusButtons).toHaveLength(2);
    await user.click(plusButtons[1]);

    expect(screen.getByTitle("Corte")).toBeChecked();
    expect(screen.getByTitle("Barba")).toBeChecked();

    const select = screen.getByTitle("Barbeiro");
    await user.selectOptions(select, "member-corte-only");

    expect(screen.getByTitle("Corte")).toBeChecked();
    expect(screen.getByTitle("Barba")).not.toBeChecked();
    expect(screen.getByTitle("Barba")).toBeDisabled();
  });

  it("edicao de appointment historico permite remover servico incompativel mas nao incrementar nem selecionar novamente", async () => {
    const customMembers = [
      { id: "member-corte-only", user: { name: "Barbeiro Corte Only" }, serviceIds: ["svc-corte"] },
    ];
    const customServices = [
      { id: "svc-corte", name: "Corte", price: "40.00", durationMin: 30 },
      { id: "svc-barba", name: "Barba", price: "30.00", durationMin: 30 },
    ];

    const historicalAppointment = {
      id: "appt-hist",
      dateTime: "2026-07-20T12:00:00.000Z",
      durationMin: 60,
      totalPrice: "60.00",
      status: "CONFIRMED",
      notes: '[[TEMBARBER_SERVICE_QUANTITIES_V1:{"svc-barba":2}]]',
      customer: { id: "customer-a", name: "Maria Souza", phone: "(17) 98888-8888" },
      barber: { id: "member-corte-only", user: { name: "Barbeiro Corte Only", avatarUrl: null } },
      services: [
        { service: { id: "svc-barba", name: "Barba", durationMin: 30 }, serviceId: "svc-barba" }
      ],
      comandas: [],
      whatsappConfirmation: null,
    };

    const user = userEvent.setup();
    render(
      <AppointmentModal
        appointment={historicalAppointment as any}
        members={customMembers}
        barbershopServices={customServices}
        currentDate="2026-07-20"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const barbaCheckbox = screen.getByTitle("Barba");
    expect(barbaCheckbox).toBeChecked();
    expect(barbaCheckbox).not.toBeDisabled();
    expect(screen.getByText("Este profissional não executa mais este serviço — remova para continuar")).toBeInTheDocument();

    expect(screen.getByText("2")).toBeInTheDocument();

    const plusButtons = screen.getAllByRole("button", { name: "+" });
    expect(plusButtons).toHaveLength(1);
    await user.click(plusButtons[0]);
    expect(screen.getByText("2")).toBeInTheDocument();

    const minusButtons = screen.getAllByRole("button", { name: "-" });
    expect(minusButtons).toHaveLength(1);
    await user.click(minusButtons[0]);
    expect(screen.getByText("1")).toBeInTheDocument();

    await user.click(barbaCheckbox);
    expect(barbaCheckbox).not.toBeChecked();

    expect(barbaCheckbox).toBeDisabled();
    expect(screen.getByText("Não disponível para este profissional")).toBeInTheDocument();
  });
});
