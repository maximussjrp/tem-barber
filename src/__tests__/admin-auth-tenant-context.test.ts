import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, bcryptCompareMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn() },
    barbershopMember: { findMany: vi.fn() },
  },
  bcryptCompareMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("bcryptjs", () => ({ default: { compare: bcryptCompareMock } }));

import { authOptions } from "@/lib/auth";

type CredentialsAuthorize = (
  credentials: Record<string, string> | undefined,
  request: unknown
) => Promise<Record<string, unknown> | null>;

function getCredentialsAuthorize() {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: CredentialsAuthorize };
  };
  return provider.options.authorize;
}

function activeMembership(id: string, barbershopId: string, role = "OWNER") {
  return { id, userId: "user-a", barbershopId, role, isActive: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  bcryptCompareMock.mockResolvedValue(true);
  prismaMock.user.findFirst.mockResolvedValue({
    id: "user-a",
    name: "Admin",
    email: "admin@example.test",
    phone: "5517991089190",
    passwordHash: "hash",
    role: "USER",
  });
});

describe("login administrativo e contexto de tenant", () => {
  it("usa somente a unica membership ativa para definir o papel da sessao", async () => {
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      activeMembership("member-active", "shop-active", "MANAGER"),
    ]);

    const user = await getCredentialsAuthorize()(
      { loginType: "admin", email: "admin@example.test", password: "secret" },
      {}
    );

    expect(user).toMatchObject({ id: "user-a", role: "MANAGER", authLevel: "admin" });
    expect(prismaMock.barbershopMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-a", isActive: true },
      take: 2,
    }));
  });

  it("interrompe login administrativo quando existem duas memberships ativas", async () => {
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      activeMembership("member-a", "shop-a"),
      activeMembership("member-b", "shop-b"),
    ]);

    await expect(getCredentialsAuthorize()(
      { loginType: "admin", email: "admin@example.test", password: "secret" },
      {}
    )).rejects.toThrow("TENANT_SELECTION_REQUIRED");
  });
});
