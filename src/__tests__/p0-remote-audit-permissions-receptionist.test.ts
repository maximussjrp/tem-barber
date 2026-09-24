import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { getOperationalStaffSession } from "@/lib/operational-session";
import { getDefaultPermissionsForRole, ROLE_PRESETS } from "@/lib/permissions/presets";
import * as permissionsEngine from "@/lib/permissions/engine";
import { GET as teamGET } from "@/app/api/admin/team/route";
import prisma from "@/lib/prisma";
import * as apiAuth from "@/lib/api-auth";

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn(),
  getMemberSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
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
});
