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

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
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
      expect(screen.getByText(/Encaixe criado na sua agenda com sucesso!/i)).toBeInTheDocument();
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
});
