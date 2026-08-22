import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MemberWaitlistPage from "@/app/member/fila/page";

const openResponse = {
  barbershop: { id: "shop-1", name: "Dom Brio", slug: "don-brio" },
  publicUrl: "https://app.tembarber.com.br/don-brio/fila",
  session: {
    id: "session-1",
    status: "OPEN",
    openedAt: "2026-07-24T12:00:00.000Z",
    entries: [
      {
        id: "entry-1",
        customerName: "Lucas Lima",
        maskedPhone: "****-9988",
        serviceName: "Corte Tradicional",
        preferredMemberName: null,
        queueNumber: 3,
        currentPosition: 1,
        status: "WAITING",
        joinedAt: "2026-07-24T12:30:00.000Z",
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

const calledResponse = {
  ...openResponse,
  currentMemberId: "member-1",
  session: {
    ...openResponse.session,
    entries: [
      {
        ...openResponse.session.entries[0],
        status: "CALLED",
        currentPosition: null,
        calledByMemberId: "member-1",
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PR #23 - Member Waitlist Page UI (/member/fila)", () => {
  it("1. renderiza painel do membro sem seletor de outro profissional", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/admin/waitlist") return jsonResponse(openResponse);
      return jsonResponse({});
    });

    render(<MemberWaitlistPage />);

    expect(await screen.findByText("Área do Profissional")).toBeInTheDocument();
    expect(screen.getByText("Lucas Lima")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chamar próximo para mim" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Selecione o profissional/i)).not.toBeInTheDocument();
  });

  it("2. aciona Chamar próximo para mim com sucesso", async () => {
    let called = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/member/waitlist/call-next" && init?.method === "POST") {
        called = true;
        return jsonResponse({
          entry: { id: "entry-1", status: "FIT_IN_CREATED" },
          appointment: { id: "app-1" },
        });
      }
      return jsonResponse(called ? { ...openResponse, session: { ...openResponse.session, entries: [] } } : openResponse);
    });

    render(<MemberWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo para mim" }));

      await waitFor(() => {
        expect(screen.getByText(/Cliente chamado\. Confirme a presença antes de iniciar/i)).toBeInTheDocument();
    });
  });

  it("3. exibe modal de confirmação em preferência divergente (409 PREFERRED_MEMBER_MISMATCH)", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/member/waitlist/call-next" && init?.method === "POST") {
        return jsonResponse(
          {
            error: "PREFERRED_MEMBER_MISMATCH",
            message: "Este cliente indicou preferência por outro profissional.",
            preferredMemberMismatch: true,
            preferredMember: { id: "barber-2", name: "Barbeiro Pedro" },
          },
          409
        );
      }
      return jsonResponse(openResponse);
    });

    render(<MemberWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo para mim" }));

    expect(await screen.findByText("Preferência divergente")).toBeInTheDocument();
    expect(screen.getByText(/Barbeiro Pedro/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar e chamar" })).toBeInTheDocument();
  });

  it("4. exibe mensagem de erro quando o barbeiro está travado por agendamento próximo", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/member/waitlist/call-next" && init?.method === "POST") {
        return jsonResponse(
          {
            error: "MEMBER_LOCKED_BY_UPCOMING_APPOINTMENT",
            message: "Este profissional tem um agendamento próximo e não pode chamar a fila agora.",
          },
          400
        );
      }
      return jsonResponse(openResponse);
    });

    render(<MemberWaitlistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo para mim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este profissional tem um agendamento próximo e não pode chamar a fila agora."
    );
  });

  it("5. mostra o texto correto sobre chamar e iniciar atendimento", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(openResponse));

    render(<MemberWaitlistPage />);

    expect(await screen.findByText("Chame o próximo cliente e confirme a presença antes de iniciar o atendimento.")).toBeInTheDocument();
    expect(screen.queryByText(/diretamente para a sua agenda/i)).not.toBeInTheDocument();
  });

  it("6. abre modal de não comparecimento sem executar POST", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(calledResponse));

    render(<MemberWaitlistPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Não apareceu" }));

    expect(screen.getByRole("dialog", { name: "Cliente não apareceu?" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/member/waitlist/no-show",
      expect.objectContaining({ method: "POST" })
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("7. cancela modal sem executar POST", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(calledResponse));

    render(<MemberWaitlistPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Não apareceu" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog", { name: "Cliente não apareceu?" })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/member/waitlist/no-show",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("8. confirma não comparecimento uma única vez, fecha modal e mostra sucesso", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/member/waitlist/no-show" && init?.method === "POST") {
        return jsonResponse({ entry: { id: "entry-1", status: "NO_SHOW" } });
      }
      return jsonResponse(calledResponse);
    });

    render(<MemberWaitlistPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Não apareceu" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar não comparecimento" }));
    await waitFor(() => {
      const noShowPosts = vi.mocked(global.fetch).mock.calls.filter(([url, init]) =>
        url === "/api/member/waitlist/no-show" && init?.method === "POST"
      );
      expect(noShowPosts).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/member/waitlist/no-show",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ entryId: "entry-1" }),
        })
      );
    });
    expect(await screen.findByText("Cliente marcado como não compareceu.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Cliente não apareceu?" })).not.toBeInTheDocument();
  });

  it("9. não mostra ação para cliente chamado por outro profissional", async () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse({
      ...calledResponse,
      session: {
        ...calledResponse.session,
        entries: [{ ...calledResponse.session.entries[0], calledByMemberId: "member-2" }],
      },
    }));

    render(<MemberWaitlistPage />);

    await screen.findByText("Fila Online");
    expect(screen.queryByRole("button", { name: "Não apareceu" })).not.toBeInTheDocument();
  });
});
