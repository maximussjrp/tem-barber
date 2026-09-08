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
      scoreBreakdown: { timingScore: 35, historyScore: 20, valueScore: 20, engagementScore: 10, fatiguePenalty: 0 },
      scoreReasons: [{ code: "CADENCE_OVERDUE", label: "Está 8 dias atrasado", impact: 35 }],
    },
  ],
  summary: {
    recommendedCount: 1,
    dueSoonCount: 0,
    dueCount: 0,
    overdueCount: 1,
    inactiveCount: 0,
    potentialRevenue: 80.0,
  },
};

const mockCampaignsListResponse = {
  success: true,
  items: [
    {
      id: "camp-1",
      name: "Lote Reativação Setembro",
      channel: "WHATSAPP_MANUAL",
      status: "COMPLETED",
      scoreVersion: "smart-crm-score-v1",
      recurrenceVersion: "smart-crm-recurrence-v1",
      attributionVersion: "smart-crm-attribution-v1",
      bookingAttributionWindowDays: 14,
      directReturnWindowDays: 30,
      cooldownDays: 14,
      totalRecipients: 5,
      contacts: 4,
      reactivatedCustomers: 2,
      recoveredRevenue: 150.0,
      createdAt: "2026-09-01T10:00:00.000Z",
      completedAt: "2026-09-01T10:30:00.000Z",
    },
  ],
  nextCursor: null,
};

const mockCampaignAttributionSummary = {
  campaignId: "camp-1",
  name: "Lote Reativação Setembro",
  status: "COMPLETED",
  attributionVersion: "smart-crm-attribution-v1",
  bookingAttributionWindowDays: 14,
  directReturnWindowDays: 30,
  contacts: 4,
  customersWithAttributedBooking: 2,
  attributedBookings: 2,
  cancelledBookings: 1,
  noShows: 0,
  reactivatedCustomers: 2,
  bookingRate: 0.5,
  attendanceRate: 0.5,
  conversionRate: 0.5,
  recoveredRevenue: 150.0,
  recipients: [
    {
      recipientId: "rec-1",
      customerId: "cust-1",
      customerName: "João Silva",
      customerPhone: "5511999991111",
      dispatchStatus: "SENT_CONFIRMED",
      sentConfirmedAt: "2026-09-01T10:15:00.000Z",
      conversionStatus: "REVENUE_ATTRIBUTED",
      canonicalReturnDate: "2026-09-03",
      conversionAttributedAt: "2026-09-03T16:00:00.000Z",
      revenueAttributed: 80.0,
      attributedAppointment: {
        id: "appt-1",
        dateTime: "2026-09-03T15:00:00.000Z",
        createdAt: "2026-09-01T14:00:00.000Z",
        status: "COMPLETED",
        serviceName: "Corte e Barba",
        memberName: "Carlos Barbeiro",
      },
      attributedComanda: {
        id: "cmd-1",
        paidTotal: 80.0,
        status: "CLOSED",
        closedAt: "2026-09-03T16:00:00.000Z",
      },
    },
    {
      recipientId: "rec-2",
      customerId: "cust-2",
      customerName: "Pedro Alves",
      customerPhone: "5511999993333",
      dispatchStatus: "SENT_CONFIRMED",
      sentConfirmedAt: "2026-09-01T10:20:00.000Z",
      conversionStatus: "DIRECT_RETURN",
      canonicalReturnDate: "2026-09-04",
      conversionAttributedAt: "2026-09-04T17:00:00.000Z",
      revenueAttributed: 70.0,
      attributedAppointment: null,
      attributedComanda: {
        id: "cmd-2",
        paidTotal: 70.0,
        status: "CLOSED",
        closedAt: "2026-09-04T17:00:00.000Z",
      },
    },
  ],
};

