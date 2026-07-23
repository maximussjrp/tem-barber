import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicWaitlistPage from "@/app/[slug]/fila/page";

const { searchParamsMock, routerPushMock } = vi.hoisted(() => ({
  searchParamsMock: {
    get: vi.fn(),
  },
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "don-brio" }),
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}));

const mockOpenStatusResponse = {
  barbershop: {
    id: "shop-1",
    name: "Dom Brio",
    slug: "don-brio",
    phone: "(17) 99108-9190",
  },
  isOpen: true,
  session: {
    id: "session-1",
    status: "OPEN",
    defaultLockBeforeAppointmentMinutes: 20,
    openedAt: "2026-07-23T12:00:00.000Z",
  },
  services: [
    { id: "svc-corte", name: "Corte Tradicional", durationMin: 30, price: "50.00", description: null },
    { id: "svc-barba", name: "Barba Terapia", durationMin: 30, price: "40.00", description: null },
  ],
  members: [
    { id: "member-joao", name: "João Barbeiro", avatarUrl: null },
    { id: "member-pedro", name: "Pedro Barbeiro", avatarUrl: null },
  ],
  waitingCount: 3,
};

const mockClosedStatusResponse = {
  ...mockOpenStatusResponse,
  isOpen: false,
  session: null,
  waitingCount: 0,
};

const mockTrackingEntry = {
  entryId: "entry-123",
  queueNumber: 7,
  currentPosition: 2,
  status: "WAITING",
  customerName: "Rafael",
  customerPhone: "5517998887766",
  serviceId: "svc-corte",
  serviceName: "Corte Tradicional",
  preferredMemberId: "member-joao",
  preferredMemberName: "João Barbeiro",
  skipCount: 0,
  noShowCount: 0,
  createdAt: "2026-07-23T13:00:00.000Z",
};

function mockFetchImplementation() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/public/barbershop/don-brio/waitlist/entry-123")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ entry: mockTrackingEntry }),
      });
    }

    if (url.includes("/api/public/barbershop/don-brio/waitlist")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOpenStatusResponse),
      });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
  }) as unknown as typeof fetch;
}

