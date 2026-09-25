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
  useParams: () => ({ slug: "barbearia-premium" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  useSession: () => ({ data: sessionMock(), update: updateSessionMock }),
}));

describe("Agendamento Público 2.0 UI Suite", () => {
  const mockBarbershopData = {
    barbershop: {
      name: "Barbearia Premium",
      slug: "barbearia-premium",
      phone: "11988887777",
    },
    categories: [
      {
        id: "cat-1",
        name: "Cabelo & Barba",
        services: [
          { id: "svc-corte", name: "Corte Clássico", price: "60.00", durationMin: 30, description: "Corte tradicional" },
          { id: "svc-barba", name: "Barba Terapia", price: "45.00", durationMin: 30, description: "Toalha quente" },
        ],
      },
    ],
    members: [
      { id: "barber-1", name: "Carlos Barbeiro", role: "BARBER", avatarUrl: null, serviceIds: ["svc-corte", "svc-barba"] },
      { id: "barber-2", name: "Marcos Barbeiro", role: "BARBER", avatarUrl: null, serviceIds: ["svc-corte", "svc-barba"] },
    ],
  };

  const mockAvailability = {
    totalDuration: 30,
    unionSlots: ["09:00", "14:00", "19:00"],
    results: [
      {
        memberId: "barber-1",
        memberName: "Carlos Barbeiro",
        slots: ["09:00", "14:00"],
      },
      {
        memberId: "barber-2",
        memberName: "Marcos Barbeiro",
        slots: ["14:00", "19:00"],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockReturnValue(null);
    localStorage.clear();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/availability")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockAvailability),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBarbershopData),
      });
    }) as unknown as typeof fetch;
  });

  it("renderiza a vitrine de serviços inicial com contador de itens", async () => {
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    expect(screen.getByText("Barba Terapia")).toBeInTheDocument();

    const user = userEvent.setup();
    // Select service
    const selectBtn = screen.getByRole("checkbox", { name: "Corte Clássico" });
    await user.click(selectBtn);

    // Bottom continue button should become active
    const continueBtn = screen.getByRole("button", { name: "Continuar" });
    expect(continueBtn).not.toBeDisabled();
  });

  it("avança para tela única com tira de data e profissionais horizontal", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();

    // Select service
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Verify unified screen elements
    expect(await screen.findByTestId("date-strip")).toBeInTheDocument();
    expect(screen.getByTestId("professional-strip")).toBeInTheDocument();

    // "Qualquer disponível" must be present and default
    expect(screen.getByText("Qualquer disponível")).toBeInTheDocument();
  });

  it("agrupa horários por turnos: Manhã, Tarde e Noite", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Select date in horizontal date strip
    const dateStrip = await screen.findByTestId("date-strip");
    await user.click(dateStrip.children[0]);

    await waitFor(() => {
      expect(screen.getByText("Manhã")).toBeInTheDocument();
      expect(screen.getByText("Tarde")).toBeInTheDocument();
      expect(screen.getByText("Noite")).toBeInTheDocument();
    });

    // Verify time slots
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByText("19:00")).toBeInTheDocument();
  });

  it("apresenta campo de observações com contador limitado a 500 caracteres", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();

    // Step 0 -> Select service
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Select date in horizontal date strip
    const dateStrip = await screen.findByTestId("date-strip");
    await user.click(dateStrip.children[0]);

    // Step 1 -> Select slot 09:00
    const slot09 = await screen.findByText("09:00");
    await user.click(slot09);

    // Click continuar to go to Step 3 (identificação)
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Check notes textarea and character counter
    expect(await screen.findByLabelText(/observações/i)).toBeInTheDocument();
    expect(screen.getByText("0/500")).toBeInTheDocument();

    const notesInput = screen.getByLabelText(/observações/i);
    await user.type(notesInput, "Alérgico a lâmina");
    expect(screen.getByText("17/500")).toBeInTheDocument();
  });

  it("valida estrutura flex horizontal do professional strip sem quebra (PROFESSIONAL_STRIP_STRUCTURE_TEST)", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const strip = await screen.findByTestId("professional-strip");
    expect(strip).toBeInTheDocument();

    // Validar explicitamente classes flex horizontal sem wrap
    expect(strip.className).toContain("flex-row");
    expect(strip.className).toContain("flex-nowrap");
    expect(strip.className).toContain("overflow-x-auto");

    // Confirmar que NÃO possui classes de coluna ou quebra
    expect(strip.className).not.toContain("flex-col");
    expect(strip.className).not.toContain("flex-wrap");

    // Confirmar ordem: primeiro card = Qualquer disponível, depois profissionais
    const cards = strip.querySelectorAll("button");
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards[0]).toHaveTextContent("Qualquer");
    expect(cards[0]).toHaveTextContent("disponível");
    expect(cards[1]).toHaveTextContent("Carlos");
    expect(cards[2]).toHaveTextContent("Marcos");
  });

  it("garante que resposta atrasada de data anterior não sobrescreve seleção mais recente (AVAILABILITY_STALE_RESPONSE_TEST)", async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;

    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });

    const promiseB = new Promise((resolve) => {
      resolveB = resolve;
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/availability")) {
        if (url.includes("date=2026-09-25")) {
          return promiseA;
        }
        if (url.includes("date=2026-09-26")) {
          return promiseB;
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockAvailability),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBarbershopData),
      });
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const dateInput = await screen.findByLabelText("Data do agendamento");
    expect(dateInput).toBeInTheDocument();

    // 1. Seleciona dia 25
    await user.clear(dateInput);
    await user.type(dateInput, "2026-09-25");

    // 2. Logo em seguida seleciona dia 26
    await user.clear(dateInput);
    await user.type(dateInput, "2026-09-26");

    // 3. Resolve B (dia 26) primeiro
    resolveB({
      ok: true,
      json: () =>
        Promise.resolve({
          totalDuration: 30,
          unionSlots: ["16:30"],
          results: [
            {
              memberId: "barber-2",
              memberName: "Marcos Barbeiro",
              slots: ["16:30"],
            },
          ],
        }),
    });

    // Aguarda UI exibir os horários do dia 26
    expect(await screen.findByText("16:30")).toBeInTheDocument();

    // 4. Depois resolve A (dia 25 atrasado)
    resolveA({
      ok: true,
      json: () =>
        Promise.resolve({
          totalDuration: 30,
          unionSlots: ["08:00"],
          results: [
            {
              memberId: "barber-1",
              memberName: "Carlos Barbeiro",
              slots: ["08:00"],
            },
          ],
        }),
    });

    // 5. UI final deve continuar exibindo o horário 16:30 do dia 26 e NÃO o 08:00 atrasado do dia 25
    await waitFor(() => {
      expect(screen.getByText("16:30")).toBeInTheDocument();
      expect(screen.queryByText("08:00")).not.toBeInTheDocument();
    });
  });

  it("CONTRATO B: ANY nunca fixa primeiro barbeiro da availability no frontend e envia memberId='any'", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/availability")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockAvailability),
        });
      }
      if (url.includes("/book")) {
        capturedBody = JSON.parse(options?.body as string);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              appointment: {
                id: "apt-123",
                barberName: "Carlos Barbeiro",
                dateTime: "2026-07-20T09:00:00.000Z",
                services: [{ name: "Corte Clássico" }],
                totalPrice: 60,
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBarbershopData),
      });
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<AgendasPage />);

    // Passo 0: Serviços
    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Passo 1: Data + Profissional + Horário
    const dateStrip = await screen.findByTestId("date-strip");
    await user.click(dateStrip.children[0]);

    // O primeiro profissional que possui o slot 09:00 é barber-1 (Carlos)
    expect(await screen.findByText("09:00")).toBeInTheDocument();
    await user.click(screen.getByText("09:00"));

    // Avançar para dados do cliente
    const nextBtn = screen.getByRole("button", { name: "Continuar" });
    await user.click(nextBtn);

    // Passo 2: Dados do cliente
    const nameInput = await screen.findByTitle("Seu nome");
    const phoneInput = screen.getByTitle("Seu telefone");
    await user.type(nameInput, "João Cliente");
    await user.type(phoneInput, "11988887777");

    // Avançar para resumo / confirmação
    const continueToConfirmBtn = screen.getByRole("button", { name: "Continuar" });
    await user.click(continueToConfirmBtn);

    // Passo 3: Confirmação e submissão
    const confirmBtn = await screen.findByRole("button", { name: /Confirmar agendamento/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    // Validar rigorosamente o contrato ANY:
    // Nunca fixa o primeiro barbeiro ("barber-1") no frontend
    expect(capturedBody!.memberId).toBe("any");
    expect(capturedBody!.memberId).not.toBe("barber-1");
    expect(capturedBody!.professionalPreference).toBe("ANY");
  });

  it("valida wizard de 4 etapas e transições sem phantom step (A-H)", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    // G. indicador possui exatamente 4 etapas
    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText("5")).not.toBeInTheDocument();

    // Selecionar serviço e avançar para etapa de Disponibilidade
    await user.click(screen.getByRole("checkbox", { name: "Corte Clássico" }));
    const continueBtn = screen.getByRole("button", { name: "Continuar" });
    await user.click(continueBtn);

    // A. ao entrar em Disponibilidade sem slot selecionado: Continuar = disabled
    const continueBtnStep1 = screen.getByRole("button", { name: "Continuar" });
    expect(continueBtnStep1).toBeDisabled();

    // B. selecionar data mas não horário: Continuar continua disabled
    const dateStrip = await screen.findByTestId("date-strip");
    await user.click(dateStrip.children[1]);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    // C. selecionar profissional mas não horário: Continuar continua disabled
    expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    await user.click(screen.getByText("Carlos Barbeiro"));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    // D. selecionar horário: Continuar = enabled
    expect(await screen.findByText("09:00")).toBeInTheDocument();
    await user.click(screen.getByText("09:00"));
    expect(screen.getByRole("button", { name: "Continuar" })).not.toBeDisabled();

    // E & F. clicar Continuar: vai DIRETAMENTE para 'Seus dados' (sem phantom transition de tela)
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Seus dados")).toBeInTheDocument();
    expect(screen.queryByTestId("date-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("professional-strip")).not.toBeInTheDocument();

    // H. Voltar: Dados -> Disponibilidade
    const backBtn = screen.getByTitle("Voltar");
    await user.click(backBtn);
    expect(await screen.findByTestId("date-strip")).toBeInTheDocument();
    expect(screen.getByTestId("professional-strip")).toBeInTheDocument();
    expect(screen.queryByText("Seus dados")).not.toBeInTheDocument();

    // H. Voltar: Disponibilidade -> Serviço
    await user.click(screen.getByTitle("Voltar"));
    expect(await screen.findByText("Corte Clássico")).toBeInTheDocument();
    expect(screen.queryByTestId("date-strip")).not.toBeInTheDocument();
  });
});
