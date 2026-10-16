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

describe("GATE: COMMISSION_HISTORY_PRINT_CONTRAST_FIX_LOCAL — Validação de Contraste e Legibilidade do PDF", () => {
  const mockTeam = [
    { id: "mem-1", user: { name: "Carlos Barbeiro" }, role: "BARBER", isActive: true },
    { id: "mem-2", user: { name: "Marcos Inativo" }, role: "BARBER", isActive: false },
  ];

  const mockPayouts = [
    {
      id: "payout-1",
      cycleId: "cyc-1",
      memberId: "mem-1",
      amount: 850.5,
      paymentMethod: "PIX",
      paidAt: "2026-10-15T14:30:00Z",
      notes: "Acerto quinzenal",
      createdAt: "2026-10-15T14:30:00Z",
      member: {
        id: "mem-1",
        name: "Carlos Barbeiro",
        role: "BARBER",
        isActive: true,
      },
      cycle: {
        id: "cyc-1",
        cycleNumber: 3,
        status: "PAID",
        grossCommission: 1050.5,
        adjustmentsTotal: 0,
        advancesTotal: 200.0,
        finalPayoutAmount: 850.5,
        remainingBalance: 0,
        openedAt: "2026-10-01T00:00:00Z",
        closedAt: "2026-10-15T14:30:00Z",
        paidAt: "2026-10-15T14:30:00Z",
      },
      createdBy: { id: "adm-1", name: "Proprietário" },
    },
    {
      id: "payout-2",
      cycleId: "cyc-2",
      memberId: "mem-2",
      amount: 320.0,
      paymentMethod: "TRANSFER",
      paidAt: "2026-10-14T11:00:00Z",
      notes: "Liquidação final",
      createdAt: "2026-10-14T11:00:00Z",
      member: {
        id: "mem-2",
        name: "Marcos Inativo",
        role: "BARBER",
        isActive: false,
      },
      cycle: {
        id: "cyc-2",
        cycleNumber: 7,
        status: "PAID",
        grossCommission: 320.0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 320.0,
        remainingBalance: 0,
        openedAt: "2026-09-15T00:00:00Z",
        closedAt: "2026-10-14T11:00:00Z",
        paidAt: "2026-10-14T11:00:00Z",
      },
      createdBy: { id: "adm-1", name: "Proprietário" },
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
            totalPaidAccumulated: 1170.5,
            totalPayoutsCount: 2,
            historicalSummary: {
              totalPaidAmount: 1170.5,
              totalPayoutsCount: 2,
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
          json: async () => ({ id: "shop-1", name: "Dom Brio Barbearia" }),
        } as Response;
      }

      if (urlStr.includes("/api/admin/commissions/payouts")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            barbershop: { id: "shop-1", name: "Dom Brio Barbearia" },
            payouts: mockPayouts,
            pagination: {
              page: 1,
              limit: 20,
              totalRecords: 2,
              totalPages: 1,
              hasMore: false,
              isPrintMode: urlStr.includes("format=print"),
            },
            summary: {
              totalPaidAmount: 1170.5,
              totalPayoutsCount: 2,
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

  it("1. Renderiza a tabela do histórico com a classe exclusiva de escopo de impressão e classes semânticas de contraste", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      const table = document.querySelector("table.commission-history-print-table");
      expect(table).toBeInTheDocument();
    });

    const tbody = document.querySelector("tbody");
    expect(tbody).toBeTruthy();
    const withinTbody = within(tbody!);

    // Confirma que os profissionais são renderizados com classes de contraste
    expect(withinTbody.getByText("Carlos Barbeiro")).toBeInTheDocument();
    expect(withinTbody.getByText("Marcos Inativo")).toBeInTheDocument();

    const dateCells = document.querySelectorAll(".commission-print-date");
    expect(dateCells.length).toBe(2);

    const memberDivs = document.querySelectorAll(".commission-print-member");
    expect(memberDivs.length).toBe(2);

    const inactiveBadge = document.querySelector(".commission-print-inactive");
    expect(inactiveBadge).toBeInTheDocument();
    expect(inactiveBadge?.textContent).toBe("Inativo");

    const cycleNumbers = document.querySelectorAll(".commission-print-cycle-number");
    expect(cycleNumbers.length).toBe(2);

    const cycleDates = document.querySelectorAll(".commission-print-cycle-date");
    expect(cycleDates.length).toBe(2);

    const amounts = document.querySelectorAll(".commission-print-amount");
    expect(amounts.length).toBe(2);

    const creators = document.querySelectorAll(".commission-print-creator");
    expect(creators.length).toBe(2);
  });

  it("2. Regras de impressão no componente definem paleta formal de alto contraste e color-scheme light", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(document.querySelector("table.commission-history-print-table")).toBeInTheDocument();
    });

    const styles = Array.from(document.querySelectorAll("style"));
    const printStyle = styles.find((s) => s.textContent?.includes("@media print"));
    expect(printStyle).toBeDefined();

    const css = printStyle?.textContent || "";

    // 1. Color-scheme forçado para light para evitar faixas pretas e margins escuras
    expect(css).toContain("color-scheme: light !important");
    expect(css).toContain("background: #ffffff !important");
    expect(css).toContain("color: #111827 !important");

    // 2. Escopo exclusivo da tabela de histórico
    expect(css).toContain(".commission-history-print-table");
    expect(css).toContain("background-color: #f3f4f6 !important"); // Cabeçalho da tabela
    expect(css).toContain("border: 1px solid #d1d5db !important"); // Bordas discretas

    // 3. Regras de contraste para elementos internos da tabela
    expect(css).toContain(".commission-history-print-table td div");
    expect(css).toContain(".commission-history-print-table td span");
    expect(css).toContain("color: inherit");

    // 4. Classes de cores específicas do PDF e isolamento de especificidade
    expect(css).toContain(".commission-print-member");
    expect(css).not.toContain(".commission-print-member span"); // Garante que o badge Inativo não seja sobrescrito
    expect(css).toContain(".commission-print-cycle-number");
    expect(css).toContain(".commission-print-cycle-date");
    expect(css).toContain("color: #4b5563 !important"); // Texto auxiliar
    expect(css).toContain(".commission-print-amount");
    expect(css).toContain("color: #047857 !important"); // Valor pago em verde escuro legível
    expect(css).toContain(".commission-print-inactive");
    expect(css).toContain("color: #dc2626 !important"); // Inativo legível
    expect(css).toContain(".payment-badge");
    expect(css).toContain("color: #1f2937 !important"); // Badge forma de pagamento com contraste
  });

  it("3. Tema escuro da interface em tela permanece intacto", async () => {
    render(<CommissionPaymentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Histórico de Pagamentos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Histórico de Pagamentos" }));

    await waitFor(() => {
      expect(document.querySelector("table.commission-history-print-table")).toBeInTheDocument();
    });

    // Em tela, o cabeçalho usa as classes Tailwind de tema escuro
    const thead = document.querySelector("thead");
    expect(thead).toHaveClass("bg-[var(--surface-raised)]");
    expect(thead).toHaveClass("text-[var(--text-secondary)]");

    // A célula de valor pago mantém a classe de tela text-emerald-400
    const amountCell = document.querySelector(".commission-print-amount");
    expect(amountCell).toHaveClass("text-emerald-400");

    // A célula do nome mantém text-[var(--text-primary)]
    const memberDiv = document.querySelector(".commission-print-member");
    expect(memberDiv).toHaveClass("text-[var(--text-primary)]");
  });
});
