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
});
