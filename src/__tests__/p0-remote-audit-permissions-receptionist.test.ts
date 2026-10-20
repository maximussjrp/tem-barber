import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { getOperationalStaffSession } from "@/lib/operational-session";
import { getDefaultPermissionsForRole, ROLE_PRESETS } from "@/lib/permissions/presets";
import * as permissionsEngine from "@/lib/permissions/engine";
import { GET as teamGET } from "@/app/api/admin/team/route";
import prisma from "@/lib/prisma";
import * as apiAuth from "@/lib/api-auth";

const { redirectMock, useSessionMock, usePathnameMock, requireAdminMock, requireManagerialAdminMock } =
  vi.hoisted(() => ({
    redirectMock: vi.fn(),
    useSessionMock: vi.fn(),
    usePathnameMock: vi.fn(() => "/admin/clientes"),
    requireAdminMock: vi.fn(),
    requireManagerialAdminMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  usePathname: usePathnameMock,
}));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}));

vi.mock("@/lib/admin-guard", () => ({
  requireAdmin: requireAdminMock,
  requireManagerialAdmin: requireManagerialAdminMock,
  RECEPTIONIST_HOME_PATH: "/admin/agendamentos",
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn(),
  getMemberSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    appointment: {
      findMany: vi.fn(),
    },
    service: {
      count: vi.fn(),
    },
    workingHour: {
      count: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    memberPermissionOverride: {
      findMany: vi.fn(),
    },
    customerBarbershopLink: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    onlineWaitlistSession: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    onlineWaitlistEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
  },
}));

vi.mock("@/lib/operational-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operational-session")>();
  return {
    ...actual,
  };
});

import AdminIndexPage from "@/app/admin/page";
import DashboardPage from "@/app/admin/dashboard/page";
import OnboardingPage from "@/app/admin/onboarding/page";
import CommissionPeriodsPage from "@/app/admin/comissoes/periodos/page";
import ConfiguracoesPage from "@/app/admin/financeiro/configuracoes/page";
import CaixaLayout from "@/app/admin/caixa/layout";
import FinanceiroLayout from "@/app/admin/financeiro/layout";
import ComissoesLayout from "@/app/admin/comissoes/layout";
import GorjetasLayout from "@/app/admin/gorjetas/layout";
import ServicosLayout from "@/app/admin/servicos/layout";
import ProdutosLayout from "@/app/admin/produtos/layout";
import EquipeLayout from "@/app/admin/equipe/layout";
import ClubeLayout from "@/app/admin/clube/layout";
import MarketingLayout from "@/app/admin/marketing/layout";
import ConfiguracoesLayout from "@/app/admin/configuracoes/layout";
import ClientesReativacaoLayout from "@/app/admin/clientes/reativacao/layout";
import { ClientNav } from "@/components/admin/clients/ClientNav";

