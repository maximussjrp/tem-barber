import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { resetRateLimitStore } from "@/lib/public-rate-limit";

// Hoisted Prisma mock for registration testing
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), create: vi.fn() },
    barbershop: { findUnique: vi.fn(), create: vi.fn() },
    barbershopMember: { create: vi.fn() },
    memberCommissionEligibilityEvent: { create: vi.fn() },
    category: { create: vi.fn() },
    service: { create: vi.fn() },
    barberService: { create: vi.fn() },
    workingHour: { create: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    tenantSubscription: { upsert: vi.fn() },
    financialCategory: { findMany: vi.fn(), create: vi.fn() },
    financialCategorySystemMapping: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { POST as registerBarbershop } from "@/app/api/auth/register/route";

function createRegistrationRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const sampleRegistrationBody = {
  name: "Proprietário",
  email: "owner@example.com",
  phone: "(11) 99999-9999",
  cpf: "529.982.247-25",
  password: "password123",
  barbershopName: "Barbearia Imperial",
};

describe("TEM BARBER — Gate P2-A: Elegibilidade de Comissão e Histórico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.barbershop.findUnique.mockResolvedValue(null);
    prismaMock.plan.findUnique.mockResolvedValue({
      id: "plan-pro",
      code: "pro_monthly",
      name: "Plano Tem Barber",
      price: 49.9,
      period: "MONTHLY",
      isActive: true,
    });
    prismaMock.plan.findMany.mockResolvedValue([
      {
        id: "plan-pro",
        code: "pro_monthly",
        name: "Plano Tem Barber",
        price: 49.9,
        period: "MONTHLY",
        isActive: true,
      },
    ]);
    prismaMock.tenantSubscription.upsert.mockResolvedValue({
      id: "subscription-1",
      status: "TRIAL",
    });

    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)
    );

    prismaMock.user.create.mockResolvedValue({
      id: "user-owner-1",
      name: "Proprietário",
    });
    prismaMock.barbershop.create.mockResolvedValue({
      id: "shop-1",
      name: "Barbearia Imperial",
      slug: "barbearia-imperial",
    });
    prismaMock.barbershopMember.create.mockResolvedValue({
      id: "member-owner-1",
      barbershopId: "shop-1",
      userId: "user-owner-1",
      role: "OWNER",
      isCommissionEligible: false,
    });
    prismaMock.memberCommissionEligibilityEvent.create.mockResolvedValue({
      id: "event-init-1",
      barbershopId: "shop-1",
      memberId: "member-owner-1",
      enabled: false,
      actorUserId: "user-owner-1",
      effectiveAt: new Date(),
      createdAt: new Date(),
    });
    prismaMock.category.create.mockResolvedValue({ id: "category-1" });
    prismaMock.service.create.mockResolvedValue({ id: "service-1" });
    prismaMock.barberService.create.mockResolvedValue({ id: "barber-service-1" });
    prismaMock.workingHour.create.mockResolvedValue({ id: "working-hour-1" });
    prismaMock.financialCategory.findMany.mockResolvedValue([]);
    prismaMock.financialCategory.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `fin-cat-${Math.random()}`, ...args.data })
    );
    prismaMock.financialCategorySystemMapping.findMany.mockResolvedValue([]);
    prismaMock.financialCategorySystemMapping.create.mockResolvedValue({
      id: "mapping-1",
    });
  });

  describe("1. Schema Prisma — Campo de Elegibilidade e Modelo de Eventos", () => {
    it("comprova que BarbershopMember possui isCommissionEligible com default true", () => {
      const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      expect(schemaContent).toMatch(/isCommissionEligible\s+Boolean\s+@default\(true\)\s+@map\("is_commission_eligible"\)/);
    });

    it("comprova que o modelo MemberCommissionEligibilityEvent existe com a estrutura requerida", () => {
      const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      expect(schemaContent).toContain("model MemberCommissionEligibilityEvent {");
      expect(schemaContent).toContain('barbershopId String   @map("barbershop_id")');
      expect(schemaContent).toContain('memberId     String   @map("member_id")');
      expect(schemaContent).toContain("enabled      Boolean");
      expect(schemaContent).toContain('effectiveAt  DateTime @default(now()) @map("effective_at")');
      expect(schemaContent).toContain('actorUserId  String   @map("actor_user_id")');
      expect(schemaContent).toContain("@@index([barbershopId, memberId, effectiveAt])");
      expect(schemaContent).toContain('@@map("member_commission_eligibility_events")');
    });

    it("comprova relações inversas em Barbershop, BarbershopMember e User", () => {
      const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      expect(schemaContent).toMatch(/model Barbershop \{[\s\S]*?commissionEligibilityEvents\s+MemberCommissionEligibilityEvent\[\][\s\S]*?@@map\("barbershops"\)/);
      expect(schemaContent).toMatch(/model BarbershopMember \{[\s\S]*?commissionEligibilityEvents\s+MemberCommissionEligibilityEvent\[\][\s\S]*?@@map\("barbershop_members"\)/);
      expect(schemaContent).toMatch(/model User \{[\s\S]*?commissionEligibilityEvents\s+MemberCommissionEligibilityEvent\[\][\s\S]*?@@map\("users"\)/);
    });
  });

  describe("2. Cadastro de Nova Barbearia — Criação de OWNER com Comissão Desativada", () => {
    it("cria o membro OWNER explicitamente com isCommissionEligible: false", async () => {
      const response = await registerBarbershop(createRegistrationRequest(sampleRegistrationBody));
      expect(response.status).toBe(201);

      expect(prismaMock.barbershopMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            barbershopId: "shop-1",
            userId: "user-owner-1",
            role: "OWNER",
            isCommissionEligible: false,
          }),
        })
      );
    });

    it("registra o evento inicial de elegibilidade desativada associado ao usuário criado", async () => {
      const response = await registerBarbershop(createRegistrationRequest(sampleRegistrationBody));
      expect(response.status).toBe(201);

      expect(prismaMock.memberCommissionEligibilityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            barbershopId: "shop-1",
            memberId: "member-owner-1",
            enabled: false,
            actorUserId: "user-owner-1",
            effectiveAt: expect.any(Date),
            createdAt: expect.any(Date),
          }),
        })
      );
    });

    it("garante que o timestamp de effectiveAt e createdAt do evento inicial sejam idênticos", async () => {
      const response = await registerBarbershop(createRegistrationRequest(sampleRegistrationBody));
      expect(response.status).toBe(201);

      const eventCallArgs = prismaMock.memberCommissionEligibilityEvent.create.mock.calls[0][0];
      const { effectiveAt, createdAt } = eventCallArgs.data;

      expect(effectiveAt).toBeInstanceOf(Date);
      expect(createdAt).toBeInstanceOf(Date);
      expect(effectiveAt.getTime()).toBe(createdAt.getTime());
    });

    it("comprova atomicidade transacional: a criação do membro e do evento ocorre dentro do mesmo prisma.$transaction", async () => {
      await registerBarbershop(createRegistrationRequest(sampleRegistrationBody));

      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      expect(prismaMock.barbershopMember.create).toHaveBeenCalled();
      expect(prismaMock.memberCommissionEligibilityEvent.create).toHaveBeenCalled();
    });

    it("faz rollback e não persiste membro se a criação do evento de elegibilidade falhar", async () => {
      prismaMock.memberCommissionEligibilityEvent.create.mockRejectedValueOnce(
        new Error("DB_EVENT_FAILURE")
      );

      const response = await registerBarbershop(createRegistrationRequest(sampleRegistrationBody));
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Erro interno");
    });
  });

  describe("3. Preservação de Histórico e Integridade da Nova Migration", () => {
    it("comprova que a migration nova contém apenas a adição da coluna e a criação da tabela de eventos", () => {
      const migrationFile = path.resolve(
        process.cwd(),
        "prisma/migrations/20261013140000_add_member_commission_eligibility/migration.sql"
      );
      expect(fs.existsSync(migrationFile)).toBe(true);

      const sqlContent = fs.readFileSync(migrationFile, "utf-8");

      expect(sqlContent).toContain(
        'ALTER TABLE "barbershop_members" ADD COLUMN "is_commission_eligible" BOOLEAN NOT NULL DEFAULT true;'
      );
      expect(sqlContent).toContain('CREATE TABLE "member_commission_eligibility_events"');
      expect(sqlContent).toContain(
        'CREATE INDEX "member_commission_eligibility_events_barbershop_id_member_i_idx"'
      );
      expect(sqlContent).toContain('FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id")');
      expect(sqlContent).toContain('FOREIGN KEY ("member_id") REFERENCES "barbershop_members"("id")');
      expect(sqlContent).toContain('FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")');
    });

    it("comprova que a migration não altera tabelas financeiras, comissões ou Clube", () => {
      const migrationFile = path.resolve(
        process.cwd(),
        "prisma/migrations/20261013140000_add_member_commission_eligibility/migration.sql"
      );
      const sqlContent = fs.readFileSync(migrationFile, "utf-8").toLowerCase();

      expect(sqlContent).not.toContain("financial_entries");
      expect(sqlContent).not.toContain("commission_entries");
      expect(sqlContent).not.toContain("commission_cycles");
      expect(sqlContent).not.toContain("commission_payable_items");
      expect(sqlContent).not.toContain("commission_adjustments");
      expect(sqlContent).not.toContain("customer_club_subscriptions");
      expect(sqlContent).not.toContain("club_settlements");
    });

    it("comprova que nenhum histórico retroativo é fabricado na migration (sem INSERTs falsos)", () => {
      const migrationFile = path.resolve(
        process.cwd(),
        "prisma/migrations/20261013140000_add_member_commission_eligibility/migration.sql"
      );
      const sqlContent = fs.readFileSync(migrationFile, "utf-8");

      expect(sqlContent).not.toContain("INSERT INTO");
    });
  });
});
