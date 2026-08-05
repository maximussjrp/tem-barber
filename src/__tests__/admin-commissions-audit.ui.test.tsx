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
    const mockPeriods = [
      {
        id: "period-123", // CommissionPeriod id
        memberId: "member-barber-456", // Actual BarbershopMember id
        competence: "2026-08",
        status: "OPEN",
        generatedAmount: "70.00",
        releasedAmount: "52.50",
        paidAmount: "0.00",
        reversedAmount: "0.00",
        balanceAmount: "52.50",
        member: { id: "member-barber-456", user: { name: "Max Victor Guarinieri" } },
      },
    ];

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
      if (url.includes("/api/admin/commissions/detail")) {
        requestedDetailUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDetail),
        });
      }
      if (url.includes("/api/admin/commissions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockPeriods),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });

    render(<AdminComissoesPage />);

    // Aguardar carregamento da tabela principal
    await waitFor(() => {
      expect(screen.getByText("Max Victor Guarinieri")).toBeInTheDocument();
    });

    // Clicar na linha para abrir auditoria
    fireEvent.click(screen.getByText("Max Victor Guarinieri"));

    // Verificar se o endpoint de auditoria foi chamado com memberId="member-barber-456" e NÃO "period-123"
    await waitFor(() => {
      expect(requestedDetailUrl).toContain("memberId=member-barber-456");
      expect(requestedDetailUrl).not.toContain("memberId=period-123");
    });

    // Verificar se o drawer abriu com os dados corretos
    await waitFor(() => {
      expect(screen.getByText("Auditoria: Max Victor Guarinieri")).toBeInTheDocument();
      expect(screen.getByText("Combo Corte + Barba")).toBeInTheDocument();
    });
  });
});
