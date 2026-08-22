import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminWaitlistPage from "@/app/admin/fila/page";

const emptyResponse = {
  barbershop: { id: "shop-1", name: "Dom Brio", slug: "don-brio" },
  publicUrl: "https://app.tembarber.com.br/don-brio/fila",
  members: [
    { id: "member-1", name: "João Barbeiro" },
    { id: "member-2", name: "Pedro Barbeiro" },
  ],
  session: null,
  summary: {
    total: 0,
    waiting: 0,
    called: 0,
    inService: 0,
    completed: 0,
    canceled: 0,
    expired: 0,
  },
};

const openResponse = {
  ...emptyResponse,
  session: {
    id: "session-1",
    status: "OPEN",
    openedAt: "2026-07-23T12:00:00.000Z",
    closedAt: null,
    title: null,
    entries: [
      {
        id: "entry-1",
        customerName: "Rafael Souza",
        maskedPhone: "****-7766",
        customerPhone: "5517998887766",
        serviceName: "Corte Tradicional",
        preferredMemberName: "João Barbeiro",
        queueNumber: 12,
        currentPosition: 1,
        status: "WAITING",
        joinedAt: "2026-07-23T13:00:00.000Z",
        skipCount: 1,
        noShowCount: 2,
        publicTokenHash: "secret-hash",
      },
    ],
  },
  summary: {
    total: 1,
    waiting: 1,
    called: 0,
    inService: 0,
    completed: 0,
    canceled: 0,
    expired: 0,
  },
};

const pausedResponse = {
  ...openResponse,
  session: {
    ...openResponse.session,
    status: "PAUSED",
  },
};

