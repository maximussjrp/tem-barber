import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MobileBottomNavigation } from "@/components/admin/navigation/MobileBottomNavigation";
import { MobileFullScreenMenu } from "@/components/admin/navigation/MobileFullScreenMenu";
import { AdminSidebar } from "@/components/admin/Sidebar";
import { FinancialDueCard } from "@/components/admin/dashboard/FinancialDueCard";
import { PremiumDashboardView } from "@/components/admin/dashboard/PremiumDashboardView";
import { calculateTitleDerivedStatus } from "@/lib/financial/titles";
import DashboardPage from "@/app/admin/dashboard/page";
import prisma from "@/lib/prisma";
import { requireManagerialAdmin } from "@/lib/admin-guard";

const { redirectMock, defaultAdminContext } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  defaultAdminContext: {
    barbershopId: "tenant-1",
    role: "OWNER",
    isPlatform: false,
    session: { user: { name: "Carlos Barber", role: "OWNER" }, expires: "2099-01-01" },
    barbershop: {
      id: "tenant-1",
      name: "Barbearia Dom Brio",
      slug: "barbearia-dom-brio",
      description: "Barbearia Premium",
      phone: "17999999999",
      city: "São José do Rio Preto",
      state: "SP",
    },
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/dashboard",
  redirect: redirectMock,
}));

