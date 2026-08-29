import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { prismaMock, getServerSessionMock, redirectMock, compareMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn() },
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    tenantSubscription: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prismaMock)),
  },
  getServerSessionMock: vi.fn(),
  redirectMock: vi.fn(),
  compareMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: vi.fn() }));
vi.mock("bcryptjs", () => ({
  default: {
    compare: compareMock,
  },
  compare: compareMock,
}));

import { isPlatformAdmin } from "@/lib/subscription-utils";
import { requireAdmin } from "@/lib/admin-guard";
import { authOptions } from "@/lib/auth";

const credentialsProvider = authOptions.providers[0] as any;
const authorize = credentialsProvider.options.authorize;

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

describe("Direct CredentialsProvider authorize() Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_ADMIN_EMAILS = "max.guarinieri@gmail.com";
  });

  // Query count regression test (1 user findFirst, 1 bcrypt compare, 1 membership findMany)
  it("executa exatamente 1 consulta de usuário, 1 comparação bcrypt e 1 busca de membership no login de admin", async () => {
    const user = {
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "USER",
      passwordHash: "$2a$10$hashedpassword",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-dombrio", userId: "u-max", barbershopId: "dom-brio", role: "OWNER", isActive: true },
    ]);

    const result = await authorize({
      loginType: "admin",
      email: "max.guarinieri@gmail.com",
      password: "secretpassword",
    });

    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "OWNER",
      authLevel: "admin",
    });
  });

  // Scenario A: allowlisted USER + 1 OWNER membership -> role OWNER
  it("Scenario A: allowlisted USER + 1 OWNER membership -> role OWNER", async () => {
    const user = {
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "u-max", barbershopId: "dom-brio", role: "OWNER", isActive: true },
    ]);

    const result = await authorize({
      loginType: "admin",
      email: "max.guarinieri@gmail.com",
      password: "pass",
    });

    expect(result.role).toBe("OWNER");
  });

  // Scenario B: allowlisted USER + 0 membership -> role SUPER_ADMIN
  it("Scenario B: allowlisted USER + 0 memberships -> role SUPER_ADMIN", async () => {
    const user = {
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const result = await authorize({
      loginType: "admin",
      email: "max.guarinieri@gmail.com",
      password: "pass",
    });

    expect(result.role).toBe("SUPER_ADMIN");
  });

  // Scenario C: allowlisted USER + MULTIPLE memberships -> authenticated globally, role SUPER_ADMIN, no first membership selected
  it("Scenario C: allowlisted USER + MULTIPLE memberships -> role SUPER_ADMIN sem tenant fixado", async () => {
    const user = {
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "u-max", barbershopId: "shop-1", role: "OWNER", isActive: true },
      { id: "m-2", userId: "u-max", barbershopId: "shop-2", role: "MANAGER", isActive: true },
    ]);

    const result = await authorize({
      loginType: "admin",
      email: "max.guarinieri@gmail.com",
      password: "pass",
    });

    expect(result.role).toBe("SUPER_ADMIN");
  });

  // Scenario D: normal USER + MULTIPLE memberships -> throws TENANT_SELECTION_REQUIRED
  it("Scenario D: normal USER + MULTIPLE memberships -> throws TENANT_SELECTION_REQUIRED", async () => {
    const user = {
      id: "u-norm",
      name: "Normal",
      email: "normal@gmail.com",
      phone: "11888888888",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "m-1", userId: "u-norm", barbershopId: "shop-1", role: "OWNER", isActive: true },
      { id: "m-2", userId: "u-norm", barbershopId: "shop-2", role: "MANAGER", isActive: true },
    ]);

    await expect(
      authorize({
        loginType: "admin",
        email: "normal@gmail.com",
        password: "pass",
      })
    ).rejects.toThrow("TENANT_SELECTION_REQUIRED");
  });

  // Scenario E: normal USER + 0 membership -> rejected
  it("Scenario E: normal USER + 0 memberships -> throws acesso negado", async () => {
    const user = {
      id: "u-norm",
      name: "Normal",
      email: "normal@gmail.com",
      phone: "11888888888",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    await expect(
      authorize({
        loginType: "admin",
        email: "normal@gmail.com",
        password: "pass",
      })
    ).rejects.toThrow("Acesso administrativo negado. Você não possui cargos vinculados.");
  });

  // Scenario F: DB SUPER_ADMIN + 0 membership -> role SUPER_ADMIN
  it("Scenario F: DB SUPER_ADMIN + 0 memberships -> role SUPER_ADMIN", async () => {
    const user = {
      id: "u-super",
      name: "Super",
      email: "dbadmin@gmail.com",
      phone: "11777777777",
      role: "SUPER_ADMIN",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(true);
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const result = await authorize({
      loginType: "admin",
      email: "dbadmin@gmail.com",
      password: "pass",
    });

    expect(result.role).toBe("SUPER_ADMIN");
  });

  // Scenario G: wrong password -> rejected
  it("Scenario G: wrong password -> throws Senha incorreta.", async () => {
    const user = {
      id: "u-max",
      name: "Max",
      email: "max.guarinieri@gmail.com",
      phone: "11999999999",
      role: "USER",
      passwordHash: "hash",
    };
    prismaMock.user.findFirst.mockResolvedValue(user);
    compareMock.mockResolvedValue(false);

    await expect(
      authorize({
        loginType: "admin",
        email: "max.guarinieri@gmail.com",
        password: "wrongpass",
      })
    ).rejects.toThrow("Senha incorreta.");
  });
});
