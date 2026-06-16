import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopMember: { findFirst: vi.fn() },
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { getAdminSession } from "@/lib/api-auth";
import { getMemberSession } from "@/lib/member-api-auth";

function session(role: string, id = "user-a") {
  return { user: { id, role } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.barbershopMember.findFirst.mockResolvedValue({
    id: "member-a",
    userId: "user-a",
    barbershopId: "shop-a",
    isActive: true,
  });
});

describe("guards e isolamento", () => {
  it.each(["OWNER", "MANAGER"])("%s recebe acesso administrativo", async (role) => {
    getServerSessionMock.mockResolvedValue(session(role));

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
    prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

    const result = await getAdminSession();

    expect(result.error?.status).toBe(403);
    expect(result.data).toBeNull();
  });

  it.each(["OWNER", "MANAGER", "BARBER"])("%s recebe sessao de membro", async (role) => {
    getServerSessionMock.mockResolvedValue(session(role));

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
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-manager",
      userId: "manager-a",
      barbershopId: "shop-b",
      isActive: true,
    });

    const result = await getAdminSession();

    expect(prismaMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { userId: "manager-a", isActive: true },
    });
    expect(result.data?.barbershopId).toBe("shop-b");
  });
});
