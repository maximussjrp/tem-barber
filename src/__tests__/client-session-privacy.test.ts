import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    appointment: { create: vi.fn() },
    customerBarbershopLink: { create: vi.fn() },
    comanda: { create: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

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

describe("privacidade da sessao phone_lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-real",
      name: "Nome Real",
      email: "real@example.test",
      phone: "5511999999999",
      role: "USER",
    });
  });

  it("nao expõe PII persistida ao criar contexto para User existente", async () => {
    const user = await getCredentialsAuthorize()(
      {
        loginType: "client",
        name: "Nome Arbitrario",
        phone: "(11) 99999-9999",
      },
      {}
    );

    expect(user).toMatchObject({
      id: "user-real",
      name: "Cliente",
      email: null,
      phone: "5511999999999",
      authLevel: "phone_lookup",
    });
    expect(user?.name).not.toBe("Nome Real");
    expect(user?.email).not.toBe("real@example.test");
  });

  it("contexto phone_lookup do booking cria somente User para telefone novo", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-new",
      name: "Nome Qualquer",
      email: null,
      phone: "5511987654320",
      role: "USER",
    });

    await getCredentialsAuthorize()(
      {
        loginType: "client",
        name: "Nome Qualquer",
        phone: "(11) 98765-4320",
      },
      {}
    );

    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    expect(prismaMock.customerBarbershopLink.create).not.toHaveBeenCalled();
    expect(prismaMock.comanda.create).not.toHaveBeenCalled();
  });

  it("sanitiza token e sessao phone_lookup emitidos antes do hotfix", async () => {
    const jwtCallback = authOptions.callbacks?.jwt as unknown as (input: {
      token: Record<string, unknown>;
      user?: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    const sessionCallback = authOptions.callbacks?.session as unknown as (input: {
      session: { user: Record<string, unknown>; expires: string };
      token: Record<string, unknown>;
    }) => Promise<{ user: Record<string, unknown>; expires: string }>;

    const sanitizedToken = await jwtCallback({
      token: {
        id: "user-real",
        name: "Nome Real",
        email: "real@example.test",
        phone: "5511999999999",
        role: "USER",
        authLevel: "phone_lookup",
        sub: "user-real",
      },
    });

    expect(sanitizedToken).toMatchObject({
      id: "user-real",
      name: "Cliente",
      email: null,
      phone: "5511999999999",
      authLevel: "phone_lookup",
    });
    expect(sanitizedToken).not.toHaveProperty("role");

    const session = await sessionCallback({
      session: {
        user: {
          name: "Nome Real",
          email: "real@example.test",
          image: "https://example.test/private.png",
          role: "USER",
        },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: sanitizedToken,
    });

    expect(session.user).toEqual({
      id: "user-real",
      name: "Cliente",
      email: null,
      image: null,
      phone: "5511999999999",
      authLevel: "phone_lookup",
    });
  });

  it("nao altera dados da sessao administrativa", async () => {
    const jwtCallback = authOptions.callbacks?.jwt as unknown as (input: {
      token: Record<string, unknown>;
      user?: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    const sessionCallback = authOptions.callbacks?.session as unknown as (input: {
      session: { user: Record<string, unknown>; expires: string };
      token: Record<string, unknown>;
    }) => Promise<{ user: Record<string, unknown>; expires: string }>;

    const token = await jwtCallback({
      token: {},
      user: {
        id: "owner-real",
        name: "Owner Real",
        email: "owner@example.test",
        phone: "5511988888888",
        role: "OWNER",
        authLevel: "admin",
      },
    });
    const session = await sessionCallback({
      session: {
        user: { name: "Owner Real", email: "owner@example.test" },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token,
    });

    expect(session.user).toMatchObject({
      id: "owner-real",
      name: "Owner Real",
      email: "owner@example.test",
      phone: "5511988888888",
      role: "OWNER",
      authLevel: "admin",
    });
  });
});
