import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    barbershopMember: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    careerLevel: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/utils", () => ({ isValidCpf: () => true }));

import { POST } from "@/app/api/admin/team/route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/team", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function adminSession(role = "OWNER", barbershopId = "shop-a") {
  return { error: null, data: { userId: "admin-a", role, memberId: "member-admin", barbershopId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminSessionMock.mockResolvedValue(adminSession());
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) =>
    callback(prismaMock)
  );
  prismaMock.$executeRaw.mockResolvedValue(undefined);
  prismaMock.careerLevel.findFirst.mockResolvedValue(null);
  prismaMock.barbershopMember.findMany.mockResolvedValue([]);
});

describe("POST /api/admin/team - Team Member Creation tests", () => {
  const defaultBody = {
    name: "Barbeiro Novo",
    phone: "(11) 99999-9999",
    cpf: "123.456.789-00",
    email: "barbeiro@example.com",
    password: "password123",
    role: "BARBER",
    bio: "Bio description",
  };

  it("1. User novo -> cria User com passwordHash e membership", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(({ data }: { data: unknown }) => ({ id: "new-user-id", ...(data as Record<string, unknown>) }));
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({ id: "member-id", ...(data as Record<string, unknown>) }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.userId).toBe("new-user-id");
    expect(body.role).toBe("BARBER");

    expect(prismaMock.user.create).toHaveBeenCalled();
    const createdUserArgs = prismaMock.user.create.mock.calls[0][0].data;
    expect(createdUserArgs.name).toBe("Barbeiro Novo");
    expect(createdUserArgs.phone).toBe("11999999999");
    expect(bcrypt.compareSync("password123", createdUserArgs.passwordHash)).toBe(true);
  });

  it("2. Cliente existente com passwordHash=null -> reutiliza User, define senha e cria membership", async () => {
    const existingUser = {
      id: "existing-client-id",
      name: "Cliente Existente",
      phone: "5511999999999",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.user.update.mockResolvedValue({ ...existingUser, passwordHash: "new-hash" });
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({ id: "member-id", ...(data as Record<string, unknown>) }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalled();
    const updateArgs = prismaMock.user.update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe("existing-client-id");
    expect(bcrypt.compareSync("password123", updateArgs.data.passwordHash)).toBe(true);

    expect(prismaMock.barbershopMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "existing-client-id",
          barbershopId: "shop-a",
        }),
      })
    );
  });

  it("3. User existente com senha -> cria membership e preserva a senha anterior", async () => {
    const existingStaff = {
      id: "existing-staff-id",
      name: "Barbeiro Outra Barbearia",
      phone: "5511999999999",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: "pre-existing-hash",
    };

    prismaMock.user.findFirst.mockResolvedValue(existingStaff);
    prismaMock.user.findUnique.mockResolvedValue(existingStaff);
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({ id: "member-id", ...(data as Record<string, unknown>) }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).toHaveBeenCalled();
  });

  it("4. Conflito de identidade (phone e email apontam para cadastros diferentes) -> retorna HTTP 409 IDENTITY_CONFLICT", async () => {
    prismaMock.user.findFirst.mockImplementation(async ({ where }: { where: { phone?: string | { in: string[] }; email?: string; cpf?: string } }) => {
      // phone query
      if (where && where.phone) {
        return { id: "user-a", name: "User A", phone: "5511999999999" };
      }
      return null;
    });

    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { phone?: string | { in: string[] }; email?: string; cpf?: string } }) => {
      // email or cpf query
      if (where && where.email === "barbeiro@example.com") {
        return { id: "user-b", name: "User B", email: "barbeiro@example.com" };
      }
      return null;
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("IDENTITY_CONFLICT");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });

  it("5. Membership já existente e ativo -> retorna HTTP 409 padrão", async () => {
    const existingUser = { id: "user-a", phone: "11999999999", cpf: "12345678900", email: "barbeiro@example.com", passwordHash: "hash" };
    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.barbershopMember.findMany.mockResolvedValue([{ id: "member-id", barbershopId: "shop-a", isActive: true }]);

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Este colaborador já está cadastrado nesta barbearia.");
  });

  it("6. Membership existente inativo -> retorna HTTP 409 orientando reativação", async () => {
    const existingUser = { id: "user-a", phone: "11999999999", cpf: "12345678900", email: "barbeiro@example.com", passwordHash: "hash" };
    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.barbershopMember.findMany.mockResolvedValue([{ id: "member-id", barbershopId: "shop-a", isActive: false }]);

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Reative-o");
  });

  it("6b. User com membership ativa EM OUTRA barbearia -> retorna 409 ACTIVE_MEMBERSHIP_CONFLICT", async () => {
    const existingUser = { id: "user-a", phone: "11999999999", cpf: "12345678900", email: "barbeiro@example.com", passwordHash: "hash" };
    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.barbershopMember.findMany.mockResolvedValue([{ id: "member-id", barbershopId: "shop-b", isActive: true }]);

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("ACTIVE_MEMBERSHIP_CONFLICT");
    expect(data.message).toBe("Este usuário já possui vínculo ativo com outra barbearia.");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });

  it("6c. User com membership inativa EM OUTRA barbearia -> pode criar membership ativa na barbearia atual", async () => {
    const existingUser = { id: "user-a", phone: "11999999999", cpf: "12345678900", email: "barbeiro@example.com", passwordHash: "hash" };
    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.barbershopMember.findMany.mockResolvedValue([{ id: "member-id", barbershopId: "shop-b", isActive: false }]);
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({ id: "member-id", ...(data as Record<string, unknown>) }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);
    expect(prismaMock.barbershopMember.create).toHaveBeenCalled();
  });

  it("7. Erro unique concorrente (P2002 no User/phone) -> retorna HTTP 409 formatado", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(() => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
        meta: { target: ["phone"] },
      });
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Conflito de cadastro concorrente");
  });

  it("8. Erro unique concorrente (P2002 no Membership) -> retorna HTTP 409 de colaborador cadastrado", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "user-id" });
    prismaMock.barbershopMember.create.mockImplementation(() => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
        meta: { target: ["barbershop_id", "user_id"] },
      });
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Este colaborador já está cadastrado nesta barbearia.");
  });
  it("9. Ordem de execução: existingUser → lock → findMany → update/create", async () => {
    const existingUser = {
      id: "order-user-id",
      name: "Order Test",
      phone: "5511999999999",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: null,
    };

    const callOrder: string[] = [];

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);

    prismaMock.$executeRaw.mockImplementation(() => {
      callOrder.push("advisory_lock");
      return Promise.resolve(undefined);
    });
    prismaMock.barbershopMember.findMany.mockImplementation(() => {
      callOrder.push("findMany_memberships");
      return Promise.resolve([]);
    });
    prismaMock.user.update.mockImplementation(({ data }: { data: unknown }) => {
      callOrder.push("update_password");
      return Promise.resolve({ ...existingUser, ...(data as Record<string, unknown>) });
    });
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => {
      callOrder.push("create_membership");
      return Promise.resolve({ id: "member-id", ...(data as Record<string, unknown>) });
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(callOrder).toEqual([
      "advisory_lock",
      "findMany_memberships",
      "update_password",
      "create_membership",
    ]);
  });

  it("A) Cliente existente somente com phone (cpf/email/passwordHash null) -> preenche campos ausentes e cria membership", async () => {
    const existingUser = {
      id: "existing-client-only-phone-id",
      name: "Cliente A",
      phone: "5511999999999",
      cpf: null,
      email: null,
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === existingUser.id) return existingUser;
      return null;
    });
    prismaMock.user.update.mockResolvedValue({
      ...existingUser,
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: "new-hash",
    });
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "member-id",
      ...(data as Record<string, unknown>),
    }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-client-only-phone-id" },
        data: expect.objectContaining({
          cpf: "12345678900",
          email: "barbeiro@example.com",
          passwordHash: expect.any(String),
        }),
      })
    );
  });

  it("B) existingUser com cpf existente diferente do CPF enviado -> 409 IDENTITY_MISMATCH", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente B",
      phone: "5511999999999",
      cpf: "99999999999",
      email: null,
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { cpf?: string } }) => {
      if (where.cpf === "99999999999") return existingUser;
      return null;
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("IDENTITY_MISMATCH");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });

  it("C) existingUser com email existente diferente do email enviado -> 409 IDENTITY_MISMATCH", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente C",
      phone: "5511999999999",
      cpf: null,
      email: "different-email@example.com",
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { email?: string } }) => {
      if (where.email === "different-email@example.com") return existingUser;
      return null;
    });

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("IDENTITY_MISMATCH");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });

  it("D) existingUser encontrado por CPF/email mas telefone informado não corresponde ao User -> 409 IDENTITY_MISMATCH", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente D",
      phone: "5511888888888",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("IDENTITY_MISMATCH");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });

  it("E) existingUser com cpf/email já corretos -> não sobrescrever e cria membership", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente E",
      phone: "5511999999999",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.user.update.mockResolvedValue({ ...existingUser, passwordHash: "new-hash" });
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "member-id",
      ...(data as Record<string, unknown>),
    }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-user-id" },
        data: {
          passwordHash: expect.any(String),
        },
      })
    );
    expect(prismaMock.barbershopMember.create).toHaveBeenCalled();
  });

  it("F) senha já existente -> hash continua exatamente igual", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente F",
      phone: "5511999999999",
      cpf: "12345678900",
      email: "barbeiro@example.com",
      passwordHash: "pre-existing-hash-value",
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockResolvedValue(existingUser);
    prismaMock.barbershopMember.create.mockImplementation(({ data }: { data: unknown }) => ({
      id: "member-id",
      ...(data as Record<string, unknown>),
    }));

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(201);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).toHaveBeenCalled();
  });

  it("G) ACTIVE_MEMBERSHIP_CONFLICT continua sem alterar cpf/email/passwordHash", async () => {
    const existingUser = {
      id: "existing-user-id",
      name: "Cliente G",
      phone: "5511999999999",
      cpf: null,
      email: null,
      passwordHash: null,
    };

    prismaMock.user.findFirst.mockResolvedValue(existingUser);
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === existingUser.id) return existingUser;
      return null;
    });
    prismaMock.barbershopMember.findMany.mockResolvedValue([
      { id: "member-id", barbershopId: "other-shop", isActive: true },
    ]);

    const res = await POST(jsonRequest(defaultBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("ACTIVE_MEMBERSHIP_CONFLICT");

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.barbershopMember.create).not.toHaveBeenCalled();
  });
});

