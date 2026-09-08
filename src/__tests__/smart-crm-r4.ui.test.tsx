/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

// Mock next/navigation
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/clientes/reativacao",
}));

let currentMockRole = "OWNER";

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "u-1", name: "Admin Test", role: currentMockRole },
    },
    status: "authenticated",
  }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { ClientNav } from "@/components/admin/clients/ClientNav";
import ReactivationPage from "@/app/admin/clientes/reativacao/page";

const mockCandidatesResponse = {
  generatedAt: "2026-09-05T12:00:00.000Z",
  scoreVersion: "smart-crm-score-v1",
  recurrenceVersion: "smart-crm-recurrence-v1",
  items: [
    {
      customer: { id: "cust-1", name: "João Silva", phone: "5511999991111" },
      timingState: "OVERDUE",
      timingLabel: "Atrasado",
      expectedReturnDays: 20,
      daysOverdue: 8,
      daysUntilExpectedReturn: 0,
      score: 85,
      completedVisitCount: 6,
      averageTicket: 80.0,
      potentialRevenue: 80.0,
      dominantService: { id: "srv-1", name: "Corte e Barba", occurrenceCount: 5 },
      favoriteProfessional: { id: "mbr-1", name: "Carlos Barbeiro", occurrenceCount: 5 },
      recurrenceSource: "INDIVIDUAL_CADENCE",
      consentStatus: "OPTED_IN",
      recommendationEligible: true,
      dispatchEligible: true,
      recommendationSuppressions: [],
      dispatchSuppressions: [],
      defaultSelected: true,
      scoreBreakdown: {
        timingScore: 35,
        historyScore: 20,
        valueScore: 20,
        engagementScore: 10,
        fatiguePenalty: 0,
      },
      scoreReasons: [
        { code: "CADENCE_OVERDUE", label: "Está 8 dias atrasado", impact: 35 },
        { code: "GOOD_RECURRENCE", label: "Boa recorrência de visitas", impact: 15 },
      ],
    },
    {
      customer: { id: "cust-2", name: "Marcos Santos", phone: "5511999992222" },
      timingState: "DUE_SOON",
      timingLabel: "Em breve",
      expectedReturnDays: 30,
      daysOverdue: 0,
      daysUntilExpectedReturn: 3,
      score: 60,
      completedVisitCount: 3,
      averageTicket: 60.0,
      potentialRevenue: 60.0,
      dominantService: { id: "srv-1", name: "Corte Tradicional", occurrenceCount: 3 },
      favoriteProfessional: null,
      recurrenceSource: "SHOP_BENCHMARK",
      consentStatus: "UNKNOWN",
      recommendationEligible: true,
      dispatchEligible: false,
      recommendationSuppressions: [],
      dispatchSuppressions: ["CONSENT_UNKNOWN"],
      defaultSelected: false,
      scoreBreakdown: {
        timingScore: 10,
        historyScore: 20,
        valueScore: 15,
        engagementScore: 15,
        fatiguePenalty: 0,
      },
      scoreReasons: [
        { code: "CADENCE_DUE_SOON", label: "Retorno em 3 dias", impact: 10 },
      ],
    },
    {
      customer: { id: "cust-3", name: "Optout Customer", phone: "5511999993333" },
      timingState: "DUE",
      timingLabel: "No momento",
      expectedReturnDays: 25,
      daysOverdue: 0,
      daysUntilExpectedReturn: 0,
      score: 75,
      completedVisitCount: 4,
      averageTicket: 70.0,
      potentialRevenue: 70.0,
      dominantService: { id: "srv-1", name: "Barba", occurrenceCount: 4 },
      favoriteProfessional: null,
      recurrenceSource: "DOMINANT_SERVICE_CADENCE",
      consentStatus: "OPTED_OUT",
      recommendationEligible: true,
      dispatchEligible: false,
      recommendationSuppressions: [],
      dispatchSuppressions: ["CONSENT_OPTED_OUT"],
      defaultSelected: false,
      scoreBreakdown: {
        timingScore: 25,
        historyScore: 20,
        valueScore: 20,
        engagementScore: 10,
        fatiguePenalty: 0,
      },
      scoreReasons: [],
    },
  ],
  summary: {
    recommendedCount: 2,
    dueSoonCount: 1,
    dueCount: 1,
    overdueCount: 1,
    inactiveCount: 0,
    potentialRevenue: 150.0,
  },
  page: { limit: 50, nextCursor: null },
};

