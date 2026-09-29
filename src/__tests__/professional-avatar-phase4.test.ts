/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET as getPublicBarbershop } from "@/app/api/public/barbershop/[slug]/route";
import { POST as postAdminAvatar, DELETE as deleteAdminAvatar } from "@/app/api/admin/team/[id]/avatar/route";

const { prismaMock, getAdminSessionMock, getTenantSubscriptionMock, isSubscriptionActiveMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: {
      findFirst: vi.fn(),
    },
    review: {
      findMany: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
  getTenantSubscriptionMock: vi.fn(),
  isSubscriptionActiveMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/subscription-utils", () => ({
  getTenantSubscription: getTenantSubscriptionMock,
  isSubscriptionActive: isSubscriptionActiveMock,
}));

describe("Phase 4 - Professional Avatar Requirements (A-I)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenantSubscriptionMock.mockResolvedValue({ id: "sub-1", status: "ACTIVE" });
    isSubscriptionActiveMock.mockReturnValue(true);
  });

  describe("Public API & Role Exclusion (A, B, C, D, E, F)", () => {
    it("A, B, C, D: retorna BARBER, OWNER e MANAGER com seus avatares em /api/public/barbershop/[slug] e EXCLUI RECEPTIONIST", async () => {
      const mockBarbershopData = {
        id: "shop-100",
        name: "Barbearia Match",
        slug: "barbearia-match",
        description: "Barbearia Premium",
        phone: "11999998888",
        logoUrl: "/logo-barbershop.png",
        coverUrl: "/cover.jpg",
        street: "Rua Principal",
        number: "100",
        complement: null,
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        categories: [],
        members: [
          {
            id: "m-owner",
            role: "OWNER",
            bio: "Dono e Barbeiro Master",
            ratingAvg: 5.0,
            user: { name: "Carlos Owner", avatarUrl: "/uploads/owner-photo.webp" },
            services: [],
            workingHours: [],
          },
          {
            id: "m-manager",
            role: "MANAGER",
            bio: "Gerente e Especialista",
            ratingAvg: 4.8,
            user: { name: "Mariana Manager", avatarUrl: "/uploads/manager-photo.png" },
            services: [],
            workingHours: [],
          },
          {
            id: "m-barber",
            role: "BARBER",
            bio: "Barbeiro",
            ratingAvg: 4.9,
            user: { name: "Bruno Barber", avatarUrl: "/uploads/barber-photo.jpg" },
            services: [],
            workingHours: [],
          },
        ],
      };

      prismaMock.barbershop.findFirst.mockResolvedValue(mockBarbershopData);
      prismaMock.review.findMany.mockResolvedValue([]);
      prismaMock.barbershopMember.findFirst.mockResolvedValue({
        id: "m-owner",
        role: "OWNER",
        workingHours: [],
      });

      const req = new Request("http://localhost:3000/api/public/barbershop/barbearia-match");
      const res = await getPublicBarbershop(req as any, { params: Promise.resolve({ slug: "barbearia-match" }) });

      expect(res.status).toBe(200);
      const json = await res.json();

      // Verifica query no Prisma - role in ["BARBER", "MANAGER", "OWNER"] e RECEPTIONIST não incluído
      expect(prismaMock.barbershop.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            members: expect.objectContaining({
              where: { isActive: true, role: { in: ["BARBER", "MANAGER", "OWNER"] } },
            }),
          }),
        })
      );

      // A: BARBER com avatar aparece com foto no booking
      const barber = json.members.find((m: any) => m.role === "BARBER");
      expect(barber).toBeDefined();
      expect(barber.avatarUrl).toBe("/uploads/barber-photo.jpg");

      // B: OWNER com avatar aparece com foto no booking
      const owner = json.members.find((m: any) => m.role === "OWNER");
      expect(owner).toBeDefined();
      expect(owner.avatarUrl).toBe("/uploads/owner-photo.webp");

      // C: MANAGER elegível com avatar aparece com foto
      const manager = json.members.find((m: any) => m.role === "MANAGER");
      expect(manager).toBeDefined();
      expect(manager.avatarUrl).toBe("/uploads/manager-photo.png");

      // D: RECEPTIONIST não aparece
      const receptionist = json.members.find((m: any) => m.role === "RECEPTIONIST");
      expect(receptionist).toBeUndefined();
    });

    it("E, F: profissional sem avatar retorna null para avatarUrl (usará iniciais) e NUNCA logo da barbearia", async () => {
      const mockBarbershopData = {
        id: "shop-100",
        name: "Barbearia Match",
        slug: "barbearia-match",
        logoUrl: "/logo-barbershop.png",
        categories: [],
        members: [
          {
            id: "m-no-avatar",
            role: "BARBER",
            bio: null,
            ratingAvg: 5.0,
            user: { name: "Pedro SemFoto", avatarUrl: null },
            services: [],
            workingHours: [],
          },
        ],
      };

      prismaMock.barbershop.findFirst.mockResolvedValue(mockBarbershopData);
      prismaMock.review.findMany.mockResolvedValue([]);
      prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

      const req = new Request("http://localhost:3000/api/public/barbershop/barbearia-match");
      const res = await getPublicBarbershop(req as any, { params: Promise.resolve({ slug: "barbearia-match" }) });

      expect(res.status).toBe(200);
      const json = await res.json();

      const member = json.members[0];
      // E: profissional sem avatar usa null -> iniciais
      expect(member.avatarUrl).toBeNull();
      // F: NUNCA usa logo da barbearia como fallback
      expect(member.avatarUrl).not.toBe(json.barbershop.logoUrl);
    });
  });

  describe("Admin Member Avatar API & Security (G, H, I)", () => {
    // Valid 1x1 PNG bytes (starts with 89 50 4E 47 0D 0A 1A 0A)
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    it("G: OWNER consegue alterar foto via POST /api/admin/team/[id]/avatar", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "user-owner", memberId: "m-owner", barbershopId: "shop-100", role: "OWNER" },
      });

      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: "m-owner",
        barbershopId: "shop-100",
        userId: "user-owner",
      });
      prismaMock.user.update.mockResolvedValue({ id: "user-owner" });

      const realFile = new File([validPngBuffer], "owner-avatar.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", realFile);

      const req = new Request("http://localhost:3000/api/admin/team/m-owner/avatar", {
        method: "POST",
        body: formData,
      });

      const res = await postAdminAvatar(req, { params: Promise.resolve({ id: "m-owner" }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.url).toMatch(/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-owner" },
        data: { avatarUrl: json.url },
      });
    });

    it("H: remoção de foto via DELETE /api/admin/team/[id]/avatar seta avatarUrl como null", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "user-owner", memberId: "m-owner", barbershopId: "shop-100", role: "OWNER" },
      });

      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: "m-owner",
        barbershopId: "shop-100",
        userId: "user-owner",
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-owner",
        avatarUrl: "/uploads/f47ac10b-58cc-4372-a567-0e02b2c3d479.png",
      });
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.update.mockResolvedValue({ id: "user-owner", avatarUrl: null });

      const req = new Request("http://localhost:3000/api/admin/team/m-owner/avatar", {
        method: "DELETE",
      });

      const res = await deleteAdminAvatar(req, { params: Promise.resolve({ id: "m-owner" }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json).toEqual({ success: true, url: null });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-owner" },
        data: { avatarUrl: null },
      });
    });

    it("I: cross-tenant é bloqueado (tentar alterar foto de colaborador de outra barbearia retorna 404)", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "user-hacker", memberId: "m-hacker", barbershopId: "shop-999", role: "OWNER" },
      });

      // Membro pertence à shop-100, mas o admin solicitante é da shop-999
      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: "m-target",
        barbershopId: "shop-100",
        userId: "user-target",
      });

      const realFile = new File([validPngBuffer], "hack.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", realFile);

      const postReq = new Request("http://localhost:3000/api/admin/team/m-target/avatar", {
        method: "POST",
        body: formData,
      });

      const postRes = await postAdminAvatar(postReq, { params: Promise.resolve({ id: "m-target" }) });
      expect(postRes.status).toBe(404);
      const postJson = await postRes.json();
      expect(postJson.error).toBe("Colaborador não encontrado.");

      const deleteReq = new Request("http://localhost:3000/api/admin/team/m-target/avatar", {
        method: "DELETE",
      });

      const deleteRes = await deleteAdminAvatar(deleteReq, { params: Promise.resolve({ id: "m-target" }) });
      expect(deleteRes.status).toBe(404);
      const deleteJson = await deleteRes.json();
      expect(deleteJson.error).toBe("Colaborador não encontrado.");
    });
  });
});
