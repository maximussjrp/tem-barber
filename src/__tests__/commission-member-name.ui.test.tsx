/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import CommissionPaymentsPage from "@/app/admin/comissoes/pagamentos/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/comissoes/pagamentos",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
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

describe("GATE: COMMISSION_HISTORY_MEMBER_NAME_FIX_LOCAL — Validação de Nomes de Profissionais", () => {
  // 4 profissionais com nomes fictícios e papéis OWNER, MANAGER, BARBER, RECEPTIONIST
  const mockTeam = [
    { id: "mem-owner", user: { name: "Arthur Proprietário" }, role: "OWNER", isActive: true },
    { id: "mem-manager", user: { name: "Mariana Gerente" }, role: "MANAGER", isActive: true },
    { id: "mem-barber", user: { name: "Lucas Barbeiro" }, role: "BARBER", isActive: true },
    { id: "mem-receptionist", user: { name: "Fernanda Recepcionista" }, role: "RECEPTIONIST", isActive: true },
  ];

  const mockPayouts = [
    {
      id: "payout-owner",
      cycleId: "cyc-owner",
      memberId: "mem-owner",
      amount: 1500.0,
      paymentMethod: "PIX",
      paidAt: "2026-10-15T10:00:00Z",
      notes: "Liquidação do proprietário",
      createdAt: "2026-10-15T10:00:00Z",
      member: {
        id: "mem-owner",
        name: "Arthur Proprietário",
        role: "OWNER",
        isActive: true,
      },
      cycle: {
        id: "cyc-owner",
        cycleNumber: 1,
        status: "PAID",
        grossCommission: 1500.0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 1500.0,
        remainingBalance: 0,
        openedAt: "2026-09-16T00:00:00Z",
        closedAt: "2026-10-15T10:00:00Z",
        paidAt: "2026-10-15T10:00:00Z",
      },
      createdBy: { id: "adm-1", name: "Sistema" },
    },
    {
      id: "payout-manager",
      cycleId: "cyc-manager",
      memberId: "mem-manager",
      amount: 1200.0,
      paymentMethod: "TRANSFER",
      paidAt: "2026-10-15T11:00:00Z",
      notes: "Liquidação da gerente",
      createdAt: "2026-10-15T11:00:00Z",
      member: {
        id: "mem-manager",
        name: "Mariana Gerente",
        role: "MANAGER",
        isActive: true,
      },
      cycle: {
        id: "cyc-manager",
        cycleNumber: 2,
        status: "PAID",
        grossCommission: 1200.0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 1200.0,
        remainingBalance: 0,
        openedAt: "2026-09-16T00:00:00Z",
        closedAt: "2026-10-15T11:00:00Z",
        paidAt: "2026-10-15T11:00:00Z",
      },
      createdBy: { id: "adm-1", name: "Sistema" },
    },
    {
      id: "payout-barber",
      cycleId: "cyc-barber",
      memberId: "mem-barber",
      amount: 800.0,
      paymentMethod: "PIX",
      paidAt: "2026-10-15T12:00:00Z",
      notes: "Liquidação do barbeiro",
      createdAt: "2026-10-15T12:00:00Z",
      member: {
        id: "mem-barber",
        name: "Lucas Barbeiro",
        role: "BARBER",
        isActive: true,
      },
      cycle: {
        id: "cyc-barber",
        cycleNumber: 3,
        status: "PAID",
        grossCommission: 900.0,
        adjustmentsTotal: 0,
        advancesTotal: 100.0,
        finalPayoutAmount: 800.0,
        remainingBalance: 0,
        openedAt: "2026-09-16T00:00:00Z",
        closedAt: "2026-10-15T12:00:00Z",
        paidAt: "2026-10-15T12:00:00Z",
      },
      createdBy: { id: "adm-1", name: "Sistema" },
    },
    {
      id: "payout-receptionist",
      cycleId: "cyc-receptionist",
      memberId: "mem-receptionist",
      amount: 400.0,
      paymentMethod: "CASH",
      paidAt: "2026-10-15T13:00:00Z",
      notes: "Liquidação da recepcionista",
      createdAt: "2026-10-15T13:00:00Z",
      member: {
        id: "mem-receptionist",
        name: "Fernanda Recepcionista",
        role: "RECEPTIONIST",
        isActive: true,
      },
      cycle: {
        id: "cyc-receptionist",
        cycleNumber: 4,
        status: "PAID",
        grossCommission: 400.0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 400.0,
        remainingBalance: 0,
        openedAt: "2026-09-16T00:00:00Z",
        closedAt: "2026-10-15T13:00:00Z",
        paidAt: "2026-10-15T13:00:00Z",
      },
      createdBy: { id: "adm-1", name: "Sistema" },
    },
  ];

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = typeof url === "string" ? url : url?.url ? url.url : String(url);

      if (urlStr.includes("/api/admin/commissions/overview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            overview: [],
            totalPaidAccumulated: 3900.0,
            totalPayoutsCount: 4,
            historicalSummary: {
              totalPaidAmount: 3900.0,
              totalPayoutsCount: 4,
            },
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/team")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockTeam,
        } as Response;
      }

      if (urlStr.includes("/api/admin/barbershop")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "shop-1", name: "Barbearia Teste" }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/cycles/cyc-owner")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cycle: {
              id: "cyc-owner",
              cycleNumber: 1,
              status: "PAID",
              grossCommission: 1500.0,
              adjustmentsTotal: 0,
              advancesTotal: 0,
              finalPayoutAmount: 1500.0,
              member: {
                id: "mem-owner",
                name: "Arthur Proprietário",
                role: "OWNER",
              },
              payableItems: [],
              adjustments: [],
              advances: [],
            },
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/cycles/cyc-manager")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cycle: {
              id: "cyc-manager",
              cycleNumber: 2,
              status: "PAID",
              grossCommission: 1200.0,
              adjustmentsTotal: 0,
              advancesTotal: 0,
              finalPayoutAmount: 1200.0,
              member: {
                id: "mem-manager",
                name: "Mariana Gerente",
                role: "MANAGER",
              },
              payableItems: [],
              adjustments: [],
              advances: [],
            },
          }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/payouts")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            barbershop: { id: "shop-1", name: "Barbearia Teste" },
            payouts: mockPayouts,
            pagination: {
              page: 1,
              limit: 20,
              totalRecords: 4,
              totalPages: 1,
              hasMore: false,
              isPrintMode: urlStr.includes("format=print"),
            },
            summary: {
              totalPaidAmount: 3900.0,
              totalPayoutsCount: 4,
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Exibe exclusivamente o nome verdadeiro dos profissionais na tabela, sem códigos técnicos (OWNER, MANAGER, BARBER, RECEPTIONIST)", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    // Aguarda carregar os 4 profissionais na tabela
    await waitFor(() => {
      const tbody = document.querySelector("tbody");
      expect(tbody).toBeTruthy();
      expect(within(tbody!).getByText("Arthur Proprietário")).toBeInTheDocument();
      expect(within(tbody!).getByText("Mariana Gerente")).toBeInTheDocument();
      expect(within(tbody!).getByText("Lucas Barbeiro")).toBeInTheDocument();
      expect(within(tbody!).getByText("Fernanda Recepcionista")).toBeInTheDocument();
    });

    // Confirma que os nomes estão na tabela
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(4);

    // Obtém o texto de todas as células da tabela
    const tableBody = document.querySelector("tbody");
    const tableText = tableBody?.textContent || "";

    // Valida que nenhum dos códigos técnicos de cargo aparece na tabela
    expect(tableText).not.toContain("OWNER");
    expect(tableText).not.toContain("MANAGER");
    expect(tableText).not.toContain("BARBER");
    expect(tableText).not.toContain("RECEPTIONIST");
  });

  it("2. Mantém exclusivamente o nome verdadeiro na impressão/PDF sem exibir códigos técnicos", async () => {
    const originalPrint = window.print;
    const printMock = vi.fn();
    window.print = printMock;

    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Imprimir \/ PDF/ })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Imprimir \/ PDF/ }));

    await waitFor(() => {
      expect(printMock).toHaveBeenCalled();
    });

    // Na visualização de impressão preparada, os 4 nomes aparecem na tabela
    const tbody = document.querySelector("tbody");
    expect(tbody).toBeTruthy();
    const withinTbody = within(tbody!);
    expect(withinTbody.getByText("Arthur Proprietário")).toBeInTheDocument();
    expect(withinTbody.getByText("Mariana Gerente")).toBeInTheDocument();
    expect(withinTbody.getByText("Lucas Barbeiro")).toBeInTheDocument();
    expect(withinTbody.getByText("Fernanda Recepcionista")).toBeInTheDocument();

    const tableText = tbody?.textContent || "";

    expect(tableText).not.toContain("OWNER");
    expect(tableText).not.toContain("MANAGER");
    expect(tableText).not.toContain("BARBER");
    expect(tableText).not.toContain("RECEPTIONIST");

    window.print = originalPrint;
  });

  it("3. Modal de detalhes do ciclo exibe apenas o nome cadastrado do colaborador, sem código de cargo", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      const tbody = document.querySelector("tbody");
      expect(tbody).toBeTruthy();
      expect(within(tbody!).getByText("Arthur Proprietário")).toBeInTheDocument();
    });

    // Abre detalhes do ciclo do OWNER (Arthur Proprietário)
    const detailButtons = screen.getAllByRole("button", { name: "Ver Detalhes" });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Detalhamento do Ciclo #1")).toBeInTheDocument();
    });

    // Verifica que exibe "Colaborador: Arthur Proprietário"
    const collaboratorElement = screen.getByText(/Colaborador:/);
    expect(collaboratorElement).toBeInTheDocument();
    expect(collaboratorElement.textContent).toContain("Arthur Proprietário");

    // Garante que "(OWNER)" ou "OWNER" não aparece no cabeçalho do colaborador
    expect(collaboratorElement.textContent).not.toContain("OWNER");
    expect(collaboratorElement.textContent).not.toContain("(OWNER)");
  });
});
