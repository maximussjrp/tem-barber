import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

const {
  redirectMock,
  usePathnameMock,
  useSearchParamsMock,
  defaultAdminContext,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  usePathnameMock: vi.fn(() => "/admin/dashboard"),
  useSearchParamsMock: vi.fn(() => new URLSearchParams("")),
  defaultAdminContext: {
    barbershopId: "tenant-1",
    role: "OWNER",
    isPlatform: false,
    session: {
      user: { name: "Carlos Barber", role: "OWNER" },
      expires: "2099-01-01",
    },
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
  usePathname: () => usePathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
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
    comanda: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/lib/push/logout-cleanup", () => ({
  cleanupCurrentPushSubscriptionBeforeLogout: vi
    .fn()
    .mockResolvedValue(undefined),
}));

describe("TEM BARBER — Premium Dashboard V2 & Operational Corrections Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/admin/dashboard");
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
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

      const menuBtn = screen.getByRole("button", {
        name: /abrir menu completo/i,
      });
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

      expect(screen.getByText("Dom Brio Barbearia")).toBeInTheDocument();
      expect(screen.getByText("São José do Rio Preto")).toBeInTheDocument();

      expect(screen.getByText("Principal")).toBeInTheDocument();
      expect(screen.getByText("Clientes e produtos")).toBeInTheDocument();
      expect(screen.getAllByText("Financeiro").length).toBeGreaterThan(0);
      expect(screen.getByText("Contas a Pagar / Receber")).toBeInTheDocument();
      expect(screen.getByText("Serviços e gestão")).toBeInTheDocument();

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

  describe("3. Desktop Sidebar — Correção 2 (Destaques de Rota Ativa vs Grupo Expandido)", () => {
    it("em /admin/dashboard destaca apenas Dashboard e nunca destaca Financeiro ou Relatórios mesmo quando expandidos", () => {
      usePathnameMock.mockReturnValue("/admin/dashboard");
      const { container } = render(
        <AdminSidebar
          barbershopName="Dom Brio Barbearia"
          userName="Admin"
          userRole="OWNER"
        />
      );

      const activeLinks = container.querySelectorAll('[aria-current="page"]');
      expect(activeLinks.length).toBe(1);
      expect(activeLinks[0].textContent).toContain("Dashboard");

      const financeiroBtn = screen.getByTestId("sidebar-group-financeiro");
      const relatoriosBtn = screen.getByTestId("sidebar-group-relatorios");

      // Expandir Financeiro e Relatórios na página Dashboard NÃO deve marcar grupo como ativo nem aplicar borda dourada
      fireEvent.click(financeiroBtn);
      fireEvent.click(relatoriosBtn);

      expect(financeiroBtn).toHaveAttribute("data-group-active", "false");
      expect(financeiroBtn).toHaveAttribute("data-expanded", "true");
      expect(financeiroBtn.className).not.toContain("border-[#D3AE55]");

      expect(relatoriosBtn).toHaveAttribute("data-group-active", "false");
      expect(relatoriosBtn).toHaveAttribute("data-expanded", "true");
      expect(relatoriosBtn.className).not.toContain("border-[#D3AE55]");

      // Continua havendo apenas 1 item com aria-current="page"
      expect(container.querySelectorAll('[aria-current="page"]').length).toBe(
        1
      );
    });

    it("separa corretamente Financeiro (/admin/financeiro), Relatórios (/admin/financeiro/relatorio-gerencial), Contas a Pagar (?kind=PAYABLE) e Contas a Receber (?kind=RECEIVABLE)", () => {
      // 1. Rota /admin/financeiro/relatorio-gerencial -> destaca Relatório Gerencial em Relatórios, NÃO destaca Financeiro
      const { container, unmount } = render(
        <AdminSidebar
          barbershopName="Dom Brio Barbearia"
          userName="Admin"
          userRole="OWNER"
          currentPathname="/admin/financeiro/relatorio-gerencial"
          currentSearch=""
        />
      );

      expect(screen.getByTestId("sidebar-group-relatorios")).toHaveAttribute(
        "data-group-active",
        "true"
      );
      expect(screen.getByTestId("sidebar-group-financeiro")).toHaveAttribute(
        "data-group-active",
        "false"
      );

      const activeOnRel = container.querySelectorAll('[aria-current="page"]');
      expect(activeOnRel.length).toBe(1);
      expect(activeOnRel[0].textContent).toContain("Relatório Gerencial");
      unmount();

      // 2. Rota /admin/financeiro/contas?kind=PAYABLE -> destaca apenas Contas a Pagar
      const { container: c2, unmount: u2 } = render(
        <AdminSidebar
          barbershopName="Dom Brio Barbearia"
          userName="Admin"
          userRole="OWNER"
          currentPathname="/admin/financeiro/contas"
          currentSearch="kind=PAYABLE"
        />
      );
      const activeOnPayable = c2.querySelectorAll('[aria-current="page"]');
      expect(activeOnPayable.length).toBe(1);
      expect(activeOnPayable[0].textContent).toContain("Contas a Pagar");
      expect(
        screen.getByTestId("sidebar-subitem-contas-receber")
      ).toHaveAttribute("data-active", "false");
      u2();

      // 3. Rota /admin/financeiro/contas?kind=RECEIVABLE -> destaca apenas Contas a Receber
      const { container: c3, unmount: u3 } = render(
        <AdminSidebar
          barbershopName="Dom Brio Barbearia"
          userName="Admin"
          userRole="OWNER"
          currentPathname="/admin/financeiro/contas"
          currentSearch="kind=RECEIVABLE"
        />
      );
      const activeOnReceivable = c3.querySelectorAll('[aria-current="page"]');
      expect(activeOnReceivable.length).toBe(1);
      expect(activeOnReceivable[0].textContent).toContain("Contas a Receber");
      expect(
        screen.getByTestId("sidebar-subitem-contas-pagar")
      ).toHaveAttribute("data-active", "false");
      u3();
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
      const dueToday = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 0,
        dueOnCivil: "2026-10-30",
        civilTodayCivil: "2026-10-30",
      });
      expect(dueToday.status).toBe("OPEN");
      expect(dueToday.outstandingPrincipalCents).toBe(10000);

      const dueYesterday = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 0,
        dueOnCivil: "2026-10-29",
        civilTodayCivil: "2026-10-30",
      });
      expect(dueYesterday.status).toBe("OVERDUE");

      const partial = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 4000,
        dueOnCivil: "2026-10-30",
        civilTodayCivil: "2026-10-30",
      });
      expect(partial.status).toBe("PARTIAL");
      expect(partial.outstandingPrincipalCents).toBe(6000);

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

      expect(screen.getByText("Venceu em 29/10")).toBeInTheDocument();
      expect(screen.queryByText(/Vence hoje.*29\/10/)).not.toBeInTheDocument();
      expect(screen.getByText("Vence hoje · 30/10")).toBeInTheDocument();
      expect(screen.getByText("Vence amanhã")).toBeInTheDocument();
      expect(screen.getByText(/31\/10/)).toBeInTheDocument();
      expect(screen.getByText("Parcial")).toBeInTheDocument();
      expect(screen.getAllByText(/1\.800,00/).length).toBeGreaterThan(0);

      unmount();
    });
  });

  describe("5. Integridade de Dados, Ocupação Real, Horários de Hoje, Produtividade e Resumo dos Atendimentos", () => {
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
          dateTime: new Date(
            `2026-10-${String(day).padStart(2, "0")}T14:00:00.000Z`
          ),
          comandas: [
            {
              status: "CLOSED",
              total: 80.0,
              discountTotal: 0,
              surchargeTotal: 0,
            },
          ],
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
        return Promise.resolve([]) as unknown as ReturnType<
          typeof prisma.appointment.findMany
        >;
      });

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      expect(container.textContent).toContain("5.200,00");
      expect(screen.getByText("65")).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("Cenário 2 — Semana com receita maior que amostra mensal (virada de mês) não usa Math.max para inflar o mês", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-02T15:00:00.000Z"));

      const periodCompleted = [
        {
          id: "sep-appt",
          customerId: "c-1",
          memberId: "member-1",
          status: "COMPLETED",
          totalPrice: 2000.0,
          dateTime: new Date("2026-09-29T14:00:00.000Z"),
          comandas: [
            {
              status: "CLOSED",
              total: 2000.0,
              discountTotal: 0,
              surchargeTotal: 0,
            },
          ],
        },
        {
          id: "oct-appt",
          customerId: "c-2",
          memberId: "member-1",
          status: "COMPLETED",
          totalPrice: 500.0,
          dateTime: new Date("2026-10-02T13:00:00.000Z"),
          comandas: [
            {
              status: "CLOSED",
              total: 500.0,
              discountTotal: 0,
              surchargeTotal: 0,
            },
          ],
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

      expect(container.textContent).toContain("2.500,00");
      expect(container.textContent).toContain("500,00");

      vi.useRealTimers();
    });

    it("Cenários 3, 4, 5 e 11 — Barbearia sem dados não exibe percentuais falsos, remove Performance por canal e exibe Resumo dos atendimentos", async () => {
      vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);

      const pageElement = await DashboardPage();
      const { container } = render(pageElement);

      const text = container.textContent ?? "";

      expect(text).not.toContain("+40%");
      expect(text).not.toContain("+18%");
      expect(text).not.toContain("+15%");
      expect(text).not.toContain("+28%");
      expect(text).not.toContain("+33%");

      expect(screen.getByText("Meta não configurada")).toBeInTheDocument();
      expect(text).not.toContain("70%");

      // Correção 6: "Performance por canal" foi substituído por "Resumo dos atendimentos"
      expect(
        screen.queryByText("Performance por canal")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Origem do agendamento não rastreada")
      ).not.toBeInTheDocument();
      expect(screen.getByText("Resumo dos atendimentos")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Nenhum atendimento registrado para hoje até o momento."
        )
      ).toBeInTheDocument();

      // Correção 3: Capacidade zero tratada sem divisão por zero
      expect(
        screen.getByText("Capacidade indisponível hoje (0 min)")
      ).toBeInTheDocument();

      expect(text).not.toContain("68%");
      expect(text).not.toContain("24%");
      expect(
        screen.getByText(
          "Sem histórico de visitas para cálculo de recorrência."
        )
      ).toBeInTheDocument();

      expect(
        screen.queryByTestId("mobile-bell-alert-dot")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("desktop-bell-alert-dot")
      ).not.toBeInTheDocument();
    });

    it("Cenário 6 — Recorrência considera exclusivamente visitas COMPLETED até hoje (ignora agendamentos futuros, PENDING, CONFIRMED e CANCELLED)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-30T15:00:00.000Z"));

      const mixedRows = [
        {
          customerId: "c-rec-1",
          dateTime: new Date("2026-09-10T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-rec-1",
          dateTime: new Date("2026-10-28T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-rec-2",
          dateTime: new Date("2026-10-05T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-rec-2",
          dateTime: new Date("2026-10-29T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-new-1",
          dateTime: new Date("2026-10-25T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-ina-1",
          dateTime: new Date("2026-08-15T14:00:00.000Z"),
          status: "COMPLETED",
        },
        {
          customerId: "c-future-only",
          dateTime: new Date("2026-11-05T14:00:00.000Z"),
          status: "CONFIRMED",
        },
        {
          customerId: "c-pending-only",
          dateTime: new Date("2026-10-30T18:00:00.000Z"),
          status: "PENDING",
        },
        {
          customerId: "c-cancelled-only",
          dateTime: new Date("2026-10-20T14:00:00.000Z"),
          status: "CANCELLED",
        },
      ];

      vi.mocked(prisma.appointment.findMany).mockImplementation((args) => {
        const select = args?.select as
          | { status?: boolean; comandas?: unknown }
          | undefined;
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

      expect(container.textContent).toContain("50%");
      expect(container.textContent).toContain("25%");
      expect(container.textContent).not.toContain("68%");
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("Correções 1, 3, 4, 5 e 6 — Renderiza sobrecarga >100% (118,75%), Horários de hoje com estado Concluído (roxo) e Agendado (dourado), Desempenho Diário e Resumo dos Atendimentos", async () => {
      vi.useFakeTimers();
      // 12:00 UTC = 09:00 BR em 2026-10-30
      vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));

      // Profissional com jornada de 8h (09:00 às 17:00 = 480 min = 16 cortes de 30m)
      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValue([
        {
          id: "member-1",
          user: { name: "Lucas Mendes", avatarUrl: null },
          services: [{ serviceId: "srv-1" }],
          workingHours: [
            {
              dayOfWeek: 5,
              startTime: "09:00",
              endTime: "17:00",
              breakStart: null,
              breakEnd: null,
              isActive: true,
            },
          ],
          timeOffs: [],
        } as unknown as Awaited<
          ReturnType<typeof prisma.barbershopMember.findMany>
        >[number],
      ]);

      // 12 atendimentos COMPLETED de 30m (09:00..14:30) + 7 agendamentos CONFIRMED/PENDING de 30m (15:00..18:00) = 19 cortes (570 min) -> 118,75%
      // + 1 CANCELLED e 1 NO_SHOW (excluídos da ocupação, mas exibidos no Resumo dos atendimentos)
      const todayAppts = [
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `comp-${i + 1}`,
          memberId: "member-1",
          customerId: `cust-c-${i + 1}`,
          dateTime: new Date(
            Date.UTC(2026, 9, 30, 9 + Math.floor(i / 2), (i % 2) * 30, 0)
          ),
          durationMin: 30,
          status: "COMPLETED",
          totalPrice: 50,
          customer: { name: `Cliente Concluído ${i + 1}`, avatarUrl: null },
          services: [{ service: { name: "Corte", durationMin: 30 } }],
          comandas: [
            {
              id: `cmd-${i + 1}`,
              status: "CLOSED",
              total: 50,
              discountTotal: 0,
              surchargeTotal: 0,
            },
          ],
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `conf-${i + 1}`,
          memberId: "member-1",
          customerId: `cust-f-${i + 1}`,
          dateTime: new Date(
            Date.UTC(2026, 9, 30, 15 + Math.floor(i / 2), (i % 2) * 30, 0)
          ),
          durationMin: 30,
          status: "CONFIRMED",
          totalPrice: 50,
          customer: { name: `Cliente Confirmado ${i + 1}`, avatarUrl: null },
          services: [{ service: { name: "Corte", durationMin: 30 } }],
          comandas: [],
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `pend-${i + 1}`,
          memberId: "member-1",
          customerId: `cust-p-${i + 1}`,
          dateTime: new Date(Date.UTC(2026, 9, 30, 16, (i % 2) * 30, 0)),
          durationMin: 30,
          status: "PENDING",
          totalPrice: 50,
          customer: { name: `Cliente Pendente ${i + 1}`, avatarUrl: null },
          services: [{ service: { name: "Corte", durationMin: 30 } }],
          comandas: [],
        })),
        {
          id: "canc-1",
          memberId: "member-1",
          customerId: "cust-canc",
          dateTime: new Date(Date.UTC(2026, 9, 30, 14, 0, 0)),
          durationMin: 30,
          status: "CANCELLED",
          totalPrice: 50,
          customer: { name: "Cliente Cancelado", avatarUrl: null },
          services: [{ service: { name: "Corte", durationMin: 30 } }],
          comandas: [],
        },
        {
          id: "noshow-1",
          memberId: "member-1",
          customerId: "cust-ns",
          dateTime: new Date(Date.UTC(2026, 9, 30, 15, 0, 0)),
          durationMin: 30,
          status: "NO_SHOW",
          totalPrice: 50,
          customer: { name: "Cliente Falta", avatarUrl: null },
          services: [{ service: { name: "Corte", durationMin: 30 } }],
          comandas: [],
        },
      ];

      vi.mocked(prisma.appointment.findMany).mockImplementation((args) => {
        const where = args?.where as
          | { status?: unknown; dateTime?: { gte?: Date } }
          | undefined;
        if (where?.dateTime?.gte && !where?.status) {
          return Promise.resolve(todayAppts) as unknown as ReturnType<
            typeof prisma.appointment.findMany
          >;
        }
        return Promise.resolve([]) as unknown as ReturnType<
          typeof prisma.appointment.findMany
        >;
      });

      const pageElement = await DashboardPage();
      render(pageElement);

      // Correção 1: Card "Visão geral do faturamento" não usa justify-between no container externo
      const revOverviewCard = screen.getByTestId(
        "desktop-revenue-overview-card"
      );
      expect(revOverviewCard.className).toContain("flex-col");
      expect(revOverviewCard.className).not.toContain("justify-between");

      // Correção 3 & 5: Percentual de capacidade real 118,75% (sem travar em 100%)
      expect(screen.getAllByText("118,75%").length).toBeGreaterThanOrEqual(2);
      expect(
        screen.getByText(/Carga: 570 min de 480 min \(19\/16 eq\.\)/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Concluídos: 12 \(360m\)/)).toBeInTheDocument();
      expect(screen.getByText(/Agendados: 7 \(210m\)/)).toBeInTheDocument();

      // Correção 4: Horários de hoje com estados Concluído (roxo) e Agendado (dourado)
      const slotsCard = within(screen.getByTestId("today-slots-card"));
      expect(slotsCard.getByText("Concluído")).toBeInTheDocument();
      const slot0900 = slotsCard.getByText("09:00");
      expect(slot0900.className).toContain("text-violet-300");
      expect(slot0900.className).toContain("bg-violet-500/15");

      const slot1500 = slotsCard.getByText("15:00");
      expect(slot1500.className).toContain("text-[var(--gold)]");
      expect(slot1500.className).toContain("bg-[var(--gold-surface)]");

      // Correção 6: Resumo dos atendimentos mostra contagens reais por status
      expect(
        screen.getByTestId("attendance-row-completed").textContent
      ).toContain("12");
      expect(
        screen.getByTestId("attendance-row-confirmed").textContent
      ).toContain("5");
      expect(
        screen.getByTestId("attendance-row-pending").textContent
      ).toContain("2");
      expect(
        screen.getByTestId("attendance-row-cancelled").textContent
      ).toContain("1");
      expect(screen.getByTestId("attendance-row-noShow").textContent).toContain(
        "1"
      );

      vi.useRealTimers();
    });

    it("Minigráficos dos KPIs refletem séries reais consultadas e usam estado neutro plano quando não há série confiável", () => {
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
        expect(new Set(heights).size).toBe(1);
        expect(heights[0]).toBe(14);
      }
      unmount();

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
        expect(spark).toHaveAttribute(
          "data-series",
          "500,200,400,100,300,0,0"
        );
      }

      const seriesBars = screen
        .getAllByTestId("mini-bars")
        .filter((el) => el.getAttribute("data-mode") === "series");
      expect(seriesBars.length).toBeGreaterThanOrEqual(2);
      const firstBarRects = seriesBars[0].querySelectorAll("rect");
      const h0 = Number(firstBarRects[0].getAttribute("height"));
      const h1 = Number(firstBarRects[1].getAttribute("height"));
      expect(h0).toBeGreaterThan(h1);
    });

    it("Cenários 12 e 13 — Isolamento multi-tenant em todas as queries (incluindo títulos financeiros e comandas) e bloqueio RBAC", async () => {
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

      vi.clearAllMocks();
      vi.mocked(requireManagerialAdmin).mockImplementationOnce(async () => {
        throw new Error("NEXT_REDIRECT:/admin/agendamentos");
      });
      await expect(DashboardPage()).rejects.toThrow(
        "NEXT_REDIRECT:/admin/agendamentos"
      );
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

      const searchInput = screen.getByRole("searchbox", {
        name: /filtrar agenda de hoje, profissional ou conta/i,
      });
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(document.activeElement).toBe(searchInput);

      fireEvent.change(searchInput, { target: { value: "Gabriel" } });
      expect(screen.getAllByText("Gabriel Ferreira").length).toBeGreaterThan(0);
      expect(screen.queryByText("Marcos Almeida")).not.toBeInTheDocument();

      const clearBtn = screen.getByRole("button", { name: /limpar filtro/i });
      fireEvent.click(clearBtn);
      expect(screen.getAllByText("Marcos Almeida").length).toBeGreaterThan(0);
    });
  });
});