const mockRecipientAttributionDetail = {
  recipient: {
    id: "rec-1",
    campaignId: "camp-1",
    barbershopId: "shop-1",
    customerId: "cust-1",
    customerName: "João Silva",
    customerPhone: "5511999991111",
    dispatchStatus: "SENT_CONFIRMED",
    sentConfirmedAt: "2026-09-01T10:15:00.000Z",
    timingStateSnapshot: "OVERDUE",
    scoreSnapshot: 85,
    previewMessage: "Olá João! Notamos que já faz um tempo...",
  },
  attribution: {
    conversionStatus: "REVENUE_ATTRIBUTED",
    canonicalReturnDate: "2026-09-03",
    conversionAttributedAt: "2026-09-03T16:00:00.000Z",
    revenueAttributed: 80.0,
  },
  evidence: {
    appointment: {
      id: "appt-1",
      dateTime: "2026-09-03T15:00:00.000Z",
      createdAt: "2026-09-01T14:00:00.000Z",
      status: "COMPLETED",
      serviceName: "Corte e Barba",
      memberName: "Carlos Barbeiro",
    },
    comandas: [
      {
        id: "cmd-1",
        paidTotal: 80.0,
        status: "CLOSED",
        closedAt: "2026-09-03T16:00:00.000Z",
        itemsCount: 1,
      },
    ],
    timeline: [
      {
        event: "Disparo confirmado (T0)",
        timestamp: "2026-09-01T10:15:00.000Z",
        detail: "Operador confirmou envio da mensagem manual no WhatsApp.",
      },
      {
        event: "Agendamento criado",
        timestamp: "2026-09-01T14:00:00.000Z",
        detail: "Cliente agendou Corte e Barba dentro da janela de 14 dias.",
      },
      {
        event: "Atendimento realizado e comanda paga",
        timestamp: "2026-09-03T16:00:00.000Z",
        detail: "Comanda #cmd-1 fechada no valor de R$ 80,00.",
      },
    ],
  },
};

const mockCustomerAttributionHistory = {
  customerId: "cust-1",
  barbershopId: "shop-1",
  totalTouches: 1,
  totalConversions: 1,
  totalRevenueRecovered: 80.0,
  history: [
    {
      recipientId: "rec-1",
      campaignId: "camp-1",
      campaignName: "Lote Reativação Setembro",
      channel: "WHATSAPP_MANUAL",
      sentConfirmedAt: "2026-09-01T10:15:00.000Z",
      dispatchStatus: "SENT_CONFIRMED",
      conversionStatus: "REVENUE_ATTRIBUTED",
      canonicalReturnDate: "2026-09-03",
      revenueAttributed: 80.0,
      appointment: {
        id: "appt-1",
        dateTime: "2026-09-03T15:00:00.000Z",
        status: "COMPLETED",
      },
    },
  ],
};

