import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgendasPage from "@/app/[slug]/agendar/page";

const { sessionMock, updateSessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "don-brio" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  useSession: () => ({ data: sessionMock(), update: updateSessionMock }),
}));

describe("agenda publica PWA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockReturnValue(null);
    localStorage.clear();
    document.cookie = "lastBarbershopSlug=; Max-Age=0; Path=/";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ categories: [], members: [] }),
    }) as unknown as typeof fetch;
  });

  it("salva slug da barbearia ao acessar /[slug]/agendar", async () => {
    render(<AgendasPage />);

    await waitFor(() => {
      expect(localStorage.getItem("lastBarbershopSlug")).toBe("don-brio");
    });
    expect(document.cookie).toContain("lastBarbershopSlug=don-brio");
  });

  it("mostra botao Sair para cliente phone_lookup logado", async () => {
    sessionMock.mockReturnValue({
      user: { id: "customer-a", name: "Maria", authLevel: "phone_lookup" },
    });

    render(<AgendasPage />);

    expect(await screen.findByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("nao mostra botao Sair para visitante deslogado", async () => {
    render(<AgendasPage />);

    await waitFor(() => {
      expect(localStorage.getItem("lastBarbershopSlug")).toBe("don-brio");
    });
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument();
  });

  it("nao mostra botao Sair para sessao admin no link publico", async () => {
    sessionMock.mockReturnValue({
      user: { id: "owner-a", name: "Owner", authLevel: "admin" },
    });

    render(<AgendasPage />);

    await waitFor(() => {
      expect(localStorage.getItem("lastBarbershopSlug")).toBe("don-brio");
    });
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument();
  });

  it("clicar em Sair chama endpoint de logout e preserva slug", async () => {
    sessionMock.mockReturnValue({
      user: { id: "customer-a", name: "Maria", authLevel: "phone_lookup" },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ categories: [], members: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<AgendasPage />);
    await user.click(await screen.findByRole("button", { name: "Sair" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/client/logout", { method: "POST" });
    expect(localStorage.getItem("lastBarbershopSlug")).toBe("don-brio");
  });
});
