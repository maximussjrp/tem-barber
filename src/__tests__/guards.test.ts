import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopMember: { findMany: vi.fn() },
    tenantSubscription: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { getAdminSession } from "@/lib/api-auth";
import { getMemberSession } from "@/lib/member-api-auth";
import { POST as createComanda } from "@/app/api/admin/comandas/route";
import { NextRequest } from "next/server";

function session(role: string, id = "user-a", email?: string) {
  return { user: { id, role, email } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.barbershopMember.findMany.mockResolvedValue([{
    id: "member-a",
    userId: "user-a",
    barbershopId: "shop-a",
    role: "OWNER",
    isActive: true,
  }]);
  prismaMock.tenantSubscription.findFirst.mockResolvedValue({
    status: "ACTIVE",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
  });
});

describe("guards e isolamento", () => {
  it.each(["OWNER", "MANAGER"])("%s recebe acesso administrativo", async (role) => {
    getServerSessionMock.mockResolvedValue(session(role));
    prismaMock.barbershopMember.findMany.mockResolvedValue([{
      id: "member-a",
      userId: "user-a",
      barbershopId: "shop-a",
      role,
      isActive: true,
    }]);

    const result = await getAdminSession();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ role, userId: "user-a", memberId: "member-a", barbershopId: "shop-a" });
  });

  it("BARBER nao recebe acesso administrativo indevido", async () => {
    getServerSessionMock.mockResolvedValue(session("BARBER"));

    const result = await getAdminSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it("cliente nao recebe acesso administrativo", async () => {
    getServerSessionMock.mockResolvedValue(session("USER"));

    const result = await getAdminSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it("usuario sem vinculo administrativo e rejeitado", async () => {
    getServerSessionMock.mockResolvedValue(session("OWNER"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const result = await getAdminSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it.each(["OWNER", "MANAGER", "BARBER"])("%s recebe sessao de membro", async (role) => {
    getServerSessionMock.mockResolvedValue(session(role));
    prismaMock.barbershopMember.findMany.mockResolvedValue([{
      id: "member-a",
      userId: "user-a",
      barbershopId: "shop-a",
      role,
      isActive: true,
    }]);

    const result = await getMemberSession();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ role, memberId: "member-a", barbershopId: "shop-a" });
  });

  it("cliente nao recebe sessao de barbeiro", async () => {
    getServerSessionMock.mockResolvedValue(session("USER"));

    const result = await getMemberSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it("guard usa o vinculo ativo do usuario para definir tenant", async () => {
    getServerSessionMock.mockResolvedValue(session("MANAGER", "manager-a"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([{
      id: "member-manager",
      userId: "manager-a",
      barbershopId: "shop-b",
      role: "MANAGER",
      isActive: true,
    }]);

    const result = await getAdminSession();

    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "manager-a", isActive: true },
      take: 2,
    }));
    expect(result.data?.barbershopId).toBe("shop-b");
  });

  it("rejeita duas memberships ativas sem escolher a primeira", async () => {
    getServerSessionMock.mockResolvedValue(session("OWNER"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "member-a", userId: "user-a", barbershopId: "shop-a", role: "OWNER", isActive: true },
      { id: "member-b", userId: "user-a", barbershopId: "shop-b", role: "OWNER", isActive: true },
    ]);

    const result = await getAdminSession();

    expect(result.error?.status).toBe(409);
    await expect(result.error?.json()).resolves.toMatchObject({ error: "TENANT_SELECTION_REQUIRED" });
    expect(result.data).toBeNull();
  });

  it("ignora membership inativa e usa a unica ativa", async () => {
    getServerSessionMock.mockResolvedValue(session("MANAGER"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "active", userId: "user-a", barbershopId: "shop-active", role: "MANAGER", isActive: true },
    ]);

    const result = await getAdminSession();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ memberId: "active", barbershopId: "shop-active" });
    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-a", isActive: true },
    }));
  });

  it("membership de outro usuario nunca interfere na resolucao", async () => {
    getServerSessionMock.mockResolvedValue(session("OWNER", "target-user"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "target-member", userId: "target-user", barbershopId: "target-shop", role: "OWNER", isActive: true },
    ]);

    const result = await getAdminSession();

    expect(result.data?.barbershopId).toBe("target-shop");
    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "target-user", isActive: true },
    }));
  });

  it("sessao de membro tambem falha com multiplas memberships ativas", async () => {
    getServerSessionMock.mockResolvedValue(session("BARBER"));
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "member-a", userId: "user-a", barbershopId: "shop-a", role: "BARBER", isActive: true },
      { id: "member-b", userId: "user-a", barbershopId: "shop-b", role: "BARBER", isActive: true },
    ]);

    const result = await getMemberSession();

    expect(result.error?.status).toBe(409);
    await expect(result.error?.json()).resolves.toMatchObject({ error: "TENANT_SELECTION_REQUIRED" });
    expect(result.data).toBeNull();
  });

  it.each(["OWNER", "MANAGER", "BARBER"])(
    "platform admin com membership %s preserva o papel operacional",
    async (role) => {
      getServerSessionMock.mockResolvedValue(
        session(role, "platform-user", "max.guarinieri@gmail.com")
      );
      prismaMock.barbershopMember.findMany.mockResolvedValue([{
        id: "platform-member",
        userId: "platform-user",
        barbershopId: "shop-a",
        role,
        isActive: true,
      }]);

      const result = await getMemberSession();
      const adminResult = await getAdminSession();

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        role,
        memberId: "platform-member",
        barbershopId: "shop-a",
      });
      expect(adminResult.error).toBeNull();
      expect(adminResult.data?.role).toBe(role);
    }
  );

  it("platform admin sem membership nao recebe contexto operacional artificial", async () => {
    getServerSessionMock.mockResolvedValue(
      session("SUPER_ADMIN", "platform-user", "max.guarinieri@gmail.com")
    );
    prismaMock.barbershopMember.findMany.mockResolvedValue([]);

    const result = await getMemberSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it("platform admin com multiplas memberships continua exigindo selecao de tenant", async () => {
    getServerSessionMock.mockResolvedValue(
      session("OWNER", "platform-user", "max.guarinieri@gmail.com")
    );
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "member-a", userId: "platform-user", barbershopId: "shop-a", role: "OWNER", isActive: true },
      { id: "member-b", userId: "platform-user", barbershopId: "shop-b", role: "OWNER", isActive: true },
    ]);

    const result = await getMemberSession();

    expect(result.error?.status).toBe(409);
    await expect(result.error?.json()).resolves.toMatchObject({ error: "TENANT_SELECTION_REQUIRED" });
    expect(result.data).toBeNull();
  });

  it("platform admin OWNER passa pela permissao de criacao de comanda", async () => {
    getServerSessionMock.mockResolvedValue(
      session("OWNER", "platform-user", "max.guarinieri@gmail.com")
    );
    prismaMock.barbershopMember.findMany.mockResolvedValue([{
      id: "platform-member",
      userId: "platform-user",
      barbershopId: "shop-a",
      role: "OWNER",
      isActive: true,
    }]);

    const response = await createComanda(new NextRequest("http://localhost/api/admin/comandas", {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Body invalido." });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