describe("P0 Remote Audit - Permissions Fail-Closed & Receptionist Access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Permission Engine Fail-Closed", () => {
    it("getDefaultPermissionsForRole retorna false para todos os direitos se o role for desconhecido", () => {
      const perms = getDefaultPermissionsForRole("UNKNOWN_ROLE");
      expect(Object.values(perms).every((p) => p === false)).toBe(true);
      expect(perms.AGENDA_VIEW_ALL).toBe(false);
      expect(perms.CLIENTS_VIEW).toBe(false);
    });

    it("falha interna em checkMemberPermission nega acesso (403), nunca liberando com fallback true", async () => {
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: { role: "MANAGER", memberId: "m-1", barbershopId: "shop-1", userId: "u-1" },
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      vi.spyOn(permissionsEngine, "checkMemberPermission").mockRejectedValue(
        new Error("Database connection lost")
      );

      const sessionResult = await getOperationalStaffSession({
        requiredPermission: "CLIENTS_VIEW",
      });

      expect(sessionResult.error).toBeDefined();
      expect(sessionResult.error?.status).toBe(403);
    });

    it("override explícito false bloqueia acesso mesmo quando preset do role é true", async () => {
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: { role: "MANAGER", memberId: "m-1", barbershopId: "shop-1", userId: "u-1" },
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      // Mock que retorna false para CLIENTS_VIEW
      vi.spyOn(permissionsEngine, "checkMemberPermission").mockResolvedValue(false);

      const sessionResult = await getOperationalStaffSession({
        requiredPermission: "CLIENTS_VIEW",
      });

      expect(sessionResult.error).toBeDefined();
      expect(sessionResult.error?.status).toBe(403);
    });

    it("permission delegate ausente/erro -> acesso negado (403), nunca ROLE_PRESET_FALLBACK_ALLOW", async () => {
      // 1. Verifica no permission engine diretamente: lança exceção em vez de recorrer a preset
      await expect(
        permissionsEngine.getEffectivePermissions(
          "m-1",
          "MANAGER",
          {} as unknown as Parameters<typeof permissionsEngine.getEffectivePermissions>[2]
        )
      ).rejects.toThrow();

      // 2. Verifica no guard operacional: converte a falha da permission store em 403
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: { role: "MANAGER", memberId: "m-1", barbershopId: "shop-1", userId: "u-1" },
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      vi.mocked(prisma.memberPermissionOverride.findMany).mockRejectedValueOnce(
        new Error("Table or delegate missing")
      );

      const sessionResult = await getOperationalStaffSession({
        requiredPermission: "CLIENTS_VIEW",
      });

      expect(sessionResult.error).toBeDefined();
      expect(sessionResult.error?.status).toBe(403);
      const json = await sessionResult.error?.json();
      expect(json.error).toBe("PERMISSION_DENIED");
    });
  });

  describe("Receptionist Route Access", () => {
    it("RECEPTIONIST tem permissão de leitura de clientes (CLIENTS_VIEW)", () => {
      const preset = ROLE_PRESETS.RECEPTIONIST;
      expect(preset.CLIENTS_VIEW).toBe(true);
      expect(preset.CLIENTS_MANAGE).toBe(true);
      expect(preset.WAITLIST_MANAGE).toBe(true);
    });

    it("RECEPTIONIST NÃO tem permissão para financeiro, equipe, ou comissões", () => {
      const preset = ROLE_PRESETS.RECEPTIONIST;
      expect(preset.FINANCIAL_VIEW).toBe(false);
      expect(preset.TEAM_MANAGE).toBe(false);
      expect(preset.COMMISSIONS_MANAGE).toBe(false);
      expect(preset.SETTINGS_MANAGE).toBe(false);
    });

    it("GET /api/admin/team bloqueia RECEPTIONIST com 403", async () => {
      // Team manage route uses getAdminSession which rejects RECEPTIONIST
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: null,
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      const res = await teamGET();
      expect(res.status).toBe(403);
    });
  });

  describe("SEC-RBAC-001 — Server Components, Layouts & ClientNav Hardening", () => {
    beforeEach(() => {
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
    });

    it("/admin encaminha RECEPTIONIST para /admin/agendamentos, perfis gerenciais com tenant para /admin/dashboard, SUPER_ADMIN sem tenant para /admin/platform e outros sem tenant para /acesso-negado", async () => {
      requireAdminMock.mockResolvedValueOnce({
        role: "RECEPTIONIST",
        barbershopId: "shop-1",
        isPlatform: false,
      });

      await expect(AdminIndexPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(redirectMock).toHaveBeenCalledTimes(1);
      expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");

      for (const role of ["OWNER", "MANAGER", "SUPER_ADMIN"] as const) {
        vi.clearAllMocks();
        redirectMock.mockImplementation((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        });
        requireAdminMock.mockResolvedValueOnce({
          role,
          barbershopId: "shop-1",
          isPlatform: role === "SUPER_ADMIN",
        });

        await expect(AdminIndexPage()).rejects.toThrow("NEXT_REDIRECT:/admin/dashboard");
        expect(redirectMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith("/admin/dashboard");
      }

      // SUPER_ADMIN sem tenant -> /admin/platform
      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireAdminMock.mockResolvedValueOnce({
        role: "SUPER_ADMIN",
        barbershopId: null,
        isPlatform: true,
      });

      await expect(AdminIndexPage()).rejects.toThrow("NEXT_REDIRECT:/admin/platform");
      expect(redirectMock).toHaveBeenCalledTimes(1);
      expect(redirectMock).toHaveBeenCalledWith("/admin/platform");

      // Outro perfil sem tenant -> /acesso-negado
      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireAdminMock.mockResolvedValueOnce({
        role: "OWNER",
        barbershopId: null,
        isPlatform: false,
      });

      await expect(AdminIndexPage()).rejects.toThrow("NEXT_REDIRECT:/acesso-negado");
      expect(redirectMock).toHaveBeenCalledTimes(1);
      expect(redirectMock).toHaveBeenCalledWith("/acesso-negado");
    });

    it("/admin/dashboard e /admin/onboarding interrompem renderização com NEXT_REDIRECT para RECEPTIONIST sem executar queries financeiras ou de negócio", async () => {
      requireManagerialAdminMock.mockImplementationOnce(async () => {
        return redirectMock("/admin/agendamentos");
      });

      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.workingHour.count).not.toHaveBeenCalled();
      expect(prisma.barbershopMember.findMany).not.toHaveBeenCalled();

      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireManagerialAdminMock.mockImplementationOnce(async () => {
        return redirectMock("/admin/agendamentos");
      });

      await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.workingHour.count).not.toHaveBeenCalled();
      expect(prisma.barbershopMember.count).not.toHaveBeenCalled();
    });

    it("/admin/dashboard e /admin/onboarding encaminham SUPER_ADMIN sem tenant para /admin/platform e outros sem tenant para /acesso-negado sem página em branco e sem executar queries", async () => {
      // 1. DashboardPage com SUPER_ADMIN sem tenant
      requireManagerialAdminMock.mockResolvedValueOnce({
        role: "SUPER_ADMIN",
        isPlatform: true,
        barbershopId: null,
        barbershop: null,
      });

      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/admin/platform");
      expect(redirectMock).toHaveBeenCalledWith("/admin/platform");
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.workingHour.count).not.toHaveBeenCalled();
      expect(prisma.barbershopMember.findMany).not.toHaveBeenCalled();

      // 2. OnboardingPage com SUPER_ADMIN sem tenant
      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireManagerialAdminMock.mockResolvedValueOnce({
        role: "SUPER_ADMIN",
        isPlatform: true,
        barbershopId: null,
        barbershop: null,
      });

      await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/admin/platform");
      expect(redirectMock).toHaveBeenCalledWith("/admin/platform");
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.workingHour.count).not.toHaveBeenCalled();
      expect(prisma.barbershopMember.count).not.toHaveBeenCalled();

      // 3. DashboardPage e OnboardingPage com perfil não-plataforma sem tenant -> /acesso-negado
      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireManagerialAdminMock.mockResolvedValueOnce({
        role: "OWNER",
        isPlatform: false,
        barbershopId: null,
        barbershop: null,
      });

      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/acesso-negado");
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();

      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireManagerialAdminMock.mockResolvedValueOnce({
        role: "MANAGER",
        isPlatform: false,
        barbershopId: null,
        barbershop: null,
      });

      await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/acesso-negado");
      expect(prisma.service.count).not.toHaveBeenCalled();
    });

    it("/admin/onboarding renderiza normalmente para OWNER, MANAGER e SUPER_ADMIN com tenant válido", async () => {
      vi.mocked(prisma.service.count).mockResolvedValue(2);
      vi.mocked(prisma.workingHour.count).mockResolvedValue(5);
      vi.mocked(prisma.barbershopMember.count).mockResolvedValue(1);

      for (const role of ["OWNER", "MANAGER", "SUPER_ADMIN"] as const) {
        vi.clearAllMocks();
        redirectMock.mockImplementation((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        });
        requireManagerialAdminMock.mockResolvedValueOnce({
          role,
          isPlatform: role === "SUPER_ADMIN",
          barbershopId: "shop-1",
          barbershop: {
            id: "shop-1",
            name: "Barbearia Modelo",
            slug: "barbearia-modelo",
            phone: "11999999999",
            description: "Desc",
          },
        });

        const element = await OnboardingPage();
        expect(element).toBeTruthy();
        expect(redirectMock).not.toHaveBeenCalled();
        expect(prisma.service.count).toHaveBeenCalledWith({
          where: { barbershopId: "shop-1", isActive: true },
        });
      }
    });

    it("/admin/comissoes/periodos e /admin/financeiro/configuracoes interrompem com NEXT_REDIRECT para RECEPTIONIST e redirecionam OWNER/MANAGER para o destino canônico", async () => {
      requireManagerialAdminMock.mockImplementationOnce(async () => {
        return redirectMock("/admin/agendamentos");
      });

      await expect(CommissionPeriodsPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(redirectMock).toHaveBeenCalledTimes(1);
      expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");

      vi.clearAllMocks();
      redirectMock.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      requireManagerialAdminMock.mockImplementationOnce(async () => {
        return redirectMock("/admin/agendamentos");
      });

      await expect(ConfiguracoesPage()).rejects.toThrow("NEXT_REDIRECT:/admin/agendamentos");
      expect(redirectMock).toHaveBeenCalledTimes(1);
      expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");

      // Caminhos positivos para OWNER e MANAGER
      for (const role of ["OWNER", "MANAGER"] as const) {
        vi.clearAllMocks();
        redirectMock.mockImplementation((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        });
        requireManagerialAdminMock.mockResolvedValueOnce({
          role,
          barbershopId: "shop-1",
          isPlatform: false,
        });

        await expect(CommissionPeriodsPage()).rejects.toThrow(
          "NEXT_REDIRECT:/admin/comissoes/pagamentos"
        );

        vi.clearAllMocks();
        redirectMock.mockImplementation((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        });
        requireManagerialAdminMock.mockResolvedValueOnce({
          role,
          barbershopId: "shop-1",
          isPlatform: false,
        });

        await expect(ConfiguracoesPage()).rejects.toThrow(
          "NEXT_REDIRECT:/admin/financeiro/recorrentes"
        );
      }
    });

    it("todos os 11 layouts aninhados gerenciais interrompem com NEXT_REDIRECT para RECEPTIONIST (sem liberar children) e renderizam children para OWNER e MANAGER", async () => {
      const layouts = [
        CaixaLayout,
        FinanceiroLayout,
        ComissoesLayout,
        GorjetasLayout,
        ServicosLayout,
        ProdutosLayout,
        EquipeLayout,
        ClubeLayout,
        MarketingLayout,
        ConfiguracoesLayout,
        ClientesReativacaoLayout,
      ];

      for (const Layout of layouts) {
        vi.clearAllMocks();
        redirectMock.mockImplementation((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        });
        requireManagerialAdminMock.mockImplementationOnce(async () => {
          return redirectMock("/admin/agendamentos");
        });

        await expect(Layout({ children: "CONTEUDO_GERENCIAL_SECRETO" })).rejects.toThrow(
          "NEXT_REDIRECT:/admin/agendamentos"
        );
        expect(redirectMock).toHaveBeenCalledTimes(1);
        expect(redirectMock).toHaveBeenCalledWith("/admin/agendamentos");

        for (const allowedRole of ["OWNER", "MANAGER"] as const) {
          vi.clearAllMocks();
          redirectMock.mockImplementation((url: string) => {
            throw new Error(`NEXT_REDIRECT:${url}`);
          });
          requireManagerialAdminMock.mockResolvedValueOnce({
            role: allowedRole,
            barbershopId: "shop-1",
            isPlatform: false,
          });

          const allowed = await Layout({ children: "CONTEUDO_GERENCIAL_AUTORIZADO" });
          expect(allowed).toBeTruthy();
          expect(JSON.stringify(allowed)).toContain("CONTEUDO_GERENCIAL_AUTORIZADO");
          expect(redirectMock).not.toHaveBeenCalled();
        }
      }
    });

    it("ClientNav oculta a aba Reativação para RECEPTIONIST, BARBER e sessão sem role definido, e exibe para OWNER, MANAGER e SUPER_ADMIN", () => {
      for (const blockedRole of [undefined, "RECEPTIONIST", "BARBER", "CLIENT"]) {
        useSessionMock.mockReturnValueOnce({
          data: blockedRole ? { user: { role: blockedRole } } : null,
        });

        const tree = ClientNav();
        const children = tree.props.children as Array<{
          props: { href: string; children: string };
        }>;
        const hrefs = children.map((child) => child.props.href);
        const labels = children.map((child) => child.props.children);

        expect(hrefs).toEqual(["/admin/clientes"]);
        expect(hrefs).not.toContain("/admin/clientes/reativacao");
        expect(labels).not.toContain("Reativação");
      }

      for (const allowedRole of ["OWNER", "MANAGER", "SUPER_ADMIN"]) {
        useSessionMock.mockReturnValueOnce({
          data: { user: { role: allowedRole } },
        });

        const tree = ClientNav();
        const children = tree.props.children as Array<{
          props: { href: string; children: string };
        }>;
        const hrefs = children.map((child) => child.props.href);
        const labels = children.map((child) => child.props.children);

        expect(hrefs).toEqual(["/admin/clientes", "/admin/clientes/reativacao"]);
        expect(labels).toContain("Reativação");
      }
    });
  });
});
