import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as resetAccessPOST } from "@/app/api/admin/team/[id]/reset-access/route";
import { PATCH as teamMemberPATCH, PUT as teamMemberPUT } from "@/app/api/admin/team/[id]/route";
import * as apiAuth from "@/lib/api-auth";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    staffAccessToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn(),
}));

describe("P0 Remote Audit - Team Security, Cross-Tenant Isolation and Immutability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAdminSession = {
    userId: "owner-user-1",
    role: "OWNER" as const,
    memberId: "member-owner-1",
    barbershopId: "shop-tenant-a",
  };

  describe("Reset Access em Membro Inativo", () => {
    it("retorna 409 MEMBER_INACTIVE e recusa gerar token quando membro estiver inativo", async () => {
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: mockAdminSession,
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      vi.mocked(prisma.barbershopMember.findUnique).mockResolvedValue({
        id: "member-inactive-a",
        barbershopId: "shop-tenant-a",
        userId: "shared-user-1",
        isActive: false, // Inativo no tenant A
        role: "BARBER",
        user: { id: "shared-user-1", name: "User 1", email: "u1@test.com", phone: "11999999999" },
        barbershop: { id: "shop-tenant-a", name: "Barbearia A" },
      } as never);

      const req = new NextRequest("http://localhost/api/admin/team/member-inactive-a/reset-access", {
        method: "POST",
      });

      const res = await resetAccessPOST(req, {
        params: Promise.resolve({ id: "member-inactive-a" }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("MEMBER_INACTIVE");
      expect(prisma.staffAccessToken.create).not.toHaveBeenCalled();
    });
  });

  describe("Reativação de Membro - Bloqueio de Conflito Multi-Tenant", () => {
    it("bloqueia reativação com 409 ACTIVE_MEMBERSHIP_CONFLICT se o usuário estiver ativo em outro tenant", async () => {
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: mockAdminSession,
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      // Membro no tenant A (inativo)
      vi.mocked(prisma.barbershopMember.findUnique).mockResolvedValue({
        id: "member-inactive-a",
        barbershopId: "shop-tenant-a",
        userId: "shared-user-1",
        isActive: false,
        role: "BARBER",
        user: { id: "shared-user-1" },
        careerLevel: null,
      } as never);

      // Consulta conflitante em outro tenant
      vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({
        id: "member-active-b",
        barbershopId: "shop-tenant-b",
        userId: "shared-user-1",
        isActive: true,
      } as never);

      const req = new NextRequest("http://localhost/api/admin/team/member-inactive-a", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });

      const res = await teamMemberPATCH(req, {
        params: Promise.resolve({ id: "member-inactive-a" }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("ACTIVE_MEMBERSHIP_CONFLICT");
      expect(prisma.barbershopMember.update).not.toHaveBeenCalled();
    });
  });

  describe("Membro Inativo não pode Alterar Identidade Global do User", () => {
    it("rejeita com 409 INACTIVE_MEMBER_IMMUTABLE_USER qualquer alteração de name/phone/cpf/email para membro inativo", async () => {
      vi.mocked(apiAuth.getAdminSession).mockResolvedValue({
        data: mockAdminSession,
        error: null,
      } as unknown as Awaited<ReturnType<typeof apiAuth.getAdminSession>>);

      vi.mocked(prisma.barbershopMember.findUnique).mockResolvedValue({
        id: "member-inactive-a",
        barbershopId: "shop-tenant-a",
        userId: "shared-user-1",
        isActive: false,
        role: "BARBER",
        user: { id: "shared-user-1", name: "Antigo Nome", phone: "11988887777" },
        careerLevel: null,
      } as never);

      const req = new NextRequest("http://localhost/api/admin/team/member-inactive-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Novo Nome Forçado",
          role: "BARBER",
        }),
      });

      const res = await teamMemberPUT(req, {
        params: Promise.resolve({ id: "member-inactive-a" }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("INACTIVE_MEMBER_IMMUTABLE_USER");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