describe("Smart CRM R4 — UI Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockRole = "OWNER";
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            campaign: { id: "camp-1" },
            accepted: [
              {
                recipientId: "rec-1",
                customerName: "João Silva",
                customerPhone: "11999991111",
                dispatchStatus: "READY",
              },
            ],
            rejected: [],
          }),
        } as Response);
      }
      if (url.includes("/api/admin/clients/reactivation")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockCandidatesResponse,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);
    });
  });

  it("renders ClientNav with Clientes and Reativação tabs for OWNER", () => {
    render(<ClientNav />);
    expect(screen.getByText("Base de clientes")).toBeInTheDocument();
    expect(screen.getByText("Reativação")).toBeInTheDocument();
  });

  it("hides Reativação in ClientNav when user is BARBER", () => {
    currentMockRole = "BARBER";
    render(<ClientNav />);
    expect(screen.getByText("Base de clientes")).toBeInTheDocument();
    expect(screen.queryByText("Reativação")).not.toBeInTheDocument();
  });

  it("renders ReactivationPage with KPIs, filters, candidate cards and decision fields", async () => {
    render(<ReactivationPage />);

    expect(screen.getByText("Reativação de clientes")).toBeInTheDocument();
    expect(screen.getByText(/Qual cliente vale a pena chamar hoje/i)).toBeInTheDocument();

    // Candidate card check
    expect(await screen.findByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("Clientes recomendados hoje")).toBeInTheDocument();
    expect(screen.getAllByText("Receita potencial").length).toBeGreaterThanOrEqual(1);

    // Score & Human overdue check
    expect(screen.getByText("Score 85/100")).toBeInTheDocument();
    expect(screen.getByText("8 dias atrasado")).toBeInTheDocument();
    expect(screen.getByText("Consentimento OK")).toBeInTheDocument();

    // Explainability reasons
    expect(screen.getByText("Está 8 dias atrasado")).toBeInTheDocument();
    expect(screen.getByText("Boa recorrência de visitas")).toBeInTheDocument();
  });

  it("shows UNKNOWN and OPTED_OUT opportunity in Hoje/Todos but with WhatsApp disabled and tooltip", async () => {
    render(<ReactivationPage />);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    // Optout Customer is in Hoje (DUE)
    expect(screen.getByText("Optout Customer")).toBeInTheDocument();
    expect(screen.getByText("Opt-out")).toBeInTheDocument();

    // Verify WhatsApp button is disabled for OPTED_OUT
    const waButtons = screen.getAllByRole("button", { name: "WhatsApp" });
    const disabledOptOutWa = waButtons.find((btn) => btn.getAttribute("title")?.includes("opt-out"));
    expect(disabledOptOutWa).toBeDefined();
    expect(disabledOptOutWa).toBeDisabled();
  });

  it("opens explainability drawer when clicking Detalhes", async () => {
    render(<ReactivationPage />);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    const detalhesBtns = screen.getAllByRole("button", { name: "Detalhes" });
    fireEvent.click(detalhesBtns[0]);

    expect(screen.getByText("Pontuação Smart CRM (85/100)")).toBeInTheDocument();
    expect(screen.getByText("Timing do retorno")).toBeInTheDocument();
    expect(screen.getByText("Volume / Histórico de visitas")).toBeInTheDocument();

    // Close drawer
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("Pontuação Smart CRM (85/100)")).not.toBeInTheDocument();
  });

  it("switches tabs correctly to Em breve", async () => {
    render(<ReactivationPage />);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    const emBreveTab = screen.getByRole("tab", { name: /Em breve/i });
    fireEvent.click(emBreveTab);

    await waitFor(() => {
      expect(screen.getByText("Marcos Santos")).toBeInTheDocument();
      expect(screen.getByText("Registrar consentimento")).toBeInTheDocument();
    });
  });

  it("opens consent modal when clicking Registrar consentimento", async () => {
    render(<ReactivationPage />);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    const todosTab = screen.getByRole("tab", { name: /Todos/i });
    fireEvent.click(todosTab);

    await waitFor(() => {
      expect(screen.getByText("Registrar consentimento")).toBeInTheDocument();
    });

    const consentBtn = screen.getByText("Registrar consentimento");
    fireEvent.click(consentBtn);

    expect(screen.getByText("Registrar Consentimento de Marketing")).toBeInTheDocument();
    expect(screen.getByText(/Declaro expressamente que este cliente forneceu autorização prévia/i)).toBeInTheDocument();
  });

  it("prevents WHATSAPP_OPENED API call when browser popup is blocked", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ReactivationPage />);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });

    // Click WhatsApp for João Silva
    const waButtons = screen.getAllByRole("button", { name: "WhatsApp" });
    const joaoWa = waButtons.find((btn) => !btn.hasAttribute("disabled"));
    expect(joaoWa).toBeDefined();

    fireEvent.click(joaoWa!);

    // Wait for batch preparation modal to open
    await waitFor(() => {
      expect(screen.getByText("Lote de Contato Manual WhatsApp")).toBeInTheDocument();
    });

    // Click ABRIR WHATSAPP in the batch modal
    const abrirBtn = screen.getByRole("button", { name: "ABRIR WHATSAPP" });
    fireEvent.click(abrirBtn);

    expect(windowOpenSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Pop-up bloqueado"));

    // Verify opened endpoint was NEVER called
    const fetchMock = global.fetch as any;
    const openedCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("/opened"));
    expect(openedCalls.length).toBe(0);
  });
});
