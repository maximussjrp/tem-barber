import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getSweepstakes, POST as createSweepstake } from "@/app/api/admin/marketing/sorteios/route";
import { GET as getDetail, PUT as updateSweepstake, DELETE as deleteSweepstake } from "@/app/api/admin/marketing/sorteios/[id]/route";

const { mockPrisma, mockSession } = vi.hoisted(() => ({
  mockPrisma: {
    customerSweepstake: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    customerSweepstakePrize: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));
vi.mock("@/lib/api-auth", () => ({
  getAdminSession: () => mockSession(),
}));

describe("API Routes — /api/admin/marketing/sorteios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({
      error: null,
      data: {
        userId: "user-owner-1",
        barbershopId: "shop-test-1",
        role: "OWNER",
      },
    });
  });

  describe("GET /api/admin/marketing/sorteios", () => {
    it("retorna lista de campanhas isoladas pela barbearia autenticada", async () => {
      mockPrisma.customerSweepstake.findMany.mockResolvedValue([
        {
          id: "sw-1",
          barbershopId: "shop-test-1",
          title: "Sorteio de Natal",
          status: "DRAFT",
          prizes: [{ id: "pz-1", position: 1, title: "Prêmio 1" }],
          winners: [],
          _count: { participants: 10, tickets: 25, winners: 0 },
        },
      ]);

      const req = new NextRequest("http://localhost:3000/api/admin/marketing/sorteios");
      const res = await getSweepstakes(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sweepstakes.length).toBe(1);
      expect(mockPrisma.customerSweepstake.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barbershopId: "shop-test-1" },
        })
      );
    });

    it("bloqueia acesso se usuário não tiver papel gerencial (401/403)", async () => {
      mockSession.mockResolvedValue({
        error: new Response(JSON.stringify({ error: "Acesso negado." }), { status: 403 }),
        data: null,
      });

      const req = new NextRequest("http://localhost:3000/api/admin/marketing/sorteios");
      const res = await getSweepstakes(req);

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/marketing/sorteios", () => {
    it("valida campos obrigatórios e rejeita criação sem título", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/marketing/sorteios", {
        method: "POST",
        body: JSON.stringify({
          title: "",
          startDateCivil: "2026-10-01",
          endDateCivil: "2026-10-31",
          prizes: [{ title: "Prêmio" }],
        }),
      });

      const res = await createSweepstake(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("Título da campanha é obrigatório");
    });

    it("rejeita criação sem prêmios cadastrados", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/marketing/sorteios", {
        method: "POST",
        body: JSON.stringify({
          title: "Sorteio Válido",
          startDateCivil: "2026-10-01",
          endDateCivil: "2026-10-31",
          prizes: [],
        }),
      });

      const res = await createSweepstake(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("pelo menos 1 prêmio");
    });
  });

  describe("GET /api/admin/marketing/sorteios/[id]", () => {
    it("retorna 404 se a campanha pertencer a outra barbearia (isolamento multi-tenant)", async () => {
      mockPrisma.customerSweepstake.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/admin/marketing/sorteios/sw-outro");
      const res = await getDetail(req, { params: Promise.resolve({ id: "sw-outro" }) });

      expect(res.status).toBe(404);
      expect(mockPrisma.customerSweepstake.findUnique).toHaveBeenCalledWith({
        where: { id_barbershopId: { id: "sw-outro", barbershopId: "shop-test-1" } },
        include: expect.any(Object),
      });
    });
  });
});