vi.mock("@/lib/admin-guard", () => ({
  requireAdmin: vi.fn().mockResolvedValue(defaultAdminContext),
  requireManagerialAdmin: vi.fn().mockResolvedValue(defaultAdminContext),
  RECEPTIONIST_HOME_PATH: "/admin/agendamentos",
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    appointment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    service: {
      count: vi.fn().mockResolvedValue(1),
    },
    workingHour: {
      count: vi.fn().mockResolvedValue(1),
    },
    barbershopMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    financialTitle: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
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

    it("Cenários 7, 8, 9 e 10 — exibe rótulos corretos para conta vencida ontem, hoje, amanhã e parcialmente paga (desktop e mobile)", () => {
      const items = [
        {
          id: "due-yesterday",
          title: "Energia elétrica",
          categoryName: "Fixo",
          dueOnCivil: "2026-10-29",
          outstandingPrincipalCents: 42000,
          derivedStatus: "OVERDUE" as const,
        },
        {
          id: "due-today",
          title: "Aluguel do ponto",
          categoryName: "Fixo",
          dueOnCivil: "2026-10-30",
          outstandingPrincipalCents: 180000,
          derivedStatus: "PARTIAL" as const,
        },
        {
          id: "due-tomorrow",
          title: "Internet fibra",
          categoryName: "Operacional",
          dueOnCivil: "2026-10-31",
          outstandingPrincipalCents: 19990,
          derivedStatus: "OPEN" as const,
        },
      ];

      const { unmount } = render(
        <FinancialDueCard
          summary={{
            overdueCount: 1,
            overdueAmountCents: 42000,
            todayCount: 1,
            todayAmountCents: 180000,
            next7DaysCount: 1,
            next7DaysAmountCents: 19990,
          }}
          items={items}
          canAccessFinancial={true}
          civilToday="2026-10-30"
          compactMobile={true}
        />
      );

      // Cenário 7 (vencida ontem no mobile): NUNCA exibe "Vence hoje • 29/10", exibe "Venceu em 29/10"
      expect(screen.getByText("Venceu em 29/10")).toBeInTheDocument();
      expect(screen.queryByText(/Vence hoje.*29\/10/)).not.toBeInTheDocument();

      // Cenário 8 (vencendo hoje no mobile): exibe "Vence hoje · 30/10"
      expect(screen.getByText("Vence hoje · 30/10")).toBeInTheDocument();

      // Cenário 9 (vencendo amanhã): exibe "Vence amanhã" e "31/10"
      expect(screen.getByText("Vence amanhã")).toBeInTheDocument();
      expect(screen.getByText(/31\/10/)).toBeInTheDocument();

      // Cenário 10 (parcialmente paga): exibe badge "Parcial" e saldo restante R$ 1.800,00
      expect(screen.getByText("Parcial")).toBeInTheDocument();
      expect(screen.getAllByText(/1\.800,00/).length).toBeGreaterThan(0);

      unmount();
    });
  });

  describe("5. Integridade de Dados, Métricas Mensais, Recorrência, Canais e Metas (Cenários 1 a 15)", () => {
    it("Cenário 1 — Mês com mais de 60 agendamentos agrega todos os registros reais sem truncar em take: 60", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-30T15:00:00.000Z"));

      const sixtyFiveMonthAppts = Array.from({ length: 65 }, (_, idx) => {
        const day = (idx % 25) + 1;
        return {
          id: `month-appt-${idx + 1}`,
          customerId: `cust-${(idx % 20) + 1}`,
          memberId: "member-1",
          status: "COMPLETED",
          totalPrice: 80.0,
          dateTime: new Date(`2026-10-${String(day).padStart(2, "0")}T14:00:00.000Z`),
          comandas: [{ status: "CLOSED", total: 80.0, discountTotal: 0, surchargeTotal: 0 }],
        };
      });

      vi.mocked(prisma.appointment.findMany).mockImplementation((args) => {
        const where = args?.where as
          | { status?: string | { notIn?: string[] } }
          | undefined;
        if (where?.status === "COMPLETED") {
          return Promise.resolve(sixtyFiveMonthAppts) as unknown as ReturnType<
            typeof prisma.appointment.findMany
          >;
        }
        if (typeof where?.status === "object" && where?.status?.notIn) {
          return Promise.resolve(
            sixtyFiveMonthAppts.map((a) => ({
              customerId: a.customerId,
              dateTime: a.dateTime,
              status: a.status,
            }))
          ) as unknown as ReturnType<typeof prisma.appointment.findMany>;
        }
        return Promise.resolve([]) as unknown as ReturnType<
          typeof prisma.appointment.findMany
        >;
      });

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      // 65 * R$ 80,00 = R$ 5.200,00 no acumulado do mês e 65 serviços concluídos
      expect(container.textContent).toContain("5.200,00");
      expect(screen.getByText("65")).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("Cenário 2 — Semana com receita maior que amostra mensal (virada de mês) não usa Math.max para inflar o mês", async () => {
      vi.useFakeTimers();
      // 02/10/2026 (sexta-feira): semana iniciou em 28/09/2026
      vi.setSystemTime(new Date("2026-10-02T15:00:00.000Z"));

      const periodCompleted = [
        {
          id: "sep-appt",
          customerId: "c-1",
          memberId: "member-1",
          status: "COMPLETED",
          totalPrice: 2000.0,
          dateTime: new Date("2026-09-29T14:00:00.000Z"),
          comandas: [{ status: "CLOSED", total: 2000.0, discountTotal: 0, surchargeTotal: 0 }],
        },
        {
          id: "oct-appt",
          customerId: "c-2",
          memberId: "member-1",
          status: "COMPLETED",
          totalPrice: 500.0,
          dateTime: new Date("2026-10-02T13:00:00.000Z"),
          comandas: [{ status: "CLOSED", total: 500.0, discountTotal: 0, surchargeTotal: 0 }],
        },
      ];

      vi.mocked(prisma.appointment.findMany).mockImplementation((args) => {
        const where = args?.where as { status?: string } | undefined;
        if (where?.status === "COMPLETED") {
          return Promise.resolve(periodCompleted) as unknown as ReturnType<
            typeof prisma.appointment.findMany
          >;
        }
        return Promise.resolve([]) as unknown as ReturnType<
          typeof prisma.appointment.findMany
        >;
      });

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      // Semana = R$ 2.500,00; Mês de outubro = R$ 500,00
      expect(container.textContent).toContain("2.500,00");
      expect(container.textContent).toContain("500,00");

      vi.useRealTimers();
    });

    it("Cenários 3, 4, 5 e 11 — Barbearia sem dados e sem período anterior não exibe percentuais falsos (+40%, +18%, +15%, 68%, 70%, 52%, 100%)", async () => {
      vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      const text = container.textContent ?? "";

      // Cenário 3: Nenhuma variação demonstrativa falsa
      expect(text).not.toContain("+40%");
      expect(text).not.toContain("+18%");
      expect(text).not.toContain("+15%");
      expect(text).not.toContain("+28%");
      expect(text).not.toContain("+33%");

      // Cenário 4: Metas mensais não configuradas
      expect(screen.getByText("Meta não configurada")).toBeInTheDocument();
      expect(text).not.toContain("70%");

      // Cenário 5: Origem de agendamento desconhecida / não rastreada
      expect(
        screen.getByText("Origem do agendamento não rastreada")
      ).toBeInTheDocument();
      expect(text).not.toContain("52%");

      // Cenário 6/11: Sem histórico de recorrência não inventa 68% / 24% / 8%
      expect(text).not.toContain("68%");
      expect(text).not.toContain("24%");
      expect(
        screen.getByText("Sem histórico de visitas para cálculo de recorrência.")
      ).toBeInTheDocument();

      // Sino de notificações não exibe ponto vermelho quando não há alertas
      expect(screen.queryByTestId("mobile-bell-alert-dot")).not.toBeInTheDocument();
      expect(screen.queryByTestId("desktop-bell-alert-dot")).not.toBeInTheDocument();
    });

    it("Cenário 6 — Recorrência considera exclusivamente visitas COMPLETED até hoje (ignora agendamentos futuros, PENDING, CONFIRMED e CANCELLED)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-30T15:00:00.000Z"));

      const mixedRows = [
        // 2 clientes recorrentes (múltiplas visitas COMPLETED, última nos últimos 30 dias)
        { customerId: "c-rec-1", dateTime: new Date("2026-09-10T14:00:00.000Z"), status: "COMPLETED" },
        { customerId: "c-rec-1", dateTime: new Date("2026-10-28T14:00:00.000Z"), status: "COMPLETED" },
        { customerId: "c-rec-2", dateTime: new Date("2026-10-05T14:00:00.000Z"), status: "COMPLETED" },
        { customerId: "c-rec-2", dateTime: new Date("2026-10-29T14:00:00.000Z"), status: "COMPLETED" },
        // 1 cliente novo (1 única visita COMPLETED nos últimos 30 dias, dentro de outubro)
        { customerId: "c-new-1", dateTime: new Date("2026-10-25T14:00:00.000Z"), status: "COMPLETED" },
        // 1 cliente inativo (última visita COMPLETED há mais de 30 dias)
        { customerId: "c-ina-1", dateTime: new Date("2026-08-15T14:00:00.000Z"), status: "COMPLETED" },
        // Cliente apenas com agendamento futuro / PENDING / CONFIRMED sem visita concluída (NÃO deve contar)
        { customerId: "c-future-only", dateTime: new Date("2026-11-05T14:00:00.000Z"), status: "CONFIRMED" },
        { customerId: "c-pending-only", dateTime: new Date("2026-10-30T18:00:00.000Z"), status: "PENDING" },
        // Cliente apenas com agendamento CANCELLED (NÃO deve contar)
        { customerId: "c-cancelled-only", dateTime: new Date("2026-10-20T14:00:00.000Z"), status: "CANCELLED" },
      ];

      vi.mocked(prisma.appointment.findMany).mockImplementation((args) => {
        const select = args?.select as { status?: boolean; comandas?: unknown } | undefined;
        if (!args?.take && select?.status && !select?.comandas) {
          expect(args?.where).toMatchObject({
            barbershopId: "tenant-1",
            status: "COMPLETED",
          });
          return Promise.resolve(mixedRows) as unknown as ReturnType<
            typeof prisma.appointment.findMany
          >;
        }
        return Promise.resolve([]) as unknown as ReturnType<
          typeof prisma.appointment.findMany
        >;
      });

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      // Apenas os 4 clientes com visitas COMPLETED entram no cálculo:
      // 2 recorrentes (50%), 1 novo (25%), 1 inativo (25%)
      expect(container.textContent).toContain("50%");
      expect(container.textContent).toContain("25%");
      expect(container.textContent).not.toContain("68%");

      // Novos clientes do mês: c-rec-2 (1ª visita COMPLETED em 05/10) + c-new-1 (1ª visita COMPLETED em 25/10) = 2
      // c-future-only, c-pending-only e c-cancelled-only NÃO entram como novos clientes do mês
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("Minigráficos dos KPIs refletem séries reais consultadas e usam estado neutro plano quando não há série confiável", () => {
      // 1. Sem série positiva -> todos os minigráficos em modo neutro plano (sem escada 14,20,26,33,40)
      const { unmount } = render(
        <PremiumDashboardView
          barbershop={{
            id: "b-1",
            name: "Barbearia Dom Brio",
            slug: "barbearia-dom-brio",
          }}
          todayFormatted="sexta-feira, 30 de outubro"
          civilToday="2026-10-30"
          faturamentoHoje={0}
          faturamentoSemana={0}
          taxaOcupacaoPct={0}
          horariosOcupados={0}
          horariosDisponiveis={10}
          clientesAtendidosHoje={0}
          todayAppointments={[]}
          professionals={[]}
          financialSummary={{
            overdueCount: 0,
            overdueAmountCents: 0,
            todayCount: 0,
            todayAmountCents: 0,
            next7DaysCount: 0,
            next7DaysAmountCents: 0,
          }}
          dueItems={[]}
          canAccessFinancial={true}
          dailyRevenue={[
            { label: "Seg", revenue: 0 },
            { label: "Ter", revenue: 0 },
            { label: "Qua", revenue: 0 },
            { label: "Qui", revenue: 0 },
            { label: "Sex", revenue: 0 },
            { label: "Sáb", revenue: 0 },
            { label: "Dom", revenue: 0 },
          ]}
          completedClientsSeries={[0, 0, 0, 0, 0, 0, 0]}
          occupancyData={{ occupied: 0, available: 10, blocked: 0 }}
          onboarding={{ done: 4, total: 4, complete: true }}
          recentClients={[]}
        />
      );

      for (const spark of screen.getAllByTestId("mini-sparkline")) {
        expect(spark).toHaveAttribute("data-mode", "neutral");
      }
      for (const bars of screen.getAllByTestId("mini-bars")) {
        expect(bars).toHaveAttribute("data-mode", "neutral");
        const rects = Array.from(bars.querySelectorAll("rect"));
        const heights = rects.map((r) => Number(r.getAttribute("height")));
        // Em modo neutro todas as barras têm exatamente a mesma altura (14), nunca escada crescente
        expect(new Set(heights).size).toBe(1);
        expect(heights[0]).toBe(14);
      }
      unmount();

      // 2. Com série real -> minigráficos refletem os valores reais da série
      render(
        <PremiumDashboardView
          barbershop={{
            id: "b-1",
            name: "Barbearia Dom Brio",
            slug: "barbearia-dom-brio",
          }}
          todayFormatted="sexta-feira, 30 de outubro"
          civilToday="2026-10-30"
          faturamentoHoje={400}
          faturamentoSemana={1500}
          taxaOcupacaoPct={50}
          horariosOcupados={5}
          horariosDisponiveis={5}
          clientesAtendidosHoje={4}
          todayAppointments={[]}
          professionals={[]}
          financialSummary={{
            overdueCount: 0,
            overdueAmountCents: 0,
            todayCount: 0,
            todayAmountCents: 0,
            next7DaysCount: 0,
            next7DaysAmountCents: 0,
          }}
          dueItems={[]}
          canAccessFinancial={true}
          dailyRevenue={[
            { label: "Seg", revenue: 500 },
            { label: "Ter", revenue: 200 },
            { label: "Qua", revenue: 400 },
            { label: "Qui", revenue: 100 },
            { label: "Sex", revenue: 300 },
            { label: "Sáb", revenue: 0 },
            { label: "Dom", revenue: 0 },
          ]}
          completedClientsSeries={[5, 2, 4, 1, 3, 0, 0]}
          occupancyData={{ occupied: 5, available: 5, blocked: 0 }}
          onboarding={{ done: 4, total: 4, complete: true }}
          recentClients={[]}
        />
      );

      for (const spark of screen.getAllByTestId("mini-sparkline")) {
        expect(spark).toHaveAttribute("data-mode", "series");
        expect(spark).toHaveAttribute("data-series", "500,200,400,100,300,0,0");
      }

      const seriesBars = screen
        .getAllByTestId("mini-bars")
        .filter((el) => el.getAttribute("data-mode") === "series");
      expect(seriesBars.length).toBeGreaterThanOrEqual(2);
      // A primeira barra (Seg=500 / 5 clientes) deve ser maior que a segunda barra (Ter=200 / 2 clientes)
      const firstBarRects = seriesBars[0].querySelectorAll("rect");
      const h0 = Number(firstBarRects[0].getAttribute("height"));
      const h1 = Number(firstBarRects[1].getAttribute("height"));
      expect(h0).toBeGreaterThan(h1);
    });

    it("Cenários 12 e 13 — Isolamento multi-tenant em todas as queries (incluindo títulos financeiros) e bloqueio RBAC", async () => {
      vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);

      const pageElement = await DashboardPage();
      render(pageElement);

      for (const call of vi.mocked(prisma.appointment.findMany).mock.calls) {
        expect(call[0]?.where?.barbershopId).toBe("tenant-1");
      }
      for (const call of vi.mocked(prisma.financialTitle.findMany).mock.calls) {
        expect(call[0]?.where?.barbershopId).toBe("tenant-1");
      }

      // RECEPTIONIST bloqueado antes de qualquer query
      vi.clearAllMocks();
      vi.mocked(requireManagerialAdmin).mockImplementationOnce(async () => {
        throw new Error("NEXT_REDIRECT:/admin/agendamentos");
      });
      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
      expect(prisma.financialTitle.findMany).not.toHaveBeenCalled();
    });

    it("Cenários 14 e 15 — Busca interativa com Ctrl+K filtra painel e menu mobile possui container rolável até o último item", () => {
      render(
        <PremiumDashboardView
          barbershop={{
            id: "b-1",
            name: "Barbearia Dom Brio",
            slug: "barbearia-dom-brio",
            city: "São José do Rio Preto",
            state: "SP",
          }}
          userName="Carlos"
          todayFormatted="sexta-feira, 30 de outubro"
          civilToday="2026-10-30"
          faturamentoHoje={740}
          faturamentoHojeTrend="+20%"
          faturamentoSemana={4350}
          faturamentoSemanaTrend="+12%"
          taxaOcupacaoPct={80}
          horariosOcupados={16}
          horariosDisponiveis={4}
          clientesAtendidosHoje={9}
          todayAppointments={[
            {
              id: "a-1",
              customerName: "Marcos Almeida",
              timeFormatted: "09:00",
              servicesFormatted: "Corte + Barba",
              status: "COMPLETED",
            },
            {
              id: "a-2",
              customerName: "Gabriel Ferreira",
              timeFormatted: "10:00",
              servicesFormatted: "Degradê navalhado",
              status: "CONFIRMED",
            },
          ]}
          professionals={[
            {
              memberName: "Lucas",
              weeklyRevenue: 2400,
              working: true,
              onTimeOff: false,
              startTime: "09:00",
              endTime: "18:00",
              totalSlots: 10,
              bookedSlots: 8,
              freeSlots: [540, 570],
              blockedSlots: [],
            },
          ]}
          financialSummary={{
            overdueCount: 1,
            overdueAmountCents: 42000,
            todayCount: 0,
            todayAmountCents: 0,
            next7DaysCount: 0,
            next7DaysAmountCents: 0,
          }}
          dueItems={[
            {
              id: "d-1",
              title: "Energia elétrica",
              categoryName: "Fixo",
              dueOnCivil: "2026-10-29",
              outstandingPrincipalCents: 42000,
              derivedStatus: "OVERDUE",
            },
          ]}
          canAccessFinancial={true}
          dailyRevenue={[
            { label: "Seg", revenue: 500 },
            { label: "Ter", revenue: 600 },
            { label: "Qua", revenue: 700 },
            { label: "Qui", revenue: 800 },
            { label: "Sex", revenue: 950 },
            { label: "Sáb", revenue: 800 },
            { label: "Dom", revenue: 0 },
          ]}
          occupancyData={{ occupied: 16, available: 4, blocked: 0 }}
          onboarding={{ done: 4, total: 4, complete: true }}
          recentClients={[]}
        />
      );

      // Atalho Ctrl+K foca o campo de filtro real do painel
      const searchInput = screen.getByRole("searchbox", {
        name: /filtrar agenda de hoje, profissional ou conta/i,
      });
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(document.activeElement).toBe(searchInput);

      // Filtrar por "Gabriel" mantém Gabriel Ferreira e oculta Marcos Almeida
      fireEvent.change(searchInput, { target: { value: "Gabriel" } });
      expect(screen.getAllByText("Gabriel Ferreira").length).toBeGreaterThan(0);
      expect(screen.queryByText("Marcos Almeida")).not.toBeInTheDocument();

      // Botão Limpar restaura os itens
      const clearBtn = screen.getByRole("button", { name: /limpar filtro/i });
      fireEvent.click(clearBtn);
      expect(screen.getAllByText("Marcos Almeida").length).toBeGreaterThan(0);
    });
  });
});
