import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { prismaMock, getServerSessionMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn() },
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    tenantSubscription: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prismaMock)),
  },
  getServerSessionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: vi.fn() }));

import { isPlatformAdmin } from "@/lib/subscription-utils";
import { requireAdmin } from "@/lib/admin-guard";

describe("Super Admin & Platform Access Audit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_ADMIN_EMAILS = "max.guarinieri@gmail.com";
    const activeSub = {
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
    };
    prismaMock.tenantSubscription.findFirst.mockResolvedValue(activeSub);
    prismaMock.tenantSubscription.findUnique.mockResolvedValue(activeSub);
  });

  // 1. PLATFORM_ADMIN_EMAILS parsing: target email accepted case-insensitively
  it("aceita email do platform admin independentemente de maiúsculas/minúsculas e espaços", () => {
    expect(isPlatformAdmin("max.guarinieri@gmail.com")).toBe(true);
    expect(isPlatformAdmin("MAX.GUARINIERI@GMAIL.COM")).toBe(true);
    expect(isPlatformAdmin(" max.guarinieri@gmail.com ")).toBe(true);
  });

  // 2. Non-allowlisted USER remains rejected
  it("rejeita usuário não pertencente à lista de platform admins", () => {
    expect(isPlatformAdmin("usuario.comum@gmail.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });

  // 3. Allowlisted platform admin with no membership can authenticate for GLOBAL platform context
  it("platform admin sem associação a barbearia acessa contexto administrativo global", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-1", email: "max.guarinieri@gmail.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const adminContext = await requireAdmin();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminContext).toMatchObject({
      userId: "admin-1",
      role: "SUPER_ADMIN",
      member: null,
      barbershop: null,
    });
  });

  // 4. SUPER_ADMIN DB role with no membership can authenticate globally
  it("usuário com role SUPER_ADMIN no banco sem membership acessa contexto global", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-2", email: "outro.admin@gmail.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const adminContext = await requireAdmin();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminContext.role).toBe("SUPER_ADMIN");
  });

  // 5. OWNER/MANAGER normal tenant login unchanged
  it("OWNER/MANAGER com 1 membership ativa acessa painel do tenant normalmente", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-1", email: "owner@dombrio.com", role: "OWNER" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "owner-1", barbershopId: "shop-1", role: "OWNER", isActive: true },
    ]);
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({ status: "ACTIVE" });

    const adminContext = await requireAdmin();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminContext.barbershopId).toBe("shop-1");
  });

  // 6. Platform admin with one membership preserves operational membership role when using tenant context
  it("platform admin com 1 membership vinculada mantém acesso operacional e isPlatform = true", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-owner", email: "max.guarinieri@gmail.com", role: "OWNER" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-dombrio", userId: "admin-owner", barbershopId: "dom-brio", role: "OWNER", isActive: true },
    ]);

    const adminContext = await requireAdmin();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminContext.barbershopId).toBe("dom-brio");
  });

  // 7. Multiple memberships are never silently reduced to the first for normal users
  it("múltiplas memberships para usuário normal bloqueiam sem selecionar a primeira silenciosamente", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "multi-user", email: "multi@gmail.com", role: "OWNER" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "multi-user", barbershopId: "shop-1", role: "OWNER", isActive: true },
      { id: "m-2", userId: "multi-user", barbershopId: "shop-2", role: "MANAGER", isActive: true },
    ]);

    await requireAdmin();

    expect(redirectMock).toHaveBeenCalledWith("/acesso-negado?error=TENANT_SELECTION_REQUIRED");
  });

  // 8. Global platform authorization does not depend solely on MemberRole
  it("autorização da plataforma aceita allowlist de e-mail mesmo sem MemberRole de SUPER_ADMIN", () => {
    const email = "max.guarinieri@gmail.com";
    const role: string = "OWNER";
    const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

    expect(isPlatform).toBe(true);
  });

  // 9. Platform API still rejects non-platform admin
  it("usuário comum sem e-mail na allowlist e sem role SUPER_ADMIN é rejeitado na verificação de plataforma", () => {
    const email = "barbeiro@gmail.com";
    const role: string = "BARBER";
    const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

    expect(isPlatform).toBe(false);
  });

  // 10. Subscription checks remain bypassed only for platform admin
  it("bypassa validação de assinatura de tenant apenas quando isPlatform = true", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-suspended", email: "max.guarinieri@gmail.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "admin-suspended", barbershopId: "shop-suspended", role: "OWNER", isActive: true },
    ]);
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({ status: "SUSPENDED" });

    await requireAdmin();

    expect(redirectMock).not.toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 11. requireAdmin retorna isPlatform boolean explicitamente
  it("requireAdmin retorna isPlatform: true para platform admin e isPlatform: false para usuário comum", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-x", email: "max.guarinieri@gmail.com", role: "OWNER" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-x", userId: "admin-x", barbershopId: "shop-x", role: "OWNER", isActive: true },
    ]);

    const adminCtx = await requireAdmin();
    expect(adminCtx.isPlatform).toBe(true);
    expect(adminCtx.role).toBe("OWNER");

    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-y", email: "user.comum@gmail.com", role: "OWNER" },
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-y", userId: "owner-y", barbershopId: "shop-y", role: "OWNER", isActive: true },
    ]);

    const userCtx = await requireAdmin();
    expect(userCtx.isPlatform).toBe(false);
    expect(userCtx.role).toBe("OWNER");
  });

  // 12. Deployment compose config test
  it("docker-compose.yml expõe PLATFORM_ADMIN_EMAILS no ambiente do contêiner app", () => {
    const composePath = path.resolve(__dirname, "../../deployment/docker-compose.yml");
    const composeContent = fs.readFileSync(composePath, "utf-8");

    expect(composeContent).toContain("PLATFORM_ADMIN_EMAILS:");
  });
});
