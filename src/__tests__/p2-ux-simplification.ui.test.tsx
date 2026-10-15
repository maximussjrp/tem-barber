/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import MemberDetailPage from "@/app/admin/equipe/[id]/page";
import { CommissionNav } from "@/components/admin/commissions/CommissionNav";
import CommissionConfigsPage from "@/app/admin/comissoes/configuracoes/page";

// Mock next/navigation
const mockRouter = {
  push: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "member-456" }),
  useRouter: () => mockRouter,
  usePathname: () => "/admin/comissoes",
}));

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("TEM BARBER — Gate P2-UX: Simplificação de Comissões", () => {
  let fetchSpy: any;

  const mockMember = {
    id: "member-456",
    role: "BARBER",
    bio: "Barbeiro Sênior",
    isActive: true,
    ratingAvg: 4.9,
    careerLevelId: "lvl-prof",
    careerLevel: { id: "lvl-prof", name: "Profissional", defaultCommissionRate: 40 },
    user: {
      id: "user-456",
      name: "Lucas Barbeiro",
      email: "lucas@barbearia.com",
      phone: "11988887777",
      cpf: "98765432100",
      avatarUrl: null,
    },
    workingHours: [],
    services: [{ service: { id: "srv-101", name: "Corte Masculino", price: "50.00" } }],
    timeOffs: [],
  };

  const mockCommissionSettingsData = {
    memberId: "member-456",
    memberName: "Lucas Barbeiro",
    role: "BARBER",
    careerLevelId: "lvl-prof",
    careerLevelName: "Profissional",
    careerLevels: [
      { id: "lvl-iniciante", name: "Iniciante", defaultCommissionRate: 30, sortOrder: 1 },
      { id: "lvl-prof", name: "Profissional", defaultCommissionRate: 40, sortOrder: 2 },
      { id: "lvl-senior", name: "Sênior", defaultCommissionRate: 50, sortOrder: 3 },
    ],
    isCommissionEligible: true,
    memberDefaultRule: {
      effective: {
        type: "PERCENTAGE",
        value: 40,
        origin: "CAREER_LEVEL_DEFAULT",
        isCustomized: false,
      },
      individualRule: null,
      inheritedDefault: {
        type: "PERCENTAGE",
        value: 40,
        origin: "CAREER_LEVEL_DEFAULT",
      },
    },
    categories: [
      { id: "cat-cabelo", name: "Cabelo" },
      { id: "cat-barba", name: "Barba" },
      { id: "cat-quimica", name: "Química & Barboterapia" },
    ],
    selectedServiceIds: ["srv-101", "srv-102"],
    services: [
      {
        id: "srv-101",
        name: "Corte Masculino",
        categoryId: "cat-cabelo",
        categoryName: "Cabelo",
        price: "50.00",
        isSelected: true,
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 40,
          origin: "MEMBER_DEFAULT",
          configId: null,
          isCustomized: false,
        },
        individualRule: null,
      },
      {
        id: "srv-102",
        name: "Barba Desenhada",
        categoryId: "cat-barba",
        categoryName: "Barba",
        price: "35.00",
        isSelected: true,
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 45,
          origin: "MEMBER_SERVICE",
          configId: "cfg-srv-102",
          isCustomized: true,
        },
        individualRule: {
          id: "cfg-srv-102",
          type: "PERCENTAGE",
          value: 45,
          active: true,
        },
      },
    ],
    categoryRules: [
      {
        id: "cfg-cat-1",
        categoryId: "cat-quimica",
        categoryName: "Química & Barboterapia",
        type: "PERCENTAGE",
        value: 35,
        active: true,
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
        name: "Pomada Matte",
        salePrice: "60.00",
        effectiveCommission: {
          type: "PERCENTAGE",
          value: 10,
          origin: "BARBERSHOP_DEFAULT",
          configId: null,
          isCustomized: false,
        },
        individualRule: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    fetchSpy = vi.fn((url: string, init?: any) => {
      // 1. Perfil do membro
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockMember),
        });
      }

      // 2. Serviços gerais
      if (url === "/api/admin/services" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { id: "srv-101", name: "Corte Masculino", price: "50.00", category: { id: "cat-cabelo", name: "Cabelo" } },
              { id: "srv-102", name: "Barba Desenhada", price: "35.00", category: { id: "cat-barba", name: "Barba" } },
            ]),
        });
      }

      // 3. Níveis de carreira
      if (url === "/api/admin/career-levels" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { id: "lvl-iniciante", name: "Iniciante", defaultCommissionRate: "30", sortOrder: 1, active: true },
              { id: "lvl-prof", name: "Profissional", defaultCommissionRate: "40", sortOrder: 2, active: true },
              { id: "lvl-senior", name: "Sênior", defaultCommissionRate: "50", sortOrder: 3, active: true },
            ]),
        });
      }

      // 4. Configurações de comissão do membro
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCommissionSettingsData),
        });
      }

      // 5. Salvamento PUT
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });
      }

      // 6. Matriz e configs gerais
      if (url.includes("/api/admin/commissions/configs")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ configs: [], members: [], services: [], categories: [] }),
        });
      }

      if (url.includes("/api/admin/commissions/matrix")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ services: [], careerLevels: [], matrix: [] }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      });
    });

    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Carregamento da aba com comissão padrão do colaborador exibida", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("member-default-commission-section")).toBeInTheDocument();
      expect(screen.getByTestId("member-default-rate")).toHaveTextContent("40%");
      expect(screen.getByTestId("member-default-origin")).toHaveTextContent("Regra de Carreira");
    });
  });

  it("2. Aplicação de modelo rápido preenche campo e mostra feedback sem salvar", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    const seniorPreset = screen.getByRole("button", { name: "Sênior (50%)" });
    fireEvent.click(seniorPreset);

    // O campo de taxa padrão passa a exibir 50%
    expect(screen.getByTestId("member-default-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("member-default-origin")).toHaveTextContent("Padrão Individual (não salvo)");
    expect(screen.getByText(/Modelo "Sênior" aplicado no rascunho/i)).toBeInTheDocument();

    // NÃO houve chamada PUT
    const putCalls = fetchSpy.mock.calls.filter((c: any[]) => c[1]?.method === "PUT");
    expect(putCalls.length).toBe(0);
  });

  it("3. Confirmação do modelo rápido ao clicar em Salvar envia payload com memberDefaultRule", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    const seniorPreset = screen.getByRole("button", { name: "Sênior (50%)" });
    fireEvent.click(seniorPreset);

    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.memberDefaultRule).toEqual({
        type: "PERCENTAGE",
        value: 50,
        active: true,
      });
    });
  });

  it("4. Presets baseados nos CareerLevels existentes são exibidos e funcionais", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    // Nível Iniciante (30%) vindo de careerLevels
    const clPreset = screen.getByRole("button", { name: "Nível Iniciante (30%)" });
    expect(clPreset).toBeInTheDocument();

    fireEvent.click(clPreset);
    expect(screen.getByTestId("member-default-rate")).toHaveTextContent("30%");
  });

  it("5. Botão 'Sobrescrever serviços selecionados' pede confirmação com contagem e aplica apenas aos selecionados", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    // Aplica preset 50%
    fireEvent.click(screen.getByRole("button", { name: "Sênior (50%)" }));

    // Botão de sobrescrever serviços selecionados aparece
    const applyBtn = screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(50%\)/i });
    expect(applyBtn).toBeInTheDocument();

    fireEvent.click(applyBtn);

    // Confirmação exibida com quantidade (2 serviços selecionados) e taxa (50%)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("2 serviço(s) selecionado(s)"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("50%"));

    expect(screen.getByText(/Taxa de 50% aplicada a 2 serviço\(s\) selecionado\(s\) no rascunho/i)).toBeInTheDocument();

    // Salva e verifica que os serviços selecionados recebem 50%
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.serviceRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ serviceId: "srv-101", value: 50, type: "PERCENTAGE" }),
          expect.objectContaining({ serviceId: "srv-102", value: 50, type: "PERCENTAGE" }),
        ])
      );
    });
  });

  it("5b. Cancelamento na confirmação de sobrescrita em massa preserva os rascunhos inalterados", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Sênior (50%)" }));

    const applyBtn = screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(50%\)/i });
    fireEvent.click(applyBtn);

    expect(confirmSpy).toHaveBeenCalled();
    // Mensagem de sucesso NÃO deve aparecer
    expect(screen.queryByText(/aplicada a 2 serviço/i)).not.toBeInTheDocument();

    // O serviço srv-102 mantém seus 45% originais do mock
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("5c. Preserva tipo de comissão FIXED_VALUE (R$ 15,00) sem converter para %", async () => {
    const fixedValueData = {
      ...mockCommissionSettingsData,
      memberDefaultRule: {
        effective: { type: "FIXED_VALUE", value: 15, origin: "MEMBER_DEFAULT", isCustomized: true },
        individualRule: { id: "cfg-fixed", type: "FIXED_VALUE", value: 15, active: true },
        inheritedDefault: { type: "PERCENTAGE", value: 40, origin: "CAREER_LEVEL_DEFAULT" },
      },
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fixedValueData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      // O botão deve formatar em R$ 15,00, NÃO 15%
      expect(screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(R\$ 15,00\)/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(R\$ 15,00\)/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("R$ 15,00"));

    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.serviceRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ serviceId: "srv-101", value: 15, type: "FIXED_VALUE" }),
          expect.objectContaining({ serviceId: "srv-102", value: 15, type: "FIXED_VALUE" }),
        ])
      );
    });
  });

  it("5d. Sobrescrever serviços selecionados afeta somente serviços marcados, ignorando não selecionados", async () => {
    const dataWithUnselected = {
      ...mockCommissionSettingsData,
      selectedServiceIds: ["srv-101", "srv-102"],
      services: [
        ...mockCommissionSettingsData.services,
        {
          id: "srv-103",
          name: "Sobrancelha",
          categoryId: "cat-barba",
          categoryName: "Barba",
          price: "25.00",
          isSelected: false,
          effectiveCommission: {
            type: "PERCENTAGE",
            value: 40,
            origin: "MEMBER_DEFAULT",
            configId: null,
            isCustomized: false,
          },
          individualRule: null,
        },
      ],
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(dataWithUnselected) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("commission-presets-section")).toBeInTheDocument());

    // Aplica preset Sênior (50%)
    fireEvent.click(screen.getByRole("button", { name: "Sênior (50%)" }));

    const applyBtn = screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(50%\)/i });
    fireEvent.click(applyBtn);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("2 serviço(s) selecionado(s)"));

    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.serviceRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ serviceId: "srv-101", value: 50, type: "PERCENTAGE" }),
          expect.objectContaining({ serviceId: "srv-102", value: 50, type: "PERCENTAGE" }),
        ])
      );
      expect(payload.serviceRules.some((r: any) => r.serviceId === "srv-103")).toBe(false);
    });
  });

  it("6. Restauração do padrão do colaborador apresenta prévia imediata do herdado e envia memberDefaultRule null", async () => {
    const customData = {
      ...mockCommissionSettingsData,
      memberDefaultRule: {
        effective: { type: "PERCENTAGE", value: 48, origin: "MEMBER_DEFAULT", isCustomized: true },
        individualRule: { id: "cfg-mem-def", type: "PERCENTAGE", value: 48, active: true },
        inheritedDefault: { type: "PERCENTAGE", value: 40, origin: "CAREER_LEVEL_DEFAULT" },
      },
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(customData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("member-default-rate")).toHaveTextContent("48%");
      expect(screen.getByTestId("restore-member-default-btn")).toBeInTheDocument();
    });

    // Clica em restaurar
    fireEvent.click(screen.getByTestId("restore-member-default-btn"));

    // Prévia imediata: o valor deve mudar para 40% (herdado da carreira) e a origem indicar a restauração
    expect(screen.getByTestId("member-default-rate")).toHaveTextContent("40%");
    expect(screen.getByTestId("member-default-origin")).toHaveTextContent("Padrão do Nível de Carreira (após salvar)");

    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.memberDefaultRule).toBeNull();
    });
  });

  it("6b. Sequência de restauração seguida de sobrescrita em massa aplica o valor herdado (40%) e não o obsoleto (48%)", async () => {
    const customData = {
      ...mockCommissionSettingsData,
      memberDefaultRule: {
        effective: { type: "PERCENTAGE", value: 48, origin: "MEMBER_DEFAULT", isCustomized: true },
        individualRule: { id: "cfg-mem-def", type: "PERCENTAGE", value: 48, active: true },
        inheritedDefault: { type: "PERCENTAGE", value: 40, origin: "CAREER_LEVEL_DEFAULT" },
      },
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(customData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("member-default-rate")).toHaveTextContent("48%");
      expect(screen.getByTestId("restore-member-default-btn")).toBeInTheDocument();
    });

    // 1. Clica em restaurar padrão do colaborador (48% -> herdado 40%)
    fireEvent.click(screen.getByTestId("restore-member-default-btn"));

    // O preview mostra 40%
    expect(screen.getByTestId("member-default-rate")).toHaveTextContent("40%");

    // O botão de sobrescrever serviços deve refletir 40% (e NÃO os 48% antigos)
    const applyBtn = screen.getByRole("button", { name: /Sobrescrever serviços selecionados \(40%\)/i });
    expect(applyBtn).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sobrescrever serviços selecionados \(48%\)/i })).not.toBeInTheDocument();

    // 2. Aciona a sobrescrita em massa
    fireEvent.click(applyBtn);

    // Confirmação deve conter 40%
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("40%"));
    expect(confirmSpy).not.toHaveBeenCalledWith(expect.stringContaining("48%"));

    // 3. Salva e verifica o payload PUT
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.memberDefaultRule).toBeNull();
      expect(payload.serviceRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ serviceId: "srv-101", value: 40, type: "PERCENTAGE" }),
          expect.objectContaining({ serviceId: "srv-102", value: 40, type: "PERCENTAGE" }),
        ])
      );
      expect(payload.serviceRules.some((r: any) => r.value === 48)).toBe(false);
    });
  });

  it("7. Seção de configurações adicionais permite editar, adicionar exceção por categoria e restaurar", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("additional-configs-section")).toBeInTheDocument());

    // Expande a seção adicional
    fireEvent.click(screen.getByRole("button", { name: /Configurações Adicionais & Histórico/i }));

    expect(screen.getByText("Química & Barboterapia")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();

    // 1. Edição inline da regra de categoria existente
    const editBtn = screen.getByTestId("edit-category-rule-cat-quimica");
    fireEvent.click(editBtn);

    const editInput = screen.getByTestId("input-category-rule-cat-quimica");
    fireEvent.change(editInput, { target: { value: "38" } });

    const doneBtn = screen.getByTestId("done-edit-category-rule-cat-quimica");
    fireEvent.click(doneBtn);

    // 2. Adiciona nova exceção de categoria
    const addCatBtn = screen.getByTestId("add-category-rule-btn");
    fireEvent.click(addCatBtn);

    const catSelect = screen.getByTestId("select-new-category");
    fireEvent.change(catSelect, { target: { value: "cat-cabelo" } });

    const catValueInput = screen.getByTestId("input-new-category-value");
    fireEvent.change(catValueInput, { target: { value: "42" } });

    const confirmAddBtn = screen.getByTestId("confirm-add-category-rule-btn");
    fireEvent.click(confirmAddBtn);

    // Salva e verifica que categoryRules foi enviado com a nova e a editada
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.categoryRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ categoryId: "cat-quimica", value: 38, type: "PERCENTAGE" }),
          expect.objectContaining({ categoryId: "cat-cabelo", value: 42, type: "PERCENTAGE" }),
        ])
      );
    });
  });

  it("7b. Regra de categoria inativa exibe badge [Inativa] e não é reativada por salvamentos não relacionados", async () => {
    const inactiveCategoryData = {
      ...mockCommissionSettingsData,
      categoryRules: [
        {
          id: "cfg-cat-inactive",
          categoryId: "cat-quimica",
          categoryName: "Química & Barboterapia",
          type: "PERCENTAGE",
          value: 35,
          active: false,
        },
      ],
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(inactiveCategoryData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("additional-configs-section")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Configurações Adicionais & Histórico/i }));

    // Regra inativa é exibida com badge e botão de reativar
    expect(screen.getByTestId("badge-inactive-category-cat-quimica")).toHaveTextContent("Inativa");
    expect(screen.getByTestId("reactivate-category-rule-cat-quimica")).toBeInTheDocument();

    // Aplica um modelo rápido (alteração não relacionada)
    fireEvent.click(screen.getByRole("button", { name: "Sênior (50%)" }));

    // Salva
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      // categoryRules NÃO deve ser enviado (regra inativa permaneceu intocada)
      expect(payload.categoryRules).toBeUndefined();
    });
  });

  it("7c. Usuário pode reativar conscientemente uma regra de categoria inativa", async () => {
    const inactiveCategoryData = {
      ...mockCommissionSettingsData,
      categoryRules: [
        {
          id: "cfg-cat-inactive",
          categoryId: "cat-quimica",
          categoryName: "Química & Barboterapia",
          type: "PERCENTAGE",
          value: 35,
          active: false,
        },
      ],
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(inactiveCategoryData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("additional-configs-section")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Configurações Adicionais & Histórico/i }));

    // Clica no botão Reativar regra
    const reactivateBtn = screen.getByTestId("reactivate-category-rule-cat-quimica");
    fireEvent.click(reactivateBtn);

    // Campo de edição é aberto; altera para 39%
    const input = screen.getByTestId("input-category-rule-cat-quimica");
    fireEvent.change(input, { target: { value: "39" } });
    fireEvent.click(screen.getByTestId("done-edit-category-rule-cat-quimica"));

    // Salva
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      expect(payload.categoryRules).toEqual([
        expect.objectContaining({
          categoryId: "cat-quimica",
          value: 39,
          type: "PERCENTAGE",
          active: true,
        }),
      ]);
    });
  });

  it("7d. Categoria com regra inativa não aparece no seletor de nova exceção e bloqueia criação indireta, permitindo apenas categorias sem regra prévia", async () => {
    const inactiveCategoryData = {
      ...mockCommissionSettingsData,
      categoryRules: [
        {
          id: "cfg-cat-inactive",
          categoryId: "cat-quimica",
          categoryName: "Química & Barboterapia",
          type: "PERCENTAGE",
          value: 35,
          active: false,
        },
      ],
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(inactiveCategoryData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockMember) });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/team/member-456/commission-settings" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("additional-configs-section")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Configurações Adicionais & Histórico/i }));

    // Categoria inativa está na seção de inativas com seu badge
    expect(screen.getByTestId("badge-inactive-category-cat-quimica")).toHaveTextContent("Inativa");

    // Abre o formulário de adicionar nova exceção
    fireEvent.click(screen.getByTestId("add-category-rule-btn"));

    // O seletor NÃO deve listar Química & Barboterapia (cat-quimica)
    const select = screen.getByTestId("select-new-category");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).not.toContain("Química & Barboterapia");
    expect(options).toContain("Cabelo");
    expect(options).toContain("Barba");

    // Adiciona uma categoria válida sem regra prévia (Barba)
    fireEvent.change(select, { target: { value: "cat-barba" } });
    const valInput = screen.getByTestId("input-new-category-value");
    fireEvent.change(valInput, { target: { value: "32" } });
    fireEvent.click(screen.getByTestId("confirm-add-category-rule-btn"));

    // Salva
    const saveBtn = screen.getByRole("button", { name: "Salvar Serviços e Comissões" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c: any[]) =>
          c[0] === "/api/admin/team/member-456/commission-settings" && c[1]?.method === "PUT"
      );
      expect(putCalls.length).toBe(1);
      const payload = JSON.parse(putCalls[0][1].body);
      // Contém apenas cat-barba e NÃO contém cat-quimica
      expect(payload.categoryRules).toEqual([
        expect.objectContaining({
          categoryId: "cat-barba",
          value: 32,
          type: "PERCENTAGE",
          active: true,
        }),
      ]);
      expect(payload.categoryRules.some((r: any) => r.categoryId === "cat-quimica")).toBe(false);
    });
  });

  it("8. Nível de carreira vinculado é exibido na seção adicional com link para gestão", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => expect(screen.getByTestId("additional-configs-section")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Configurações Adicionais & Histórico/i }));

    expect(screen.getByText("Profissional")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Gerenciar Níveis de Carreira/i });
    expect(link).toHaveAttribute("href", "/admin/comissoes/configuracoes");
  });

  it("9. CommissionNav exibe apenas 'Visão Geral', 'Pagamento de Comissões' e link para Equipe", () => {
    render(<CommissionNav />);
    expect(screen.getByText("Visão Geral")).toBeInTheDocument();
    expect(screen.getByText("Pagamento de Comissões")).toBeInTheDocument();
    expect(screen.getByText(/Configurar comissões da equipe/i)).toBeInTheDocument();
    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
  });

  it("10. Página de configurações exibe banner recomendando fluxo em Equipe", () => {
    render(<CommissionConfigsPage />);
    expect(screen.getByTestId("simplified-flow-banner")).toBeInTheDocument();
    expect(screen.getByText(/Recomendação:/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ir para Equipe/i });
    expect(link).toHaveAttribute("href", "/admin/equipe");
  });

  it("11. Colaborador sem nível de carreira herda padrão geral da barbearia", async () => {
    const barbershopFallbackData = {
      ...mockCommissionSettingsData,
      careerLevelId: null,
      careerLevelName: null,
      memberDefaultRule: {
        effective: {
          type: "PERCENTAGE",
          value: 35,
          origin: "BARBERSHOP_DEFAULT",
          isCustomized: false,
        },
        individualRule: null,
        inheritedDefault: {
          type: "PERCENTAGE",
          value: 35,
          origin: "BARBERSHOP_DEFAULT",
        },
      },
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(barbershopFallbackData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockMember, careerLevelId: null, careerLevel: null }),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("member-default-commission-section")).toBeInTheDocument();
      expect(screen.getByTestId("member-default-rate")).toHaveTextContent("35%");
      expect(screen.getByTestId("member-default-origin")).toHaveTextContent("Padrão da Barbearia");
    });
  });

  it("11b. Colaborador vinculado a carreira inativa herda o padrão geral da barbearia", async () => {
    const inactiveCareerData = {
      ...mockCommissionSettingsData,
      careerLevelId: "lvl-inactive",
      careerLevelName: "Nível Antigo (Inativo)",
      memberDefaultRule: {
        effective: {
          type: "PERCENTAGE",
          value: 35,
          origin: "BARBERSHOP_DEFAULT",
          isCustomized: false,
        },
        individualRule: null,
        inheritedDefault: {
          type: "PERCENTAGE",
          value: 35,
          origin: "BARBERSHOP_DEFAULT",
        },
      },
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/team/member-456/commission-settings" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(inactiveCareerData) });
      }
      if (url === "/api/admin/team/member-456" && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockMember),
        });
      }
      if (url === "/api/admin/services") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url === "/api/admin/career-levels") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Lucas Barbeiro")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Serviços e Comissões" }));

    await waitFor(() => {
      expect(screen.getByTestId("member-default-commission-section")).toBeInTheDocument();
      expect(screen.getByTestId("member-default-rate")).toHaveTextContent("35%");
      expect(screen.getByTestId("member-default-origin")).toHaveTextContent("Padrão da Barbearia");
    });
  });
});
