/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminComissoesPage from "@/app/admin/comissoes/page";

// Mock next/navigation and next/link
vi.mock("next/link", () => ({
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("P1 Comissão — Auditoria por Comanda e Item", () => {
  it("carrega a lista de comissões e ao clicar em Auditar envia o memberId correto para /api/admin/commissions/detail", async () => {
    const mockReport = {
      summary: {
        grossServiceAmount: "70.00",
        grossProductAmount: "0.00",
        discountAmount: "0.00",
        netBaseAmount: "70.00",
        generatedCommission: "35.00",
        releasedCommission: "35.00",
        paidCommission: "0.00",
        reversedCommission: "0.00",
        balanceAmount: "35.00",
        barbershopNetAmount: "35.00",
        commandCount: 1,
        serviceCount: 1,
        productCount: 0,
        averageTicket: "70.00",
        effectiveCommissionRate: "50.00",
      },
      members: [
        {
          memberId: "member-barber-456",
          memberName: "Max Victor Guarinieri",
          grossServiceAmount: "70.00",
          grossProductAmount: "0.00",
          discountAmount: "0.00",
          netBaseAmount: "70.00",
          generatedCommission: "35.00",
          releasedCommission: "35.00",
          paidCommission: "0.00",
          reversedCommission: "0.00",
          balanceAmount: "35.00",
          barbershopNetAmount: "35.00",
          commandCount: 1,
          serviceCount: 1,
          productCount: 0,
          averageTicket: "70.00",
          effectiveCommissionRate: "50.00",
        },
      ],
      period: { startDate: "2026-08-01", endDate: "2026-08-31", type: "MONTHLY" },
    };

    const mockDetail = {
      summary: {
        grossService: 70,
        grossProduct: 0,
        discount: 0,
        netBase: 70,
        generated: 70,
        released: 52.5,
        paid: 0,
        reversals: 0,
        rollover: 0,
        manualAdjustments: 0,
        balance: 52.5,
      },
      entries: [
        {
          id: "entry-1",
          type: "SERVICE",
          description: "Combo Corte + Barba",
          customerName: "teste 05",
          comandaId: "6094af2c-ef35-46ad-88fa-38a502e71e31",
          comandaStatus: "CLOSED",
          appointmentId: null,
          itemStatus: "DONE",
          quantity: 1,
          unitPrice: 70,
          total: 70,
          date: "2026-08-05T12:56:10.953Z",
          baseAmount: 70,
          generatedAmount: 35,
          releasedAmount: 35,
          paidAmount: 0,
          reversedAmount: 0,
          status: "RELEASED",
          ruleOrigin: "MEMBER_SERVICE",
          ruleOriginLabel: "Profissional + Serviço",
          ruleType: "PERCENTAGE",
          ruleValue: 50,
        },
      ],
      adjustments: [],
    };

    let requestedDetailUrl = "";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/commissions/overview")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              overview: [
                {
                  member: { id: "member-barber-456", name: "Max Victor Guarinieri", role: "BARBER" },
                  currentCycle: {
                    id: "c1",
                    cycleNumber: 1,
                    status: "OPEN",
                    grossCommission: 70,
                    adjustmentsTotal: 0,
                    advancesTotal: 0,
                    remainingBalance: 70,
                    openedAt: "2026-08-01T00:00:00Z",
                  },
                },
              ],
            }),
        });
      }
      if (url.includes("/api/admin/commissions/members/member-barber-456")) {
        requestedDetailUrl = url;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              member: { id: "member-barber-456", name: "Max Victor Guarinieri", role: "BARBER" },
              currentCycle: {
                id: "c1",
                cycleNumber: 1,
                status: "OPEN",
                grossCommission: 70,
                adjustmentsTotal: 0,
                advancesTotal: 0,
                remainingBalance: 70,
                payableItems: [
                  { id: "p1", type: "RELEASE", amount: 70, createdAt: "2026-08-05T12:00:00Z" },
                ],
              },
            }),
        });
      }
      if (url.includes("/api/admin/commissions/report")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockReport),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });

    render(<AdminComissoesPage />);

    // Aguardar carregamento da tabela principal
    await waitFor(() => {
      expect(screen.getAllByText("Max Victor Guarinieri").length).toBeGreaterThan(0);
    });

    // Clicar em Ver detalhes
    const detailBtn = screen.getByText("Ver detalhes");
    fireEvent.click(detailBtn);

    // Verificar se o endpoint de detalhe do membro foi chamado
    await waitFor(() => {
      expect(requestedDetailUrl).toContain("/api/admin/commissions/members/member-barber-456");
    });

    // Verificar se o modal de extrato abriu com os dados corretos
    await waitFor(() => {
      expect(screen.getByText("Extrato do Profissional")).toBeInTheDocument();
      expect(screen.getByText("RELEASE")).toBeInTheDocument();
    });
  });
});