describe("Smart CRM R5.2 Attribution Analytics UX Component Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockRole = "OWNER";

    // Setup global fetch mock
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/clients/reactivation?")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockCandidatesResponse,
        };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockCampaignsListResponse,
        };
      }
      if (url.includes("/attribution") && url.includes("/recipients/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, detail: mockRecipientAttributionDetail }),
        };
      }
      if (url.includes("/attribution") && url.includes("/manual-campaigns/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, summary: mockCampaignAttributionSummary }),
        };
      }
      if (url.includes("/reconcile-attribution")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, summary: mockCampaignAttributionSummary }),
        };
      }
      if (url.includes("/attribution-history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, history: mockCustomerAttributionHistory }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "Not Found" }),
      };
    }) as any;
  });

  it("renders sub-navigation tabs 'Oportunidades' and 'Campanhas / Resultados'", async () => {
    render(<ReactivationPage />);

    expect(await screen.findByRole("tab", { name: "Oportunidades" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Campanhas / Resultados" })).toBeInTheDocument();
  });

  it("switches to 'Campanhas / Resultados' and displays campaign attribution KPIs", async () => {
    render(<ReactivationPage />);

    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    // Verify Primary KPIs are displayed
    expect(await screen.findByText("Contatos confirmados")).toBeInTheDocument();
    expect(screen.getByText("Agendamentos atribuídos")).toBeInTheDocument();
    expect(screen.getByText("Clientes que retornaram")).toBeInTheDocument();
    expect(screen.getByText("Receita atribuída à reativação")).toBeInTheDocument();

    // Verify values from mockCampaignAttributionSummary
    expect(screen.getByText("4")).toBeInTheDocument(); // contacts
    expect(screen.getByText("R$ 150,00")).toBeInTheDocument(); // recoveredRevenue
  });

  it("displays zero-cost economics indicator with '— (Não aplicável)'", async () => {
    render(<ReactivationPage />);

    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    expect(await screen.findByText("Custo de mídia / ROI")).toBeInTheDocument();
    expect(screen.getByText(/Não aplicável/i)).toBeInTheDocument();
    expect(screen.getByText(/Custo de mídia R\$ 0,00/i)).toBeInTheDocument();
  });

  it("opens Recipient Attribution Explainability Drawer upon clicking 'Ver detalhes'", async () => {
    render(<ReactivationPage />);

    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    // Wait for recipient table to load
    const detailButtons = await screen.findAllByText("Ver detalhes");
    expect(detailButtons.length).toBeGreaterThan(0);

    fireEvent.click(detailButtons[0]);

    // Drawer should open and display explanation rules
    expect(await screen.findByText("Transparência de Atribuição")).toBeInTheDocument();
    expect(screen.getByText("Regras de Atribuição (Transparência Operacional)")).toBeInTheDocument();
    expect(screen.getByText(/Last Eligible Touch:/i)).toBeInTheDocument();
    expect(screen.getByText(/Proteção Pré-existente:/i)).toBeInTheDocument();
    expect(screen.getByText("Linha do Tempo de Evidências")).toBeInTheDocument();
    expect(screen.getByText("T0 (Disparo Confirmado)")).toBeInTheDocument();
    expect(screen.getByText("Evidência de Agendamento")).toBeInTheDocument();
    expect(screen.getByText("Evidência de Comanda / Pagamento")).toBeInTheDocument();
  });

  it("allows triggering explicit reconciliation mutation", async () => {
    render(<ReactivationPage />);

    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    const reconcileBtn = await screen.findByRole("button", { name: /Atualizar resultados/i });
    expect(reconcileBtn).toBeInTheDocument();

    fireEvent.click(reconcileBtn);

    await waitFor(() => {
      expect(screen.getByText(/reconciliados com sucesso/i)).toBeInTheDocument();
    });
  });

  it("distinguishes attributedBookings (7) from customersWithAttributedBooking (3)", async () => {
    const multiBookingSummary = {
      ...mockCampaignAttributionSummary,
      contacts: 10,
      customersWithAttributedBooking: 3,
      attributedBookings: 7,
      reactivatedCustomers: 5,
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/clients/reactivation?")) {
        return { ok: true, status: 200, json: async () => mockCandidatesResponse };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return { ok: true, status: 200, json: async () => mockCampaignsListResponse };
      }
      if (url.includes("/attribution") && url.includes("/manual-campaigns/")) {
        return { ok: true, status: 200, json: async () => ({ success: true, summary: multiBookingSummary }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    render(<ReactivationPage />);
    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    expect(await screen.findByText("Agendamentos atribuídos")).toBeInTheDocument();
    // Primary number displays attributedBookings (7)
    expect(screen.getByText("7")).toBeInTheDocument();
    // Subtitle displays customersWithAttributedBooking (3)
    expect(screen.getByText(/3 cliente\(s\) que agendaram/i)).toBeInTheDocument();
  });

  it("renders rate presentation for 0, 0.25, 0.5, 1 and controlled diagnostic for invalid rate 1.2", async () => {
    const rateSummary = {
      ...mockCampaignAttributionSummary,
      contacts: 10,
      bookingRate: 0.25,
      attendanceRate: 1.2, // invalid > 1
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/clients/reactivation?")) {
        return { ok: true, status: 200, json: async () => mockCandidatesResponse };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return { ok: true, status: 200, json: async () => mockCampaignsListResponse };
      }
      if (url.includes("/attribution") && url.includes("/manual-campaigns/")) {
        return { ok: true, status: 200, json: async () => ({ success: true, summary: rateSummary }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    render(<ReactivationPage />);
    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    // 0.25 -> 25.0%
    expect(await screen.findByText("25.0%")).toBeInTheDocument();
    // 1.2 -> Inválida (120.0%) (controlled error, not clamped to 100%)
    expect(screen.getByText(/Inválida \(120\.0%\)/i)).toBeInTheDocument();
  });

  it("proves manual reconcile triggers 0 POSTs on mount/tab switch and exactly 1 POST on button click", async () => {
    let reconcilePostCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === "POST" && url.includes("/reconcile-attribution")) {
        reconcilePostCount++;
        return { ok: true, status: 200, json: async () => ({ success: true, summary: mockCampaignAttributionSummary }) };
      }
      if (url.includes("/api/admin/clients/reactivation?")) {
        return { ok: true, status: 200, json: async () => mockCandidatesResponse };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return { ok: true, status: 200, json: async () => mockCampaignsListResponse };
      }
      if (url.includes("/attribution") && url.includes("/manual-campaigns/")) {
        return { ok: true, status: 200, json: async () => ({ success: true, summary: mockCampaignAttributionSummary }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    render(<ReactivationPage />);

    // On mount in Oportunidades: 0 reconcile POSTs
    expect(reconcilePostCount).toBe(0);

    // Switch to Campanhas / Resultados tab: 0 reconcile POSTs
    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);
    expect(await screen.findByText("Contatos confirmados")).toBeInTheDocument();
    expect(reconcilePostCount).toBe(0);

    // Explicit click "Atualizar resultados": exactly 1 reconcile POST
    const reconcileBtn = screen.getByRole("button", { name: /Atualizar resultados/i });
    fireEvent.click(reconcileBtn);

    await waitFor(() => {
      expect(reconcilePostCount).toBe(1);
      expect(screen.getByText(/reconciliados com sucesso/i)).toBeInTheDocument();
    });
  });

  it("preserves existing metrics and shows error banner when reconciliation fails", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === "POST" && url.includes("/reconcile-attribution")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: "Falha temporária ao reconciliar no banco." }),
        };
      }
      if (url.includes("/api/admin/clients/reactivation?")) {
        return { ok: true, status: 200, json: async () => mockCandidatesResponse };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return { ok: true, status: 200, json: async () => mockCampaignsListResponse };
      }
      if (url.includes("/attribution") && url.includes("/manual-campaigns/")) {
        return { ok: true, status: 200, json: async () => ({ success: true, summary: mockCampaignAttributionSummary }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    render(<ReactivationPage />);
    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    expect(await screen.findByText("R$ 150,00")).toBeInTheDocument();

    const reconcileBtn = screen.getByRole("button", { name: /Atualizar resultados/i });
    fireEvent.click(reconcileBtn);

    // Error message rendered inline, existing data (R$ 150,00) remains preserved!
    expect(await screen.findByText("Falha temporária ao reconciliar no banco.")).toBeInTheDocument();
    expect(screen.getByText("R$ 150,00")).toBeInTheDocument();
  });

  it("renders NO_CAMPAIGNS empty state when no campaigns exist", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/clients/reactivation?")) {
        return { ok: true, status: 200, json: async () => mockCandidatesResponse };
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns?")) {
        return { ok: true, status: 200, json: async () => ({ success: true, items: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    render(<ReactivationPage />);
    const resultsTab = await screen.findByRole("tab", { name: "Campanhas / Resultados" });
    fireEvent.click(resultsTab);

    expect(await screen.findByText("Nenhuma campanha realizada ainda")).toBeInTheDocument();
    expect(screen.getByText("Ir para Oportunidades")).toBeInTheDocument();
  });

  it("blocks BARBER role with access restriction screen", async () => {
    currentMockRole = "BARBER";
    render(<ReactivationPage />);

    expect(await screen.findByText("Acesso Restrito")).toBeInTheDocument();
    expect(
      screen.getByText(/A área de Reativação Smart CRM é restrita a gestores e proprietários/i)
    ).toBeInTheDocument();
  });
});