describe("PR #20 - tela pública da fila online", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    searchParamsMock.get.mockReturnValue(null);
    mockFetchImplementation();
    window.history.replaceState(null, "", "/don-brio/fila");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. renderiza fila aberta", async () => {
    render(<PublicWaitlistPage />);

    expect(await screen.findByText("Dom Brio")).toBeInTheDocument();
    expect(screen.getByText("Fila aberta agora")).toBeInTheDocument();
    expect(screen.getByText("3 aguardando")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar na fila/i })).toBeInTheDocument();
  });

  it("2. renderiza fila fechada", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockClosedStatusResponse),
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);

    expect(await screen.findByText("Fila indisponível no momento")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Entrar na fila/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agendar um horário/i })).toBeInTheDocument();
  });

  it("3. formulário exige nome", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "(17) 99887-7654" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar na fila/i }));

    expect(await screen.findByText("Informe o seu nome para entrar na fila.")).toBeInTheDocument();
  });

  it("4. formulário exige WhatsApp", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Rafael Silva" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar na fila/i }));

    expect(await screen.findByText("Informe um número de WhatsApp válido com DDD.")).toBeInTheDocument();
  });

  it("5. formulário exige serviço", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    expect(screen.getByRole("combobox", { name: /Serviço desejado/i })).toBeRequired();
  });

  it("6. lista serviços ativos", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    expect(screen.getByText("Corte Tradicional (30 min) - R$ 50.00")).toBeInTheDocument();
    expect(screen.getByText("Barba Terapia (30 min) - R$ 40.00")).toBeInTheDocument();
  });

  it("7. lista barbeiros como preferência opcional", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    expect(screen.getByText("Qualquer profissional disponível")).toBeInTheDocument();
    expect(screen.getByText("João Barbeiro")).toBeInTheDocument();
    expect(screen.getByText("Pedro Barbeiro")).toBeInTheDocument();
  });

  it("8. join com sucesso mostra número da fila e posição", async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/join")) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              entryId: "entry-new",
              queueNumber: 10,
              position: 4,
              publicToken: "OWL-test-token",
              status: "WAITING",
              trackingUrl: "/don-brio/fila?entryId=entry-new&token=OWL-test-token",
            }),
        });
      }

      if (url.includes("/entry-new")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entry: {
                ...mockTrackingEntry,
                entryId: "entry-new",
                queueNumber: 10,
                currentPosition: 4,
                preferredMemberId: null,
                preferredMemberName: null,
              },
            }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOpenStatusResponse),
      });
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    await user.type(screen.getByLabelText("Nome"), "Rafael Silva");
    await user.type(screen.getByLabelText("WhatsApp"), "(17) 99887-7654");
    await user.click(screen.getByRole("button", { name: /Entrar na fila/i }));

    expect(await screen.findByText("Você entrou na fila!")).toBeInTheDocument();
    expect(screen.getByText("4º")).toBeInTheDocument();
    expect(screen.getByText("Número da fila: 10")).toBeInTheDocument();
  });

  it("9. tracking carrega por entryId/token", async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-123";
      if (key === "token") return "OWL-token-123";
      return null;
    });

    render(<PublicWaitlistPage />);

    expect(await screen.findByText("2º")).toBeInTheDocument();
    expect(screen.getByText("Número da fila: 7")).toBeInTheDocument();
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
  });

  it("10. polling chama endpoint de tracking", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-123";
      if (key === "token") return "OWL-token-123";
      return null;
    });

    render(<PublicWaitlistPage />);
    await screen.findByText("2º");

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);

    const intervalCallback = setIntervalSpy.mock.calls.at(-1)?.[0] as TimerHandler;
    const initialFetchCount = vi.mocked(global.fetch).mock.calls.length;
    await act(async () => {
      if (typeof intervalCallback === "function") {
        intervalCallback();
      }
    });

    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(initialFetchCount);
    });
  });

  it("11. botão Atualizar agora chama tracking", async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-123";
      if (key === "token") return "OWL-token-123";
      return null;
    });

    render(<PublicWaitlistPage />);
    await screen.findByText("2º");

    fireEvent.click(screen.getByRole("button", { name: /Atualizar agora/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/public/barbershop/don-brio/waitlist/entry-123?token=OWL-token-123")
      );
    });
  });

  it("12. botão Sair da fila chama leave", async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-123";
      if (key === "token") return "OWL-token-123";
      return null;
    });

    let leaveCalled = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/leave")) {
        leaveCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, status: "CANCELED_BY_CUSTOMER" }),
        });
      }

      if (url.includes("/entry-123")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entry: leaveCalled
                ? { ...mockTrackingEntry, currentPosition: 0, status: "CANCELED_BY_CUSTOMER" }
                : mockTrackingEntry,
            }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOpenStatusResponse),
      });
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);
    await screen.findByText("2º");

    fireEvent.click(screen.getByRole("button", { name: /Sair da fila/i }));
    expect(await screen.findByText("Tem certeza que deseja sair da fila? Você perderá sua posição.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sim, sair/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/public/barbershop/don-brio/waitlist/entry-123/leave"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "OWL-token-123" }),
        })
      );
    });
    expect(await screen.findByText("Você saiu da fila")).toBeInTheDocument();
  });

  it("13. status CALLED mostra mensagem 'Você foi chamado'", async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-called";
      if (key === "token") return "OWL-token-called";
      return null;
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/entry-called")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entry: {
                ...mockTrackingEntry,
                entryId: "entry-called",
                queueNumber: 3,
                currentPosition: 0,
                status: "CALLED",
                preferredMemberId: null,
                preferredMemberName: null,
              },
            }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOpenStatusResponse),
      });
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);

    expect(await screen.findByText("Você foi chamado!")).toBeInTheDocument();
    expect(screen.getByText("Procure a equipe da barbearia.")).toBeInTheDocument();
  });

  it("14. status CANCELED_BY_CUSTOMER mostra 'Você saiu da fila'", async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === "entryId") return "entry-canceled";
      if (key === "token") return "OWL-token-canceled";
      return null;
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/entry-canceled")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entry: {
                ...mockTrackingEntry,
                entryId: "entry-canceled",
                queueNumber: 3,
                currentPosition: 0,
                status: "CANCELED_BY_CUSTOMER",
                preferredMemberId: null,
                preferredMemberName: null,
              },
            }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOpenStatusResponse),
      });
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);

    expect(await screen.findByText("Você saiu da fila")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar novamente na fila/i })).toBeInTheDocument();
  });

  it("15. erro de API mostra 'Tentar novamente'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "INTERNAL_ERROR" }),
    }) as unknown as typeof fetch;

    render(<PublicWaitlistPage />);

    expect(await screen.findByText("Não foi possível carregar a fila agora.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeInTheDocument();
  });

  it("16. não renderiza nomes/telefones de outros clientes", async () => {
    render(<PublicWaitlistPage />);
    await screen.findByText("Fila aberta agora");

    expect(screen.queryByText("Outro Cliente")).not.toBeInTheDocument();
    expect(screen.queryByText(/551799888/)).not.toBeInTheDocument();
  });
});
