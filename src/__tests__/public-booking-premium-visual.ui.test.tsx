import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgendasPage from "@/app/[slug]/agendar/page";

const { sessionMock, updateSessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "barbearia-luxo" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  useSession: () => ({ data: sessionMock(), update: updateSessionMock }),
}));

describe("Public Booking Premium Visual Suite", () => {
  const mockBarbershopData = {
    barbershop: {
      name: "Barbearia Luxo",
      slug: "barbearia-luxo",
      phone: "11999998888",
    },
    categories: [
      {
        id: "cat-1",
        name: "Serviços Principais",
        services: [
          {
            id: "svc-combo",
            name: "Combo Corte + Barba",
            price: "70.00",
            durationMin: 50,
            description: "Corte completo e toalha quente",
            imageUrl: "/uploads/combo-premium.jpg",
          },
          {
            id: "svc-simples",
            name: "Corte Tradicional",
            price: "45.00",
            durationMin: 30,
            description: "Apenas tesoura e máquina",
            imageUrl: null, // sem foto -> fallback
          },
        ],
      },
    ],
    members: [
      {
        id: "barber-dandara",
        name: "Dandara Santos",
        role: "BARBER",
        avatarUrl: "/uploads/dandara.jpg",
        ratingAvg: 5.0,
        serviceIds: ["svc-combo", "svc-simples"],
      },
      {
        id: "barber-jesus",
        name: "Jesus Aparecido",
        role: "BARBER",
        avatarUrl: null, // sem avatar -> iniciais fallback
        ratingAvg: 4.9,
        serviceIds: ["svc-combo", "svc-simples"],
      },
    ],
  };

  const mockAvailability = {
    totalDuration: 50,
    unionSlots: ["09:00", "09:30", "10:00", "10:30", "14:00", "14:30", "19:00"],
    results: [
      {
        memberId: "barber-dandara",
        memberName: "Dandara Santos",
        slots: ["09:00", "09:30", "10:00", "10:30", "14:00", "14:30"],
      },
      {
        memberId: "barber-jesus",
        memberName: "Jesus Aparecido",
        slots: ["14:00", "14:30", "19:00"],
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

  it("A & B: serviço com imageUrl mostra foto real, e sem imageUrl mostra fallback elegante", async () => {
    render(<AgendasPage />);

    expect(await screen.findByText("Combo Corte + Barba")).toBeInTheDocument();
    expect(screen.getByText("Corte Tradicional")).toBeInTheDocument();

    // Serviço com imagem: imagem com src correto
    const imgCombo = screen.getByRole("img", { name: "Combo Corte + Barba" });
    expect(imgCombo).toBeInTheDocument();
    expect(imgCombo).toHaveAttribute("src", "/uploads/combo-premium.jpg");

    // Serviço sem imagem: fallback elegante com ícone
    expect(screen.getByText("✂️")).toBeInTheDocument();
  });

  it("C, E, F, G, H, I, J, K, L, M: etapa Disponibilidade respeita mockup com fidelidade visual", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Combo Corte + Barba")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Combo Corte + Barba" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // C. Card selecionado de serviço no topo mostra imagem real
    const bannerImgs = screen.getAllByRole("img", { name: "Combo Corte + Barba" });
    expect(bannerImgs.length).toBeGreaterThanOrEqual(1);
    expect(bannerImgs[0]).toHaveAttribute("src", "/uploads/combo-premium.jpg");
    expect(screen.getByRole("button", { name: "Alterar" })).toBeInTheDocument();

    // J. Seções numeradas (1. Escolha a data, 2. Escolha o profissional, 3. Horários disponíveis)
    expect(screen.getByText("1. Escolha a data")).toBeInTheDocument();
    expect(screen.getByText("2. Escolha o profissional")).toBeInTheDocument();
    expect(screen.getByText("3. Horários disponíveis")).toBeInTheDocument();

    // I. Date strip horizontal
    const dateStrip = screen.getByTestId("date-strip");
    expect(dateStrip).toBeInTheDocument();
    expect(dateStrip.className).toContain("flex-row");
    expect(dateStrip.className).toContain("flex-nowrap");
    expect(dateStrip.className).toContain("overflow-x-auto");

    // E & F. Strip horizontal de profissionais com Qualquer disponível em primeiro
    const profStrip = screen.getByTestId("professional-strip");
    expect(profStrip).toBeInTheDocument();
    expect(profStrip.className).toContain("flex-row");
    expect(profStrip.className).toContain("flex-nowrap");
    expect(profStrip.className).toContain("overflow-x-auto");
    expect(profStrip.className).not.toContain("flex-col");
    expect(profStrip.className).not.toContain("flex-wrap");

    const profButtons = profStrip.querySelectorAll("button");
    expect(profButtons.length).toBe(3); // Qualquer, Dandara, Jesus
    expect(profButtons[0]).toHaveTextContent("Qualquer disponível");

    // G. Dandara possui avatar real
    const dandaraImg = profButtons[1].querySelector("img");
    expect(dandaraImg).toHaveAttribute("src", "/uploads/dandara.jpg");

    // H. Jesus sem avatar possui fallback com iniciais
    expect(profButtons[2]).toHaveTextContent("Jesus Aparecido");
    expect(profButtons[2]).toHaveTextContent("JA"); // initials fallback

    // Selecionar primeiro dia na tira
    await user.click(dateStrip.children[0]);

    // K. Turnos agrupados (Manhã, Tarde, Noite)
    expect(await screen.findByText("Manhã")).toBeInTheDocument();
    expect(screen.getByText("Tarde")).toBeInTheDocument();
    expect(screen.getByText("Noite")).toBeInTheDocument();

    // L. Grid compacta de 4 colunas no mobile
    const morningSlotsGrid = screen.getByText("09:00").parentElement;
    expect(morningSlotsGrid?.className).toContain("grid-cols-4");

    // M. Sticky Footer visível com duração e valor total
    expect(screen.getAllByText(/50 min/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/70,00/i).length).toBeGreaterThanOrEqual(1);
  });

  it("D & O: Seus Dados mostra card visual e esconde barbeiro quando ANY", async () => {
    const user = userEvent.setup();
    render(<AgendasPage />);

    expect(await screen.findByText("Combo Corte + Barba")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Combo Corte + Barba" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Seleciona data e horário
    const dateStrip = await screen.findByTestId("date-strip");
    await user.click(dateStrip.children[0]);

    const slot09 = await screen.findByText("09:00");
    await user.click(slot09);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // D. Etapa Seus Dados mostra card visual do serviço com thumbnail
    expect(await screen.findByRole("heading", { name: "Seus dados", level: 2 })).toBeInTheDocument();
    const serviceImg = screen.getByRole("img", { name: "Combo Corte + Barba" });
    expect(serviceImg).toBeInTheDocument();
    expect(serviceImg).toHaveAttribute("src", "/uploads/combo-premium.jpg");

    // O. ANY: Profissional deve exibir estritamente "Qualquer disponível"
    expect(screen.getByText("Qualquer disponível")).toBeInTheDocument();

    // Fill customer data and proceed to Confirm
    const nameInput = screen.getByPlaceholderText("Seu nome");
    const phoneInput = screen.getByPlaceholderText("(11) 99999-9999");
    await user.type(nameInput, "Cliente Teste");
    await user.type(phoneInput, "11988887777");

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Step 3: Confirmar também possui card visual do serviço
    const confirmHeadings = await screen.findAllByText("Confirme seu agendamento");
    expect(confirmHeadings.length).toBeGreaterThanOrEqual(1);
    const confirmServiceImg = screen.getByRole("img", { name: "Combo Corte + Barba" });
    expect(confirmServiceImg).toBeInTheDocument();
    expect(confirmServiceImg).toHaveAttribute("src", "/uploads/combo-premium.jpg");
  });
});
