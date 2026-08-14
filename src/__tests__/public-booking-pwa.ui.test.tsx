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

  it("previne loop infinito ao buscar disponibilidade e mudar estados de loading/slots", async () => {
    const categoriesPayload = {
      categories: [
        {
          id: "cat-1",
          name: "Cabelo",
          services: [
            {
              id: "svc-1",
              name: "Corte",
              price: "50.00",
              durationMin: 30,
            },
          ],
        },
      ],
      members: [
        {
          id: "member-1",
          name: "João Barber",
          avatarUrl: null,
          bio: null,
          ratingAvg: 5,
          serviceIds: ["svc-1"],
          workingHours: [],
        },
      ],
    };

    const availabilityPayload = {
      results: [
        {
          memberId: "member-1",
          memberName: "João Barber",
          slots: ["09:00", "10:00"],
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/availability")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(availabilityPayload),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(categoriesPayload),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<AgendasPage />);

    // Passo 0: Selecionar o serviço
    const serviceCheckbox = await screen.findByRole("checkbox", { name: /Corte/ });
    await user.click(serviceCheckbox);

    // Clicar em Continuar
    const continueBtn1 = await screen.findByRole("button", { name: "Continuar" });
    await user.click(continueBtn1);

    // Passo 1: Selecionar o barbeiro (qualquer disponível por padrão)
    const continueBtn2 = await screen.findByRole("button", { name: "Continuar" });
    await user.click(continueBtn2);

    // Passo 2: Escolha o horário - Selecionar a data
    const dateInput = await screen.findByTitle("Data do agendamento");

    // Reset call counts on fetchMock to trace only availability requests
    fetchMock.mockClear();

    // Define a data
    await user.type(dateInput, "2026-08-20");

    // Esperar os slots serem renderizados
    await screen.findByRole("button", { name: "09:00" });

    // Esperar um tempo razoável para dar oportunidade de loop de rerender ocorrer
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Filtrar chamadas de availability
    const availabilityCalls = fetchMock.mock.calls.filter((call) =>
      (call[0] as string).includes("/availability")
    );

    // Deve ter chamado exatamente 1 vez para a data inicial
    expect(availabilityCalls.length).toBe(1);

    // Agora altera a data para provocar outra chamada
    await user.clear(dateInput);
    await user.type(dateInput, "2026-08-21");

    // Esperar os slots da nova data (que são os mesmos pelo mock)
    await screen.findByRole("button", { name: "09:00" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const availabilityCallsAfterChange = fetchMock.mock.calls.filter((call) =>
      (call[0] as string).includes("/availability")
    );

    // Deve ter chamado exatamente 2 vezes no total
    expect(availabilityCallsAfterChange.length).toBe(2);
  });
});
