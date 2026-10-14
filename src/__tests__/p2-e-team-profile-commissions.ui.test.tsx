/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import MemberDetailPage from "@/app/admin/equipe/[id]/page";

// Mock next/navigation
const mockRouter = {
  push: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "member-123" }),
  useRouter: () => mockRouter,
}));

describe("TEM BARBER — Gate P2-E: Interface de Serviços e Comissões no Perfil", () => {
  let fetchSpy: any;

  const mockMember = {
    id: "member-123",
    role: "BARBER",
    bio: "Barbeiro especialista",
    isActive: true,
    ratingAvg: 4.8,
    careerLevelId: "lvl-1",
    careerLevel: { id: "lvl-1", name: "Sênior" },
    user: {
      id: "user-123",
      name: "Carlos Barbeiro",
      email: "carlos@barbearia.com",
      phone: "11999998888",
      cpf: "12345678900",
      avatarUrl: null,
    },
    workingHours: [],
    services: [{ service: { id: "srv-1", name: "Corte Tradicional", price: "40.00" } }],
    timeOffs: [],
  };

  const mockAvailableServices = [
    {
      id: "srv-1",
      name: "Corte Tradicional",
      price: "40.00",
      category: { id: "cat-1", name: "Cabelo" },
    },
    {
      id: "srv-2",
      name: "Barba Terapia",
      price: "35.00",
      category: { id: "cat-2", name: "Barba" },
    },
  ];

  const mockCommissionSettingsData = {
    memberId: "member-123",
    memberName: "Carlos Barbeiro",
    role: "BARBER",
    careerLevelId: "lvl-1",
    careerLevelName: "Sênior",
    isCommissionEligible: true,
    selectedServiceIds: ["srv-1"],
    services: [
      {
        id: "srv-1",
        name: "Corte Tradicional",
        categoryId: "cat-1",
        categoryName: "Cabelo",
        price: "40.00",
        isSelected: true,
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 40,
          origin: "CAREER_LEVEL_SERVICE",
          configId: "cfg-car-1",
          isCustomized: false,
        },
        individualRule: null,
      },
      {
        id: "srv-2",
        name: "Barba Terapia",
        categoryId: "cat-2",
        categoryName: "Barba",
        price: "35.00",
        isSelected: false,
        effectiveCommission: {
          type: "FIXED_VALUE",
          value: 15,
          origin: "MEMBER_SERVICE",
          configId: "cfg-srv-2",
          isCustomized: true,
        },
        individualRule: {
          id: "cfg-srv-2",
          type: "FIXED_VALUE",
          value: 15,
          active: true,
        },
      },
    ],
    productDefaultRule: {
      effective: {
        type: "PERCENTAGE",
        value: 10,
        origin: "BARBERSHOP_DEFAULT",
        isCustomized: false,
      },
      individualRule: null,
    },
    products: [
      {
        id: "prod-1",
        name: "Pomada Modeladora",
        salePrice: "50.00",
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 10,
          origin: "PRODUCT_DEFAULT",
          configId: null,
          isCustomized: false,
        },
        individualRule: null,
      },
      {
        id: "prod-2",
        name: "Óleo para Barba",
        salePrice: "45.00",
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 20,
          origin: "MEMBER_PRODUCT",
          configId: "cfg-prod-2",
          isCustomized: true,
        },
        individualRule: {
          id: "cfg-prod-2",
          type: "PERCENTAGE",
          value: 20,
          active: true,
        },
      },
    ],
    serviceExceptions: [],
    productExceptions: [],
  };

  beforeEach(() => {
    fetchSpy = vi.fn((url: string, options?: any) => {
      if (url === "/api/admin/team/member-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockMember),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAvailableServices),
        });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "lvl-1", name: "Sênior" }]),
        });
      }
      if (url === "/api/admin/team/member-123/commission-settings") {
        if (options?.method === "PUT") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCommissionSettingsData),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. A aba aparece como "Serviços e Comissões"
  it("1. A aba aparece com o rótulo 'Serviços e Comissões'", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());

    const tabButton = screen.getByRole("button", { name: "Serviços e Comissões" });
    expect(tabButton).toBeInTheDocument();
  });

  // 2. Serviços selecionados são carregados corretamente
  it("2. Serviços selecionados são carregados e exibidos corretamente na aba", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());

    const tabButton = screen.getByRole("button", { name: "Serviços e Comissões" });
    fireEvent.click(tabButton);

    await waitFor(() => {
      expect(screen.getByTestId("services-and-commissions-tab")).toBeInTheDocument();
      expect(screen.getByText("Corte Tradicional")).toBeInTheDocument();
      expect(screen.getByText("Barba Terapia")).toBeInTheDocument();
    });

    const corteCheckbox = await screen.findByTitle("Realiza Corte Tradicional");
    expect(corteCheckbox).toBeChecked();

    const barbaCheckbox = await screen.findByTitle("Realiza Barba Terapia");
    expect(barbaCheckbox).not.toBeChecked();
  });

  // 3. Comissão herdada aparece com sua origem
  it("3. Comissão herdada aparece com sua origem ('Regra de Carreira')", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByText("40%")).toBeInTheDocument();
      expect(screen.getByText("Regra de Carreira")).toBeInTheDocument();
    });
  });

  // 4. Personalização de percentual funciona
  it("4. Personalização de percentual de comissão funciona e abre painel inline", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Corte Tradicional")).toBeInTheDocument());

    const customizeButtons = screen.getAllByRole("button", { name: "Personalizar comissão" });
    fireEvent.click(customizeButtons[0]);

    const valueInput = screen.getByRole("spinbutton", { name: "Valor da comissão" });
    expect(valueInput).toHaveValue(40);

    fireEvent.change(valueInput, { target: { value: "45" } });
    expect(valueInput).toHaveValue(45);

    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  // 5. Comissão FIXED_VALUE é apresentada corretamente
  it("5. Comissão com FIXED_VALUE é apresentada corretamente com R$", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByText("R$ 15,00")).toBeInTheDocument();
      expect(screen.getAllByText("Exceção Individual").length).toBeGreaterThan(0);
    });
  });

  // 6. Personalização de 0% funciona
  it("6. Personalização de 0% é tratada como valor válido e não como ausência", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Corte Tradicional")).toBeInTheDocument());

    const customizeButtons = screen.getAllByRole("button", { name: "Personalizar comissão" });
    fireEvent.click(customizeButtons[0]);

    const valueInput = screen.getByRole("spinbutton", { name: "Valor da comissão" });
    fireEvent.change(valueInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  // 7. Restaurar padrão remove somente a exceção individual e envia individualRule.id no PUT
  it("7. Ação de Restaurar padrão remove somente a exceção individual e envia individualRule.id no PUT", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Barba Terapia")).toBeInTheDocument());

    // Barba Terapia possui exceção ativa (id: "cfg-srv-2"), portanto tem o botão 'Restaurar padrão'
    const restoreButtons = screen.getAllByRole("button", { name: "Restaurar padrão" });
    expect(restoreButtons.length).toBeGreaterThan(0);

    fireEvent.click(restoreButtons[0]);
    // Ao clicar em restaurar, a origem exibida vira Padrão Herdado
    expect(screen.getByText("Padrão Herdado")).toBeInTheDocument();

    // Clicar em Salvar Serviços e Comissões
    const saveButton = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (call: any[]) =>
          call[0] === "/api/admin/team/member-123/commission-settings" &&
          call[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const body = JSON.parse(putCalls[0][1].body);
      expect(body.removeServiceRuleIds).toEqual(["cfg-srv-2"]);
    });
  });

  // 8. Comissão padrão de produtos é carregada
  it("8. Comissão padrão de produtos é carregada com origem do tenant", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByText("Comissão Padrão de Produtos")).toBeInTheDocument();
      expect(screen.getAllByText("Padrão da Barbearia").length).toBeGreaterThan(0);
    });
  });

  // 9. Personalização por produto funciona
  it("9. Personalização individual por produto específico funciona", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Pomada Modeladora")).toBeInTheDocument());

    const customizeButtons = screen.getAllByRole("button", { name: "Personalizar comissão" });
    // O último botão de personalizar comissão corresponde ao produto Pomada Modeladora
    const pomadaBtn = customizeButtons[customizeButtons.length - 1];
    fireEvent.click(pomadaBtn);

    const valueInput = screen.getByRole("spinbutton", { name: "Valor da comissão do produto" });
    fireEvent.change(valueInput, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  // 10. Restauração de produto funciona e envia individualRule.id no PUT
  it("10. Restauração de exceção individual de produto funciona e envia individualRule.id no PUT", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Óleo para Barba")).toBeInTheDocument());

    // Óleo para Barba tem exceção individual pré-configurada (id: "cfg-prod-2")
    const restoreButtons = screen.getAllByRole("button", { name: "Restaurar padrão" });
    const productRestoreBtn = restoreButtons[restoreButtons.length - 1];
    fireEvent.click(productRestoreBtn);

    expect(screen.getByText("Regra Padrão")).toBeInTheDocument();

    // Clicar em Salvar Serviços e Comissões
    const saveButton = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (call: any[]) =>
          call[0] === "/api/admin/team/member-123/commission-settings" &&
          call[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const body = JSON.parse(putCalls[0][1].body);
      expect(body.removeProductRuleIds).toEqual(["cfg-prod-2"]);
    });
  });

  // 11. Elegibilidade do profissional pode ser alterada
  it("11. Controle 'Recebe comissão?' alterna o estado de elegibilidade", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Elegibilidade de Comissão")).toBeInTheDocument());

    const switchInput = screen.getByRole("switch", { name: "Recebe comissão?" });
    expect(switchInput).toBeChecked();

    fireEvent.click(switchInput);
    expect(switchInput).not.toBeChecked();
  });

  // 12. OWNER desativado é exibido corretamente
  it("12. OWNER desativado exibe toggle desmarcado e aviso de preservação", async () => {
    const ownerData = {
      ...mockCommissionSettingsData,
      role: "OWNER",
      isCommissionEligible: false,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/admin/team/member-123/commission-settings") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(ownerData),
        });
      }
      if (url === "/api/admin/team/member-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockMember, role: "OWNER" }),
        });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "lvl-1", name: "Sênior" }]),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAvailableServices),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      const switchInput = screen.getByRole("switch", { name: "Recebe comissão?" });
      expect(switchInput).not.toBeChecked();
      expect(
        screen.getByText(
          "Essa alteração vale para novos atendimentos e vendas. Comissões já reconhecidas são preservadas."
        )
      ).toBeInTheDocument();
    });
  });

  // 13. MANAGER sem autorização (403) não vê controles financeiros (fallback)
  it("13. MANAGER sem permissão financeira (403) acessa fallback de serviços sem controles de comissão", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/admin/team/member-123/commission-settings") {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: "Acesso negado." }),
        });
      }
      if (url === "/api/admin/team/member-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockMember),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAvailableServices),
        });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "lvl-1", name: "Sênior" }]),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("fallback-legacy-services")).toBeInTheDocument();
      expect(screen.queryByTestId("eligibility-section")).not.toBeInTheDocument();
      expect(screen.queryByTestId("products-section")).not.toBeInTheDocument();
    });
  });

  // 14. Salvamento autorizado utiliza uma única chamada PUT
  it("14. O salvamento autorizado utiliza uma única chamada PUT atômica", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Corte Tradicional")).toBeInTheDocument());

    // Alterar elegibilidade
    const switchInput = screen.getByRole("switch", { name: "Recebe comissão?" });
    fireEvent.click(switchInput);

    // Clicar em salvar
    const saveButton = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (call: any[]) =>
          call[0] === "/api/admin/team/member-123/commission-settings" &&
          call[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const body = JSON.parse(putCalls[0][1].body);
      expect(body.isCommissionEligible).toBe(false);
    });
  });

  // 15. Falha da API mantém os dados preenchidos
  it("15. Falha da API mantém os dados digitados e exibe erro retornado", async () => {
    fetchSpy.mockImplementation((url: string, options?: any) => {
      if (
        url === "/api/admin/team/member-123/commission-settings" &&
        options?.method === "PUT"
      ) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({ error: "Falha na validação das comissões." }),
        });
      }
      if (url === "/api/admin/team/member-123/commission-settings") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCommissionSettingsData),
        });
      }
      if (url === "/api/admin/team/member-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockMember),
        });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "lvl-1", name: "Sênior" }]),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAvailableServices),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByText("Corte Tradicional")).toBeInTheDocument());

    const switchInput = screen.getByRole("switch", { name: "Recebe comissão?" });
    fireEvent.click(switchInput);

    const saveButton = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Falha na validação das comissões/i)).toBeInTheDocument();
      // O input permanece desmarcado (dados preservados)
      expect(switchInput).not.toBeChecked();
    });
  });

  // 16. Nenhuma outra aba do perfil é afetada
  it("16. As demais abas (Perfil, Acesso, Horários, Folgas) continuam acessíveis e funcionais", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument());

    // Tab Horários
    fireEvent.click(screen.getByRole("button", { name: "Horários" }));
    expect(screen.getByText("Segunda-feira")).toBeInTheDocument();

    // Tab Folgas
    fireEvent.click(screen.getByRole("button", { name: "Folgas" }));
    expect(screen.getByText("Registrar Folga / Ausência")).toBeInTheDocument();

    // Tab Acesso
    fireEvent.click(screen.getByRole("button", { name: "Acesso" }));
    expect(screen.getByText("Controle de Permissões Granulares")).toBeInTheDocument();

    // Tab Perfil
    fireEvent.click(screen.getByRole("button", { name: "Perfil" }));
    expect(screen.getByText("Dados Pessoais & Cadastrais")).toBeInTheDocument();
  });
});
