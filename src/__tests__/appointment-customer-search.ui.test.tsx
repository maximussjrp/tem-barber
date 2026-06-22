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

function renderModal() {
  return render(
    <AppointmentModal
      appointment={null}
      members={members}
      barbershopServices={services}
      currentDate="2026-07-20"
      initialState={{ memberId: "member-a", dateTime: "2026-07-20T12:00" }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
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
  it("campo Nome do cliente dispara sugestao e selecionar preenche nome e telefone", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Nome do cliente"), "ma");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=ma",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText("Clientes encontrados")).toBeInTheDocument();

    await user.click(await screen.findByText("Maria Souza"));

    expect(screen.getByTitle("Nome do cliente")).toHaveValue("Maria Souza");
    expect(screen.getByTitle("Telefone do cliente")).toHaveValue("(17) 98888-8888");
    expect(screen.getByText("Cliente selecionado:")).toBeInTheDocument();
  });

  it("campo Telefone dispara sugestao por telefone parcial", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Telefone do cliente"), "98888");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=98888",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
  });

  it("campo Buscar cliente cadastrado continua funcionando", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Buscar cliente cadastrado"), "maria");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/clients/search?q=maria",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText("Clientes encontrados")).toBeInTheDocument();
  });
});
