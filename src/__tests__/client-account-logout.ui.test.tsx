import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MinhaContaPage from "@/app/minha-conta/page";

const { pushMock, refreshMock, sessionMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionMock(), status: "authenticated" }),
}));

describe("logout em Minha Conta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockReturnValue({
      user: { id: "customer-a", name: "Maria", authLevel: "verified_link" },
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/client/logout") {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      return {
        ok: true,
        json: async () => (Array.isArray(input) ? [] : []),
      };
    }) as unknown as typeof fetch;
  });

  it("mostra Sair para cliente e chama endpoint de logout", async () => {
    const user = userEvent.setup();

    render(<MinhaContaPage />);
    await user.click(await screen.findByRole("button", { name: "Sair" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/client/logout", { method: "POST" });
    expect(pushMock).toHaveBeenCalledWith("/login");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("nao mostra Sair para sessao admin", async () => {
    sessionMock.mockReturnValue({
      user: { id: "owner-a", name: "Owner", authLevel: "admin" },
    });

    render(<MinhaContaPage />);

    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument();
  });

  it("phone_lookup nao consulta dados privados e mostra estado recuperavel", async () => {
    sessionMock.mockReturnValue({
      user: { id: "customer-a", name: "Cliente", authLevel: "phone_lookup" },
    });

    render(<MinhaContaPage />);

    expect(await screen.findByText("Verificação necessária")).toBeInTheDocument();
    expect(screen.getByText(
      "Para proteger seus agendamentos, sua identidade precisa ser verificada antes de acessar o histórico."
    )).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agendar horário / escolher barbearia" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith("/api/client/appointments");
    expect(global.fetch).not.toHaveBeenCalledWith("/api/client/linked-barbershops");
  });
});