const calledResponse = {
  ...openResponse,
  session: {
    ...openResponse.session,
    entries: [
      {
        ...openResponse.session.entries[0],
        currentPosition: null,
        status: "CALLED",
        calledByMemberId: "member-1",
        calledByMemberName: "João Barbeiro",
      },
    ],
  },
  summary: { ...openResponse.summary, waiting: 0, called: 1 },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetchWithData(responseBody: unknown, status = 200) {
  global.fetch = vi.fn().mockImplementation(() => jsonResponse(responseBody, status));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PR #21 - Painel Admin da Fila Online", () => {
  it("renderiza estado sem fila aberta", async () => {
    mockFetchWithData(emptyResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Sem fila aberta")).toBeInTheDocument();
    expect(screen.getByText("Nenhum cliente na fila")).toBeInTheDocument();
  });

  it("mostra botão Abrir fila quando não existe sessão ativa", async () => {
    mockFetchWithData(emptyResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByRole("button", { name: "Abrir fila" })).toBeInTheDocument();
  });

  it("abre fila e recarrega os dados", async () => {
    let isOpen = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/open" && init?.method === "POST") {
        isOpen = true;
        return jsonResponse({ session: openResponse.session }, 201);
      }
      return jsonResponse(isOpen ? openResponse : emptyResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir fila" }));

    expect(await screen.findByText("Aberta")).toBeInTheDocument();
    expect(screen.getByText("Rafael Souza")).toBeInTheDocument();
  });

  it("mostra fila aberta", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Aberta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pausar fila" })).toBeInTheDocument();
  });

  it("mostra link público /[slug]/fila", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("https://app.tembarber.com.br/don-brio/fila")).toBeInTheDocument();
    expect(screen.queryByText(/localhost/i)).not.toBeInTheDocument();
  });

  it("utiliza fallback https://app.tembarber.com.br/{slug}/fila e não localhost quando publicUrl é nulo", async () => {
    const responseWithNullPublicUrl = {
      ...openResponse,
      publicUrl: null,
    };
    mockFetchWithData(responseWithNullPublicUrl);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("https://app.tembarber.com.br/don-brio/fila")).toBeInTheDocument();
    expect(screen.queryByText(/localhost/i)).not.toBeInTheDocument();
  });

  it("copia link público quando clipboard está disponível", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Copiar link" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://app.tembarber.com.br/don-brio/fila");
    });
  });

  it("mostra botão Chamar próximo e seletor de profissional quando a fila está aberta", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByRole("button", { name: "Chamar próximo" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Selecione o profissional" })).toBeInTheDocument();
  });

  it("chama próximo cliente com o barbeiro selecionado", async () => {
    let called = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/call-next" && init?.method === "POST") {
        called = true;
        return jsonResponse({
          entry: { id: "entry-1", status: "FIT_IN_CREATED" },
          appointment: { id: "app-1", barber: { user: { name: "João Barbeiro" } } },
        });
      }
      return jsonResponse(called ? { ...openResponse, session: { ...openResponse.session, entries: [] } } : openResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));

      await waitFor(() => {
        expect(screen.getByText(/Cliente chamado\. Confirme a presença antes de iniciar/i)).toBeInTheDocument();
    });
  });

  it("exibe modal de preferência divergente quando a API retorna HTTP 409", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/call-next" && init?.method === "POST") {
        return jsonResponse(
          {
            error: "PREFERRED_MEMBER_MISMATCH",
            message: "Este cliente indicou preferência por outro profissional.",
            preferredMemberMismatch: true,
            preferredMember: { id: "member-2", name: "Pedro Barbeiro" },
          },
          409
        );
      }
      return jsonResponse(openResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));

    expect(await screen.findByText("Preferência divergente")).toBeInTheDocument();
    expect(screen.getAllByText(/Pedro Barbeiro/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Confirmar e chamar" })).toBeInTheDocument();
  });

  it("mostra clientes aguardando", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Rafael Souza")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("Posição 1")).toBeInTheDocument();
    expect(screen.getByText("Passes 1 / no-shows 2")).toBeInTheDocument();
  });

  it("mostra serviço e barbeiro preferido", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Corte Tradicional")).toBeInTheDocument();
    expect(screen.getAllByText("João Barbeiro").length).toBeGreaterThan(0);
  });

  it("mostra telefone mascarado", async () => {
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("****-7766")).toBeInTheDocument();
    expect(screen.queryByText("5517998887766")).not.toBeInTheDocument();
  });

  it("não renderiza publicTokenHash", async () => {
    mockFetchWithData(openResponse);

    const { container } = render(<AdminWaitlistPage />);

    await screen.findByText("Rafael Souza");
    expect(container.textContent).not.toContain("secret-hash");
    expect(container.textContent).not.toContain("publicTokenHash");
  });

  it("pausa fila", async () => {
    let paused = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/pause" && init?.method === "POST") {
        paused = true;
        return jsonResponse({ session: pausedResponse.session });
      }
      return jsonResponse(paused ? pausedResponse : openResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Pausar fila" }));

    expect(await screen.findByText("Pausada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retomar fila" })).toBeInTheDocument();
  });

  it("fecha fila com confirmação", async () => {
    let closed = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/close" && init?.method === "POST") {
        closed = true;
        return jsonResponse({ session: { id: "session-1", status: "CLOSED" } });
      }
      return jsonResponse(closed ? emptyResponse : openResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Fechar fila" }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(await screen.findByText("Sem fila aberta")).toBeInTheDocument();
  });

  it("erro de API mostra opção de tentar novamente", async () => {
    mockFetchWithData({ error: "Falha temporária" }, 500);

    render(<AdminWaitlistPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("403 mostra acesso negado", async () => {
    mockFetchWithData({ error: "FORBIDDEN" }, 403);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Acesso negado")).toBeInTheDocument();
    expect(screen.getByText(/Apenas OWNER e MANAGER/)).toBeInTheDocument();
  });

  it("renderiza estrutura básica em viewport mobile", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 390 });
    mockFetchWithData(openResponse);

    render(<AdminWaitlistPage />);

    expect(await screen.findByText("Painel da fila")).toBeInTheDocument();
    expect(screen.getByText("Clientes na fila")).toBeInTheDocument();
    expect(screen.getByText("Rafael Souza")).toBeInTheDocument();
  });

  it("confirma e marca cliente chamado como não apareceu", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/waitlist/no-show" && init?.method === "POST") {
        return jsonResponse({ entry: { id: "entry-1", status: "NO_SHOW" } });
      }
      return jsonResponse(calledResponse);
    });

    render(<AdminWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Não apareceu" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Marcar este cliente como não compareceu e removê-lo da fila?"
    );
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/waitlist/no-show",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ entryId: "entry-1" }),
        })
      );
    });
    expect(await screen.findByText("Cliente marcado como não compareceu.")).toBeInTheDocument();
  });
});
