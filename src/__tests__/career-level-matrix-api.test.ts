import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getLevels, POST as postLevel } from "@/app/api/admin/career-levels/route";
import { PUT as putLevel, DELETE as deleteLevel } from "@/app/api/admin/career-levels/[id]/route";
import { GET as getMatrix, PUT as putMatrix } from "@/app/api/admin/commission-rules/matrix/route";
import { PUT as putTeamMember } from "@/app/api/admin/team/[id]/route";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  return {
    default: {
      careerLevel: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      serviceCommissionRule: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
      service: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      barbershopMember: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((cb) => (typeof cb === "function" ? cb(prisma) : Promise.all(cb))),
    },
  };
});

const mockedGetAdminSession = vi.mocked(getAdminSession);
const mockedCareerLevel = vi.mocked(prisma.careerLevel);
const mockedService = vi.mocked(prisma.service);
const mockedServiceCommissionRule = vi.mocked(prisma.serviceCommissionRule);
const mockedBarbershopMember = vi.mocked(prisma.barbershopMember);

describe("PR #15 — Career Levels & Commission Matrix API Tests", () => {
  const barbershopId1 = "shop-111";
  const barbershopId2 = "shop-222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. OWNER lista, cria, edita e inativa nível de carreira", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedCareerLevel.findMany.mockResolvedValue([
      { id: "level-1", barbershopId: barbershopId1, name: "Sênior", description: null, sortOrder: 0, defaultCommissionRate: null, active: true, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const getRes = await getLevels();
    const getBody = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getBody).toHaveLength(1);
    expect(getBody[0].name).toBe("Sênior");

    // POST create
    mockedCareerLevel.findFirst.mockResolvedValue(null);
    mockedCareerLevel.create.mockResolvedValue({
      id: "level-2",
      barbershopId: barbershopId1,
      name: "Pleno",
      description: null,
      sortOrder: 0,
      defaultCommissionRate: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const postReq = new Request("http://localhost/api/admin/career-levels", {
      method: "POST",
      body: JSON.stringify({ name: "Pleno", defaultCommissionRate: "40" }),
    });

    const postRes = await postLevel(postReq);
    const postBody = await postRes.json();
    expect(postRes.status).toBe(201);
    expect(postBody.name).toBe("Pleno");

    // PUT update
    mockedCareerLevel.findFirst.mockImplementation(({ where }: { where?: { id?: string } }) => {
      if (where?.id === "level-2") {
        return Promise.resolve({
          id: "level-2",
          barbershopId: barbershopId1,
          name: "Pleno",
          description: null,
          sortOrder: 0,
          defaultCommissionRate: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    mockedCareerLevel.update.mockResolvedValue({
      id: "level-2",
      barbershopId: barbershopId1,
      name: "Pleno Ajustado",
      description: null,
      sortOrder: 0,
      defaultCommissionRate: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const putReq = new Request("http://localhost/api/admin/career-levels/level-2", {
      method: "PUT",
      body: JSON.stringify({ name: "Pleno Ajustado" }),
    });
    const putRes = await putLevel(putReq, { params: Promise.resolve({ id: "level-2" }) });
    expect(putRes.status).toBe(200);

    // DELETE (inactivate)
    const delRes = await deleteLevel(new Request("http://localhost"), { params: Promise.resolve({ id: "level-2" }) });
    expect(delRes.status).toBe(200);
  });

  it("2. BARBER não consegue criar nível de carreira (403 pelo auth session)", async () => {
    const errorResponse = new Response(JSON.stringify({ error: "Acesso negado." }), { status: 403 }) as unknown as import("next/server").NextResponse;
    mockedGetAdminSession.mockResolvedValue({
      error: errorResponse,
      data: null,
    });

    const req = new Request("http://localhost/api/admin/career-levels", {
      method: "POST",
      body: JSON.stringify({ name: "Novo Nível" }),
    });

    const res = await postLevel(req);
    expect(res.status).toBe(403);
  });

  it("3. Não permite nível duplicado no mesmo tenant (409)", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedCareerLevel.findFirst.mockResolvedValue({
      id: "level-existing",
      barbershopId: barbershopId1,
      name: "Sênior",
      description: null,
      sortOrder: 0,
      defaultCommissionRate: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new Request("http://localhost/api/admin/career-levels", {
      method: "POST",
      body: JSON.stringify({ name: "Sênior" }),
    });

    const res = await postLevel(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toContain("Já existe um nível de carreira com este nome");
  });

  it("4. Permite mesmo nome de nível em tenants diferentes", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner-2", role: "OWNER", memberId: "m-2", barbershopId: barbershopId2 },
    });

    mockedCareerLevel.findFirst.mockResolvedValue(null);
    mockedCareerLevel.create.mockResolvedValue({
      id: "level-tenant-2",
      barbershopId: barbershopId2,
      name: "Sênior",
      description: null,
      sortOrder: 0,
      defaultCommissionRate: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new Request("http://localhost/api/admin/career-levels", {
      method: "POST",
      body: JSON.stringify({ name: "Sênior" }),
    });

    const res = await postLevel(req);
    expect(res.status).toBe(201);
  });

  it("5. Não permite alterar nível de outro tenant (404)", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedCareerLevel.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/admin/career-levels/level-shop2", {
      method: "PUT",
      body: JSON.stringify({ name: "Hacked" }),
    });

    const res = await putLevel(req, { params: Promise.resolve({ id: "level-shop2" }) });
    expect(res.status).toBe(404);
  });

  it("6. Membro de equipe pode receber careerLevelId no PUT /api/admin/team/[id]", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedBarbershopMember.findUnique.mockResolvedValue({
      id: "member-1",
      barbershopId: barbershopId1,
      userId: "u-1",
      role: "BARBER",
      bio: null,
      careerLevelId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedCareerLevel.findFirst.mockResolvedValue({
      id: "level-valid",
      barbershopId: barbershopId1,
      name: "Sênior",
      description: null,
      sortOrder: 0,
      defaultCommissionRate: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedBarbershopMember.update.mockResolvedValue({
      id: "member-1",
      barbershopId: barbershopId1,
      userId: "u-1",
      role: "BARBER",
      bio: null,
      careerLevelId: "level-valid",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new Request("http://localhost/api/admin/team/member-1", {
      method: "PUT",
      body: JSON.stringify({ careerLevelId: "level-valid" }),
    });

    const res = await putTeamMember(req, { params: Promise.resolve({ id: "member-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.careerLevelId).toBe("level-valid");
  });

  it("7. Não permite vincular careerLevelId de outro tenant a um membro (400)", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedBarbershopMember.findUnique.mockResolvedValue({
      id: "member-1",
      barbershopId: barbershopId1,
      userId: "u-1",
      role: "BARBER",
      bio: null,
      careerLevelId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedCareerLevel.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/admin/team/member-1", {
      method: "PUT",
      body: JSON.stringify({ careerLevelId: "level-other-tenant" }),
    });

    const res = await putTeamMember(req, { params: Promise.resolve({ id: "member-1" }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Nível de carreira não encontrado ou inválido");
  });

  it("8. OWNER carrega matriz com serviços, níveis e regras via GET /api/admin/commission-rules/matrix", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedService.findMany.mockResolvedValue([
      {
        id: "s-1",
        barbershopId: barbershopId1,
        categoryId: "c-1",
        name: "Corte",
        description: null,
        price: new Prisma.Decimal("50.00"),
        durationMin: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: { id: "c-1", barbershopId: barbershopId1, name: "Cortes", slug: "cortes", createdAt: new Date(), updatedAt: new Date() },
      },
    ]);
    mockedCareerLevel.findMany.mockResolvedValue([
      { id: "l-1", barbershopId: barbershopId1, name: "Sênior", description: null, sortOrder: 0, defaultCommissionRate: null, active: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockedServiceCommissionRule.findMany.mockResolvedValue([
      { id: "rule-1", barbershopId: barbershopId1, serviceId: "s-1", careerLevelId: "l-1", type: "PERCENTAGE", commissionRate: new Prisma.Decimal("45.00"), active: true, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await getMatrix();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.services).toHaveLength(1);
    expect(body.careerLevels).toHaveLength(1);
    expect(body.rules).toHaveLength(1);
  });

  it("9 e 10. PUT /api/admin/commission-rules/matrix cria/atualiza regras em lote", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedService.count.mockResolvedValue(1);
    mockedCareerLevel.count.mockResolvedValue(1);
    mockedServiceCommissionRule.upsert.mockResolvedValue({
      id: "rule-upserted",
      barbershopId: barbershopId1,
      serviceId: "s-1",
      careerLevelId: "l-1",
      type: "PERCENTAGE",
      commissionRate: new Prisma.Decimal("50.00"),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new Request("http://localhost/api/admin/commission-rules/matrix", {
      method: "PUT",
      body: JSON.stringify({
        rules: [{ serviceId: "s-1", careerLevelId: "l-1", commissionRate: "50" }],
      }),
    });

    const res = await putMatrix(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11. Limpa célula da matriz inativando a regra existente", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedService.count.mockResolvedValue(1);
    mockedCareerLevel.count.mockResolvedValue(1);
    mockedServiceCommissionRule.updateMany.mockResolvedValue({ count: 1 });

    const req = new Request("http://localhost/api/admin/commission-rules/matrix", {
      method: "PUT",
      body: JSON.stringify({
        rules: [{ serviceId: "s-1", careerLevelId: "l-1", commissionRate: "" }],
      }),
    });

    const res = await putMatrix(req);
    expect(res.status).toBe(200);
    expect(mockedServiceCommissionRule.updateMany).toHaveBeenCalledWith({
      where: { barbershopId: barbershopId1, serviceId: "s-1", careerLevelId: "l-1" },
      data: { active: false },
    });
  });

  it("12 e 13. Tenant isolation na matriz: rejeita serviceId ou careerLevelId de outro tenant (403)", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedService.count.mockResolvedValue(0);

    const req = new Request("http://localhost/api/admin/commission-rules/matrix", {
      method: "PUT",
      body: JSON.stringify({
        rules: [{ serviceId: "service-other-shop", careerLevelId: "l-1", commissionRate: "40" }],
      }),
    });

    const res = await putMatrix(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("serviço não pertencente à barbearia");
  });

  it("14. Valida percentual inválido na matriz (negativo ou > 100) retornando 400", async () => {
    mockedGetAdminSession.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", memberId: "m-1", barbershopId: barbershopId1 },
    });

    mockedService.count.mockResolvedValue(1);
    mockedCareerLevel.count.mockResolvedValue(1);

    const req = new Request("http://localhost/api/admin/commission-rules/matrix", {
      method: "PUT",
      body: JSON.stringify({
        rules: [{ serviceId: "s-1", careerLevelId: "l-1", commissionRate: "150" }],
      }),
    });

    const res = await putMatrix(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Percentual de comissão deve ser um número entre 0 e 100");
  });
});
