/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/marketing",
  useParams: () => ({ id: "sw-123" }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import MarketingHubPage from "@/app/admin/marketing/page";
import SorteiosListPage from "@/app/admin/marketing/sorteios/page";
import NewSweepstakePage from "@/app/admin/marketing/sorteios/novo/page";
import SweepstakeDetailPage from "@/app/admin/marketing/sorteios/[id]/page";

describe("Marketing & Sweepstakes UI Pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).fetch = vi.fn();
  });

  describe("1. Marketing Hub Page (/admin/marketing)", () => {
    it("renders Marketing Hub with Sorteios and Vitrine cards", async () => {
      (global as any).fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sweepstakes: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ barbershop: { slug: "tembarber" } }),
        });

      await act(async () => {
        render(<MarketingHubPage />);
      });

      expect(screen.getByText("Marketing & Campanhas")).toBeInTheDocument();
      expect(screen.getByText("Sorteios de Clientes")).toBeInTheDocument();
      expect(screen.getByText("Vitrine Pública")).toBeInTheDocument();

      const sorteiosLink = screen.getByRole("link", { name: /Gerenciar Sorteios/i });
      expect(sorteiosLink).toHaveAttribute("href", "/admin/marketing/sorteios");

      const vitrineLink = screen.getByRole("link", { name: /Configurar Vitrine Pública/i });
      expect(vitrineLink).toHaveAttribute("href", "/admin/marketing/vitrine");
    });
  });

  describe("2. Sweepstakes List Page (/admin/marketing/sorteios)", () => {
    it("renders sweepstakes list and status badges", async () => {
      (global as any).fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sweepstakes: [
            {
              id: "sw-draft-1",
              title: "Sorteio de Natal 2026",
              description: "Campanha promocional de natal",
              status: "DRAFT",
              participationMode: "ONE_PER_SERVICE",
              targetSegment: "ALL_CUSTOMERS",
              startDateCivil: "2026-12-01",
              endDateCivil: "2026-12-25",
              drawDateScheduled: "2026-12-25T15:00:00.000Z",
              createdAt: "2026-11-06T12:00:00.000Z",
              _count: { participants: 15, tickets: 45, winners: 0 },
              prizes: [{ id: "pz-1", position: 1, title: "iPhone 16" }],
              winners: [],
            },
            {
              id: "sw-frozen-2",
              title: "Sorteio de Verão 2027",
              description: "Campanha de verão",
              status: "FROZEN",
              participationMode: "ONE_PER_APPOINTMENT",
              targetSegment: "CLUB_ONLY",
              startDateCivil: "2027-01-01",
              endDateCivil: "2027-01-31",
              drawDateScheduled: "2027-02-01T15:00:00.000Z",
              createdAt: "2026-11-06T12:00:00.000Z",
              _count: { participants: 20, tickets: 30, winners: 0 },
              prizes: [{ id: "pz-2", position: 1, title: "Kit Cervejas Artesanais" }],
              winners: [],
            },
          ],
        }),
      });

      await act(async () => {
        render(<SorteiosListPage />);
      });

      await waitFor(() => {
        expect(screen.getByText("Sorteio de Natal 2026")).toBeInTheDocument();
        expect(screen.getByText("Sorteio de Verão 2027")).toBeInTheDocument();
      });

      expect(screen.getAllByText("Rascunho").length).toBeGreaterThan(0);
      expect(screen.getByText(/Congelado/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Nova Campanha/i })).toHaveAttribute("href", "/admin/marketing/sorteios/novo");
    });
  });

  describe("3. New Sweepstake Page (/admin/marketing/sorteios/novo)", () => {
    it("renders wizard form and handles simulate action", async () => {
      (global as any).fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ services: [{ id: "srv-1", name: "Corte Degradê", price: "50.00" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sweepstake: { id: "sw-new-123" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            preview: {
              totalEligibleCustomers: 12,
              totalEligibleVisits: 15,
              totalEligibleServices: 20,
              totalChances: 24,
            },
          }),
        });

      await act(async () => {
        render(<NewSweepstakePage />);
      });

      expect(screen.getByText("Nova Campanha de Sorteio")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Ex: Sorteio de Fim de Ano/i)).toBeInTheDocument();

      // Trigger simulate
      const simulateButton = screen.getByRole("button", { name: /Simular e Abrir Campanha/i });
      await act(async () => {
        fireEvent.click(simulateButton);
      });

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/admin/marketing/sorteios/sw-new-123");
      });
    });
  });

  describe("4. Sweepstake Control Room Page (/admin/marketing/sorteios/[id])", () => {
    it("renders DRAFT state with freeze action", async () => {
      (global as any).fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sweepstake: {
            id: "sw-123",
            title: "Sorteio de Fim de Ano",
            status: "DRAFT",
            participationMode: "ONE_PER_SERVICE",
            targetSegment: "ALL_CUSTOMERS",
            startDateCivil: "2026-11-01",
            endDateCivil: "2026-11-30",
            startInclusiveUtc: "2026-11-01T03:00:00.000Z",
            endExclusiveUtc: "2026-12-01T03:00:00.000Z",
            drawDateScheduled: "2026-12-01T15:00:00.000Z",
            drawMethod: "ELECTRONIC_DETERMINISTIC",
            isRegulatedPromotion: false,
            prizes: [{ id: "pz-1", position: 1, title: "Kit Barba Premium" }],
            winners: [],
            totalEligibleCustomers: 10,
            totalEligibleVisits: 12,
            totalEligibleServices: 15,
            totalChancesAssigned: 15,
            _count: { participants: 10, tickets: 15, winners: 0, chanceOrigins: 15 },
          },
        }),
      });

      const paramsPromise = Promise.resolve({ id: "sw-123" });

      await act(async () => {
        render(
          <Suspense fallback={<div>Carregando...</div>}>
            <SweepstakeDetailPage params={paramsPromise} />
          </Suspense>
        );
      });

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Sorteio de Fim de Ano" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Congelar e Emitir Bilhetes/i })).toBeInTheDocument();
      });
    });

    it("renders DRAWN state with podium and cryptographic proof", async () => {
      (global as any).fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sweepstake: {
            id: "sw-123",
            title: "Sorteio Concluído",
            status: "DRAWN",
            participationMode: "ONE_PER_SERVICE",
            targetSegment: "ALL_CUSTOMERS",
            startDateCivil: "2026-11-01",
            endDateCivil: "2026-11-30",
            startInclusiveUtc: "2026-11-01T03:00:00.000Z",
            endExclusiveUtc: "2026-12-01T03:00:00.000Z",
            drawDateScheduled: "2026-12-01T15:00:00.000Z",
            drawMethod: "ELECTRONIC_DETERMINISTIC",
            isRegulatedPromotion: false,
            prizes: [{ id: "pz-1", position: 1, title: "iPhone 16 Pro" }],
            winners: [
              {
                id: "win-1",
                prizePosition: 1,
                prizeTitle: "iPhone 16 Pro",
                winningTicketNumber: 42,
                drawnValueRaw: "42",
                customerNameSnapshot: "Lucas Barber",
                customerPhoneSnapshot: "17999998888",
              },
            ],
            drawAudit: {
              ticketsSha256Snapshot: "sha256digesttickets",
              seedUsed: "seedfrozencommitment",
              auditNotes: "Sorteio realizado sem divergências.",
            },
            totalEligibleCustomers: 10,
            totalEligibleVisits: 12,
            totalEligibleServices: 50,
            totalChancesAssigned: 50,
            _count: { participants: 10, tickets: 50, winners: 1, chanceOrigins: 50 },
          },
        }),
      });

      const paramsPromise = Promise.resolve({ id: "sw-123" });

      await act(async () => {
        render(
          <Suspense fallback={<div>Carregando...</div>}>
            <SweepstakeDetailPage params={paramsPromise} />
          </Suspense>
        );
      });

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Sorteio Concluído" })).toBeInTheDocument();
        expect(screen.getByText("Ganhadores da Simulação Técnica (V1)")).toBeInTheDocument();
        expect(screen.getByText("Lucas Barber")).toBeInTheDocument();
        expect(screen.getByText(/Bilhete nº 0042/i)).toBeInTheDocument();
        expect(screen.getByText(/Hash SHA-256 do Snapshot/i)).toBeInTheDocument();
      });
    });
  });
});
