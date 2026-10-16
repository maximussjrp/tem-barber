/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/commissions/payouts/route";
import { requireOperationalSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { CommissionDisbursementMethod, Prisma } from "@prisma/client";

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershopMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    commissionPayout: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("TEM BARBER — Commission Payment History (GET /api/admin/commissions/payouts)", () => {
  const barbershopA = "shop-aaa-111";
  const barbershopB = "shop-bbb-222";
  const userAdminId = "user-admin-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. RBAC & Auth
  describe("1. RBAC e Autenticação", () => {
    it("deve retornar 401 quando não autenticado", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: new Response(JSON.stringify({ error: "Não autenticado." }), { status: 401 }),
        data: null,
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("deve retornar 403 para perfil BARBER sem permissão financeira", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user-barber",
          barbershopId: barbershopA,
          role: "BARBER",
        },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      const res = await GET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Acesso negado.");
    });

    it("deve permitir acesso para OWNER", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("450.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });

    it("deve permitir acesso para MANAGER", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: "user-manager",
          barbershopId: barbershopA,
          role: "MANAGER",
        },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("0.00") },
        _count: { id: 0 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(0);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  // 2. Isolamento Multi-Tenant
  describe("2. Isolamento Multi-Tenant", () => {
    it("deve filtrar estritamente por barbershopId da sessão", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: null },
        _count: { id: 0 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(0);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      await GET(req);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barbershopId: barbershopA,
          }),
        })
      );
      expect(barbershopA).not.toBe(barbershopB);
      expect(prisma.commissionPayout.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barbershopId: barbershopA,
          }),
        })
      );
    });

    it("deve rejeitar busca por memberId de outra barbearia com 404", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      // Member pertence a barbershopB, logo não é encontrado para barbershopA
      (prisma.barbershopMember.findFirst as any).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?memberId=member-foreign");
      const res = await GET(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Profissional não encontrado.");
    });
  });

  // 3. Filtro por Profissional (incluindo Inativos)
  describe("3. Filtro por Profissional e Colaboradores Inativos", () => {
    it("deve aceitar memberId de colaborador inativo legítimo da barbearia", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.barbershopMember.findFirst as any).mockResolvedValueOnce({
        id: "member-inactive",
        barbershopId: barbershopA,
        isActive: false,
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("120.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([
        {
          id: "payout-1",
          cycleId: "cycle-1",
          memberId: "member-inactive",
          amount: new Prisma.Decimal("120.00"),
          paymentMethod: CommissionDisbursementMethod.PIX,
          paidAt: new Date("2026-10-10T15:00:00Z"),
          notes: "Acerto de rescisão",
          createdAt: new Date("2026-10-10T15:00:00Z"),
          member: {
            id: "member-inactive",
            role: "BARBER",
            isActive: false,
            user: { id: "u-inact", name: "Ex Barbeiro", email: "ex@barber.com" },
          },
          cycle: {
            id: "cycle-1",
            cycleNumber: 5,
            status: "PAID",
            grossCommission: new Prisma.Decimal("120.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("0.00"),
            finalPayoutAmount: new Prisma.Decimal("120.00"),
            remainingBalance: new Prisma.Decimal("0.00"),
            openedAt: new Date("2026-10-01T00:00:00Z"),
            closedAt: new Date("2026-10-10T15:00:00Z"),
            paidAt: new Date("2026-10-10T15:00:00Z"),
          },
          createdBy: { id: userAdminId, name: "Admin" },
        },
      ]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?memberId=member-inactive");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.payouts).toHaveLength(1);
      expect(json.payouts[0].member.isActive).toBe(false);
      expect(json.payouts[0].member.name).toBe("Ex Barbeiro");
      expect(json.payouts[0].amount).toBe(120);
    });
  });

  // 4. Filtros de Período (Datas e Mês/Ano)
  describe("4. Filtros Temporais e Fuso de Negócio", () => {
    it("deve aceitar intervalo válido startDate e endDate", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("300.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?startDate=2026-10-01&endDate=2026-10-15");
      const res = await GET(req);
      expect(res.status).toBe(200);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paidAt: {
              gte: new Date("2026-10-01T03:00:00.000Z"),
              lt: new Date("2026-10-16T03:00:00.000Z"),
            },
          }),
        })
      );
    });

    it("deve rejeitar quando apenas startDate é informado", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?startDate=2026-10-01");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Datas inicial e final");
    });

    it("deve rejeitar quando endDate é anterior a startDate", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?startDate=2026-10-15&endDate=2026-10-01");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("A data final não pode ser anterior à data inicial.");
    });

    it("deve aceitar ano/mês (competência) válido", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("500.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?yearMonth=2026-10");
      const res = await GET(req);
      expect(res.status).toBe(200);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paidAt: {
              gte: new Date("2026-10-01T03:00:00.000Z"),
              lt: new Date("2026-11-01T03:00:00.000Z"),
            },
          }),
        })
      );
    });

    it("deve rejeitar ano/mês malformado", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?yearMonth=2026-13");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });

  // 5. Formas de Pagamento e Nulo
  describe("5. Formas de Pagamento e Nulo", () => {
    it("deve filtrar por PIX", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(0);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?paymentMethod=PIX");
      const res = await GET(req);
      expect(res.status).toBe(200);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paymentMethod: "PIX" }),
        })
      );
    });

    it("deve filtrar por método NULL quando solicitado", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(0);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?paymentMethod=NULL");
      const res = await GET(req);
      expect(res.status).toBe(200);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paymentMethod: null }),
        })
      );
    });

    it("deve retornar 422 para método de pagamento inválido", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?paymentMethod=CRYPTO");
      const res = await GET(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.code).toBe("INVALID_PAYMENT_METHOD");
    });
  });

  // 6. Liquidação de R$ 0,00 e Valores Centavos
  describe("6. Liquidação de Valor R$ 0,00", () => {
    it("deve retornar payout de valor zero com precisão numérica e formato", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("0.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([
        {
          id: "payout-zero",
          cycleId: "cycle-zero",
          memberId: "member-1",
          amount: new Prisma.Decimal("0.00"),
          paymentMethod: null,
          paidAt: new Date("2026-10-14T10:00:00Z"),
          notes: "Adiantamentos cobriram integralmente a comissão",
          createdAt: new Date("2026-10-14T10:00:00Z"),
          member: {
            id: "member-1",
            role: "BARBER",
            isActive: true,
            user: { id: "u-1", name: "Barbeiro Um", email: "barber@test.com" },
          },
          cycle: {
            id: "cycle-zero",
            cycleNumber: 3,
            status: "PAID",
            grossCommission: new Prisma.Decimal("200.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("200.00"),
            finalPayoutAmount: new Prisma.Decimal("0.00"),
            remainingBalance: new Prisma.Decimal("0.00"),
            openedAt: new Date("2026-10-01T00:00:00Z"),
            closedAt: new Date("2026-10-14T10:00:00Z"),
            paidAt: new Date("2026-10-14T10:00:00Z"),
          },
          createdBy: { id: userAdminId, name: "Admin" },
        },
      ]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.payouts[0].amount).toBe(0);
      expect(json.summary.totalPaidAmount).toBe(0);
      expect(json.payouts[0].cycle.advancesTotal).toBe(200);
    });
  });

  // 7. Paginação e Totais Agregados
  describe("7. Paginação e Agregações Independentes", () => {
    it("deve retornar total agregado do banco refletindo todos os registros", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      // Total de 45 registros somando R$ 15.000,00, mas página 2 com limit 20
      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("15000.00") },
        _count: { id: 45 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(45);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?page=2&limit=20");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.pagination.page).toBe(2);
      expect(json.pagination.limit).toBe(20);
      expect(json.pagination.totalRecords).toBe(45);
      expect(json.pagination.totalPages).toBe(3);
      expect(json.pagination.hasMore).toBe(true);
      expect(json.summary.totalPaidAmount).toBe(15000);
      expect(json.summary.totalPayoutsCount).toBe(45);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
          orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        })
      );
    });
  });

  // 8. Busca Textual por Nome ou Número de Ciclo
  describe("8. Busca Textual por Nome ou Ciclo", () => {
    it("deve buscar por nome do profissional e por número de ciclo se numérico", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({ _sum: { amount: null }, _count: { id: 0 } });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(0);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?search=14");
      await GET(req);

      expect(prisma.commissionPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { member: { user: { name: { contains: "14", mode: "insensitive" } } } },
              { cycle: { cycleNumber: 14 } },
            ],
          }),
        })
      );
    });
  });

  // 9. Exportação CSV e Proteção contra Injeção de Fórmulas
  describe("9. Exportação CSV Segura (CSV Formula Injection Defense)", () => {
    it("deve retornar arquivo CSV com UTF-8 BOM, delimitador ';' e células neutralizadas contra injeção", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: { userId: userAdminId, barbershopId: barbershopA, role: "OWNER" },
      });

      // Registro malicioso com tentativa de formula injection
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([
        {
          id: "payout-injection",
          cycleId: "cycle-inj",
          memberId: "member-inj",
          amount: new Prisma.Decimal("150.00"),
          paymentMethod: CommissionDisbursementMethod.PIX,
          paidAt: new Date("2026-10-15T12:00:00Z"),
          notes: "=cmd|' /C calc'!A0",
          createdAt: new Date("2026-10-15T12:00:00Z"),
          member: {
            id: "member-inj",
            role: "BARBER",
            isActive: true,
            user: { id: "u-inj", name: "@MaliciousBarber", email: "inj@test.com" },
          },
          cycle: {
            id: "cycle-inj",
            cycleNumber: 8,
            status: "PAID",
            grossCommission: new Prisma.Decimal("150.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("0.00"),
            finalPayoutAmount: new Prisma.Decimal("150.00"),
            remainingBalance: new Prisma.Decimal("0.00"),
            openedAt: new Date("2026-10-01T00:00:00Z"),
            closedAt: new Date("2026-10-15T12:00:00Z"),
            paidAt: new Date("2026-10-15T12:00:00Z"),
          },
          createdBy: { id: userAdminId, name: "+AdminBoss" },
        },
      ]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?format=csv");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toContain("attachment; filename=");

      const arrayBuffer = await res.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      // Confirma que os primeiros 3 bytes são exatamente o UTF-8 BOM (0xEF, 0xBB, 0xBF)
      expect(bytes[0]).toBe(0xef);
      expect(bytes[1]).toBe(0xbb);
      expect(bytes[2]).toBe(0xbf);

      const csvText = bytes.toString("utf8");

      // Confirma que células que começam com =, +, -, @ foram neutralizadas com aspa simples (')
      expect(csvText).toContain("'@MaliciousBarber");
      expect(csvText).toContain("'+AdminBoss");
      expect(csvText).toContain("'=cmd|' /C calc'!A0");
      expect(csvText).toContain("150,00");
      expect(csvText).toContain("Ciclo #8");
    });

    it("deve retornar 422 CSV_EXPORT_LIMIT_EXCEEDED se total de registros exceder 5000", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.count as any).mockResolvedValueOnce(5001);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?format=csv");
      const res = await GET(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code).toBe("CSV_EXPORT_LIMIT_EXCEEDED");
      expect(data.totalMatching).toBe(5001);
      expect(data.maxLimit).toBe(5000);
      expect(data.error).toContain("excede o limite operacional de 5000 registros");
    });

    it("deve retornar 422 PRINT_LIMIT_EXCEEDED se total de registros para impressão exceder 5000", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.count as any).mockResolvedValueOnce(5001);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?format=print");
      const res = await GET(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code).toBe("PRINT_LIMIT_EXCEEDED");
      expect(data.totalMatching).toBe(5001);
      expect(data.maxLimit).toBe(5000);
      expect(data.error).toContain("excede o limite operacional de 5000 registros");
    });

    it("deve retornar registros completos com isPrintMode: true para format=print", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      (prisma.commissionPayout.aggregate as any).mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal("150.00") },
        _count: { id: 1 },
      });
      (prisma.commissionPayout.count as any).mockResolvedValueOnce(1);
      (prisma.commissionPayout.findMany as any).mockResolvedValueOnce([
        {
          id: "p-print-1",
          cycleId: "cyc-1",
          memberId: "m-1",
          amount: new Prisma.Decimal("150.00"),
          paymentMethod: CommissionDisbursementMethod.PIX,
          paidAt: new Date("2026-10-15T10:00:00Z"),
          notes: null,
          createdAt: new Date("2026-10-15T10:00:00Z"),
          member: {
            id: "m-1",
            role: "BARBER",
            isActive: true,
            user: { name: "Barbeiro Teste" },
          },
          cycle: {
            id: "cyc-1",
            cycleNumber: 1,
            status: "PAID",
            grossCommission: new Prisma.Decimal("150.00"),
            adjustmentsTotal: new Prisma.Decimal("0.00"),
            advancesTotal: new Prisma.Decimal("0.00"),
            finalPayoutAmount: new Prisma.Decimal("150.00"),
            remainingBalance: new Prisma.Decimal("0.00"),
            openedAt: new Date("2026-10-01T00:00:00Z"),
            closedAt: new Date("2026-10-15T10:00:00Z"),
            paidAt: new Date("2026-10-15T10:00:00Z"),
          },
          createdBy: { id: userAdminId, name: "Admin" },
        },
      ]);

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?format=print");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pagination.isPrintMode).toBe(true);
      expect(data.pagination.limit).toBe(5000);
      expect(data.payouts).toHaveLength(1);
      expect(data.payouts[0].amount).toBe(150.0);
    });

    it("deve rejeitar requisição com apenas startDate e sem endDate", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?startDate=2026-10-01");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Datas inicial e final (startDate e endDate) devem ser fornecidas em conjunto.");
    });

    it("deve rejeitar requisição com apenas endDate e sem startDate", async () => {
      (requireOperationalSession as any).mockResolvedValueOnce({
        error: null,
        data: {
          userId: userAdminId,
          barbershopId: barbershopA,
          role: "OWNER",
        },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/payouts?endDate=2026-10-15");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Datas inicial e final (startDate e endDate) devem ser fornecidas em conjunto.");
    });
  });
});
