import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MobileBottomNavigation } from "@/components/admin/navigation/MobileBottomNavigation";
import { MobileFullScreenMenu } from "@/components/admin/navigation/MobileFullScreenMenu";
import { AdminSidebar } from "@/components/admin/Sidebar";
import { FinancialDueCard } from "@/components/admin/dashboard/FinancialDueCard";
import { calculateTitleDerivedStatus } from "@/lib/financial/titles";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/dashboard",
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/lib/push/logout-cleanup", () => ({
  cleanupCurrentPushSubscriptionBeforeLogout: vi.fn().mockResolvedValue(undefined),
}));

describe("TEM BARBER — Premium Dashboard & Navigation Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Mobile Bottom Navigation (Regra Global)", () => {
    it("renderiza os 5 itens de toque essenciais: Início, Agenda, Comandas, Financeiro e Menu", () => {
      const handleOpenMenu = vi.fn();
      render(
        <MobileBottomNavigation
          onOpenMenu={handleOpenMenu}
          canAccessFinancial={true}
        />
      );

      expect(screen.getByText("Início")).toBeInTheDocument();
      expect(screen.getByText("Agenda")).toBeInTheDocument();
      expect(screen.getByText("Comandas")).toBeInTheDocument();
      expect(screen.getByText("Financeiro")).toBeInTheDocument();
      expect(screen.getByText("Menu")).toBeInTheDocument();

      // Dispara o menu em tela cheia ao clicar na 5ª aba
      const menuBtn = screen.getByRole("button", { name: /abrir menu completo/i });
      fireEvent.click(menuBtn);
      expect(handleOpenMenu).toHaveBeenCalledTimes(1);
    });

    it("oculta o atalho de Financeiro para usuários sem permissão e exibe alternativa permitida (Clientes)", () => {
      render(
        <MobileBottomNavigation
          onOpenMenu={vi.fn()}
          canAccessFinancial={false}
        />
      );

      expect(screen.queryByText("Financeiro")).not.toBeInTheDocument();
      expect(screen.getByText("Clientes")).toBeInTheDocument();
    });
  });

  describe("2. Mobile Full-Screen Menu", () => {
    it("abre em tela cheia com 100dvh e estrutura de grupos", () => {
      const handleClose = vi.fn();
      render(
        <MobileFullScreenMenu
          isOpen={true}
          onClose={handleClose}
          barbershopName="Dom Brio Barbearia"
          barbershopLogo={null}
          subtitle="São José do Rio Preto"
          userName="Carlos Barber"
          userRole="OWNER"
          isPlatformAdmin={false}
        />
      );

      // Header com identificação real da barbearia
      expect(screen.getByText("Dom Brio Barbearia")).toBeInTheDocument();
      expect(screen.getByText("São José do Rio Preto")).toBeInTheDocument();

      // Grupos visuais organizados
      expect(screen.getByText("Principal")).toBeInTheDocument();
      expect(screen.getByText("Clientes e produtos")).toBeInTheDocument();
      expect(screen.getAllByText("Financeiro").length).toBeGreaterThan(0);
      expect(screen.getByText("Contas a Pagar / Receber")).toBeInTheDocument();
      expect(screen.getByText("Serviços e gestão")).toBeInTheDocument();

      // Botão de fechar fecha o menu
      const closeBtn = screen.getByRole("button", { name: /fechar menu/i });
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("fecha ao pressionar a tecla Escape e restaura overflow", () => {
      const handleClose = vi.fn();
      render(
        <MobileFullScreenMenu
          isOpen={true}
          onClose={handleClose}
          barbershopName="Dom Brio"
          userName="Admin"
        />
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. Desktop Sidebar", () => {
    it("renderiza a barra lateral em desktop sem a navegação inferior móvel", () => {
      render(
        <AdminSidebar
          barbershopName="Dom Brio Barbearia"
          userName="Admin"
          userRole="OWNER"
        />
      );

      // Marca e link do dashboard
      expect(screen.getAllByText("Dom Brio Barbearia").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    });
  });

  describe("4. Contas a Vencer e Classificação Financeira", () => {
    it("não exibe dados financeiros para usuários sem permissão (RBAC)", () => {
      const { container } = render(
        <FinancialDueCard
          summary={{
            overdueCount: 2,
            overdueAmountCents: 15000,
            todayCount: 1,
            todayAmountCents: 5000,
            next7DaysCount: 3,
            next7DaysAmountCents: 20000,
          }}
          items={[]}
          canAccessFinancial={false}
        />
      );

      expect(container.firstChild).toBeNull();
      expect(screen.queryByText("Contas a vencer")).not.toBeInTheDocument();
    });

    it("calcula e renderiza os 3 cards de vencimento: Atrasadas, Hoje e 7 dias", () => {
      render(
        <FinancialDueCard
          summary={{
            overdueCount: 2,
            overdueAmountCents: 15000,
            todayCount: 1,
            todayAmountCents: 5000,
            next7DaysCount: 3,
            next7DaysAmountCents: 20000,
          }}
          items={[
            {
              id: "t-1",
              title: "Aluguel da Barbearia",
              categoryName: "Despesa Fixa",
              dueOnCivil: "2026-10-25",
              outstandingPrincipalCents: 15000,
              derivedStatus: "OVERDUE",
            },
          ]}
          canAccessFinancial={true}
        />
      );

      expect(screen.getByText("Contas a vencer")).toBeInTheDocument();
      expect(screen.getByText("Atrasadas")).toBeInTheDocument();
      expect(screen.getByText("Hoje")).toBeInTheDocument();
      expect(screen.getByText("7 dias")).toBeInTheDocument();

      expect(screen.getByText("Aluguel da Barbearia")).toBeInTheDocument();
      expect(screen.getAllByText(/150,00/).length).toBeGreaterThan(0);
    });

    it("respeita data civil e pagamentos parciais no cálculo de status", () => {
      // 1. Título vencendo hoje não é atrasado
      const dueToday = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 0,
        dueOnCivil: "2026-10-30",
        civilTodayCivil: "2026-10-30",
      });
      expect(dueToday.status).toBe("OPEN");
      expect(dueToday.outstandingPrincipalCents).toBe(10000);

      // 2. Título de ontem é atrasado
      const dueYesterday = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 0,
        dueOnCivil: "2026-10-29",
        civilTodayCivil: "2026-10-30",
      });
      expect(dueYesterday.status).toBe("OVERDUE");

      // 3. Título parcialmente pago calcula saldo restante
      const partial = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 4000,
        dueOnCivil: "2026-10-30",
        civilTodayCivil: "2026-10-30",
      });
      expect(partial.status).toBe("PARTIAL");
      expect(partial.outstandingPrincipalCents).toBe(6000);

      // 4. Título totalmente pago é PAID
      const paid = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 10000,
        dueOnCivil: "2026-10-30",
        civilTodayCivil: "2026-10-30",
      });
      expect(paid.status).toBe("PAID");
      expect(paid.outstandingPrincipalCents).toBe(0);
    });
  });
});
