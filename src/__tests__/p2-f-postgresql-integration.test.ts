/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ComandaItemStatus } from "@prisma/client";
import { addProductItem, addServiceItem, recalculateComandaTotals } from "@/lib/operations/comandas";
import {
  isMemberCommissionEligibleAt,
  upsertCommissionConfig,
} from "@/lib/operations/commissions";
import { closeComanda, refundPayment, registerPayment } from "@/lib/operations/payments";
import { checkMemberPermission } from "@/lib/permissions/engine";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  Boolean(testDatabaseUrl) &&
  /p2f_isolated_test_db|match_barber_test|localhost|127\.0\.0\.1|55499|55439/.test(testDatabaseUrl!) &&
  !/prod|production/i.test(testDatabaseUrl!);

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
      "financial_entry_allocations",
      "financial_category_system_mappings",
      "financial_categories",
      "member_commission_eligibility_events",
      "member_permission_overrides",
      "commission_adjustments",
      "commission_periods",
      "commission_entries",
      "commission_configs",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "stock_movements",
      "comanda_items",
      "products",
      "comandas",
      "idempotency_keys",
      "appointment_services",
      "appointments",
      "barber_services",
      "working_hours",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

describeIf("TEM BARBER — Gate P2-F: Validação Real no PostgreSQL Isolado", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const { Pool } = await import("pg");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@prisma/client");
    const pool = new Pool({ connectionString: testDatabaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Elegibilidade e Histórico Temporal Real
  // ─────────────────────────────────────────────────────────────
  describe("1. Elegibilidade e histórico temporal", () => {
    it("1.1 Membro legado sem eventos mantém elegibilidade histórica antes da introdução da rastreabilidade", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Hist 1", slug: "shop-hist-1", phone: "11999990001", zipCode: "01001-000", street: "Rua", number: "1", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const user = await prisma.user.create({ data: { name: "Barbeiro Legado", phone: "11999990002" } });
      const member = await prisma.barbershopMember.create({
        data: {
          barbershopId: shop.id,
          userId: user.id,
          role: "BARBER",
          isCommissionEligible: true,
          createdAt: new Date("2026-01-01T10:00:00Z"),
        },
      });

      const refDate = new Date("2026-01-15T10:00:00Z");
      const eligible = await isMemberCommissionEligibleAt(prisma as any, {
        barbershopId: shop.id,
        memberId: member.id,
        referenceDate: refDate,
      });
      expect(eligible).toBe(true);
    });

    it("1.2 OWNER legado não perde elegibilidade para serviços realizados antes de sua desativação", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Owner Antigo", slug: "shop-owner-old", phone: "11999990003", zipCode: "01001-000", street: "Rua", number: "2", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const user = await prisma.user.create({ data: { name: "Proprietário Antigo", phone: "11999990004" } });
      const owner = await prisma.barbershopMember.create({
        data: {
          barbershopId: shop.id,
          userId: user.id,
          role: "OWNER",
          isCommissionEligible: true,
          createdAt: new Date("2026-09-01T10:00:00Z"),
        },
      });

      // Proprietário prestou serviço em 05/10
      const serviceDate = new Date("2026-10-05T14:00:00Z");

      // Posteriormente, em 13/10, desativou suas comissões (NÃO baseline de cadastro)
      const deactivationDate = new Date("2026-10-13T10:00:00Z");
      await prisma.memberCommissionEligibilityEvent.create({
        data: {
          barbershopId: shop.id,
          memberId: owner.id,
          enabled: false,
          isRegistrationBaseline: false,
          effectiveAt: deactivationDate,
          actorUserId: user.id,
          createdAt: deactivationDate,
        },
      });

      // Serviço realizado antes da desativação (05/10) continua elegível!
      const eligibleBefore = await isMemberCommissionEligibleAt(prisma as any, {
        barbershopId: shop.id,
        memberId: owner.id,
        referenceDate: serviceDate,
      });
      expect(eligibleBefore).toBe(true);

      // Operação realizada após a desativação (14/10) não é elegível
      const eligibleAfter = await isMemberCommissionEligibleAt(prisma as any, {
        barbershopId: shop.id,
        memberId: owner.id,
        referenceDate: new Date("2026-10-14T10:00:00Z"),
      });
      expect(eligibleAfter).toBe(false);
    });

    it("1.3 Novo OWNER cadastrado com baseline começa desativado mesmo para datas anteriores", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Owner Novo", slug: "shop-owner-new", phone: "11999990005", zipCode: "01001-000", street: "Rua", number: "3", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const user = await prisma.user.create({ data: { name: "Proprietário Novo", phone: "11999990006" } });
      const newOwner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: user.id, role: "OWNER", isCommissionEligible: false },
      });

      const regDate = new Date("2026-10-13T12:00:00Z");
      await prisma.memberCommissionEligibilityEvent.create({
        data: {
          barbershopId: shop.id,
          memberId: newOwner.id,
          enabled: false,
          isRegistrationBaseline: true, // Baseline de cadastro
          effectiveAt: regDate,
          actorUserId: user.id,
          createdAt: regDate,
        },
      });

      // Data anterior ao cadastro: não é elegível (não é profissional prévio)
      const eligiblePast = await isMemberCommissionEligibleAt(prisma as any, {
        barbershopId: shop.id,
        memberId: newOwner.id,
        referenceDate: new Date("2026-10-10T09:00:00Z"),
      });
      expect(eligiblePast).toBe(false);
    });

    it("1.4 Ativação e desativação geram eventos e preservam idempotência", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Eventos", slug: "shop-events", phone: "11999990007", zipCode: "01001-000", street: "Rua", number: "4", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const user = await prisma.user.create({ data: { name: "Barbeiro Eventos", phone: "11999990008" } });
      const member = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: user.id, role: "BARBER", isCommissionEligible: true },
      });

      // Desativar
      const t1 = new Date("2026-10-10T10:00:00Z");
      const ev1 = await prisma.memberCommissionEligibilityEvent.create({
        data: { barbershopId: shop.id, memberId: member.id, enabled: false, effectiveAt: t1, actorUserId: user.id, createdAt: t1 },
      });
      expect(ev1.enabled).toBe(false);

      // Reativar
      const t2 = new Date("2026-10-20T10:00:00Z");
      const ev2 = await prisma.memberCommissionEligibilityEvent.create({
        data: { barbershopId: shop.id, memberId: member.id, enabled: true, effectiveAt: t2, actorUserId: user.id, createdAt: t2 },
      });
      expect(ev2.enabled).toBe(true);

      const totalEvents = await prisma.memberCommissionEligibilityEvent.count({ where: { memberId: member.id } });
      expect(totalEvents).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Atomicidade e Rollback Transacional Real
  // ─────────────────────────────────────────────────────────────
  describe("2. Atomicidade e Rollback Transacional Real", () => {
    it("2.1 Rollback real em falha intermediária garante nenhuma mutação persistida", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Tx Rollback", slug: "shop-tx-rb", phone: "11999990010", zipCode: "01001-000", street: "Rua", number: "5", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const cat = await prisma.category.create({
        data: { barbershopId: shop.id, name: "Geral", slug: "geral-tx" },
      });
      const user = await prisma.user.create({ data: { name: "Barbeiro Tx", phone: "11999990011" } });
      const member = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: user.id, role: "BARBER", isCommissionEligible: true },
      });
      const srv = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte Tx", price: 50, durationMin: 30 },
      });

      // Tentativa de transação que vincula serviço e tenta gravar registro inválido provocando erro
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.barberService.create({
            data: { barberId: member.id, serviceId: srv.id },
          });
          await tx.barbershopMember.update({
            where: { id: member.id },
            data: { isCommissionEligible: false },
          });
          // Forçar erro explícito após operações intermediárias
          throw new Error("SIMULATED_TRANSACTION_FAILURE");
        })
      ).rejects.toThrow("SIMULATED_TRANSACTION_FAILURE");

      // Assegurar que nenhuma alteração persistiu no banco de dados real
      const barberServicesCount = await prisma.barberService.count({ where: { barberId: member.id } });
      expect(barberServicesCount).toBe(0);

      const reloadedMember = await prisma.barbershopMember.findUnique({ where: { id: member.id } });
      expect(reloadedMember?.isCommissionEligible).toBe(true);
    });

    it("2.2 Isolamento estrito entre barbearias distintas no banco de dados", async () => {
      const shopA = await prisma.barbershop.create({
        data: { name: "Shop Tenant A", slug: "shop-tenant-a", phone: "11999990021", zipCode: "01001-000", street: "Rua", number: "6", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const shopB = await prisma.barbershop.create({
        data: { name: "Shop Tenant B", slug: "shop-tenant-b", phone: "11999990022", zipCode: "01001-000", street: "Rua", number: "7", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const userA = await prisma.user.create({ data: { name: "Barbeiro A", phone: "11999990023" } });
      const memberA = await prisma.barbershopMember.create({
        data: { barbershopId: shopA.id, userId: userA.id, role: "BARBER", isCommissionEligible: true },
      });

      // Tentar consultar memberA com tenantId de shopB
      const eligibleCrossTenant = await isMemberCommissionEligibleAt(prisma as any, {
        barbershopId: shopB.id,
        memberId: memberA.id,
        referenceDate: new Date(),
      });
      expect(eligibleCrossTenant).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Comissões e Pagamentos com Ciclo Financeiro Real
  // ─────────────────────────────────────────────────────────────
  describe("3. Comissões e pagamentos reais", () => {
    it("3.1 Serviço e produto com vendedores distintos geram comissões corretas nos respectivos executores", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Ciclo Real", slug: "shop-real-cycle", phone: "11999990031", zipCode: "01001-000", street: "Rua", number: "8", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Cycle", phone: "11999990032" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barbeiro Corte", phone: "11999990033" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });
      const uSeller = await prisma.user.create({ data: { name: "Vendedor Produto", phone: "11999990034" } });
      const seller = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uSeller.id, role: "BARBER", isCommissionEligible: true },
      });

      // Inicializar plano financeiro padrão para as alocações de receita de comanda
      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({
        data: { barbershopId: shop.id, name: "Geral", slug: "geral-31" },
      });

      // Configurar comissão do barbeiro (50% no corte)
      const service = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte Moderno", price: 100, durationMin: 30 },
      });
      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: service.id,
          type: "PERCENTAGE",
          value: 50,
        });
      });

      // Configurar comissão do produto (20% para o vendedor)
      const product = await prisma.product.create({
        data: { barbershopId: shop.id, name: "Pomada Forte", salePrice: 50, costPrice: 20 },
      });
      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: seller.id,
          productId: product.id,
          type: "PERCENTAGE",
          value: 20,
        });
      });

      // Criar comanda
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId: shop.id,
          customerName: "Cliente Teste",
          total: 0,
        },
      });

      // Adicionar serviço pelo barbeiro
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: service.id,
          executorId: barber.id,
        });
      });

      // Marcar serviço como DONE
      const sItem = await prisma.comandaItem.findFirstOrThrow({
        where: { comandaId: comanda.id, serviceId: service.id },
      });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });

      // Adicionar produto com executorId sendo o vendedor
      await prisma.$transaction(async (tx) => {
        await addProductItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          productId: product.id,
          executorId: seller.id,
        });
      });

      const pItem = await prisma.comandaItem.findFirstOrThrow({
        where: { comandaId: comanda.id, productId: product.id },
      });
      await prisma.comandaItem.update({
        where: { id: pItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });

      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      // Pagamento total e fechamento
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "CREDIT",
          amount: 150,
          userId: uOwner.id,
        });
        await closeComanda(tx, shop.id, comanda.id);
      });

      // Verificar entradas de comissão
      const entries = await prisma.commissionEntry.findMany({
        where: { barbershopId: shop.id },
      });

      expect(entries.length).toBe(2);

      const barberEntry = entries.find((e) => e.memberId === barber.id);
      expect(barberEntry).toBeDefined();
      expect(Number(barberEntry?.generatedAmount)).toBe(50); // 50% de 100
      expect(barberEntry?.comandaItemId).toBe(sItem.id);

      const sellerEntry = entries.find((e) => e.memberId === seller.id);
      expect(sellerEntry).toBeDefined();
      expect(Number(sellerEntry?.generatedAmount)).toBe(10); // 20% de 50
      expect(sellerEntry?.comandaItemId).toBe(pItem.id);
    });

    it("3.2 Pagamentos parciais, idempotência e cancelamento com estorno correto", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Idemp", slug: "shop-idemp", phone: "11999990041", zipCode: "01001-000", street: "Rua", number: "9", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Idemp", phone: "11999990042" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barber Idemp", phone: "11999990043" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });

      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({
        data: { barbershopId: shop.id, name: "Geral", slug: "geral-32" },
      });

      const service = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Barba", price: 60, durationMin: 30 },
      });
      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: service.id,
          type: "PERCENTAGE",
          value: 50,
        });
      });

      const comanda = await prisma.comanda.create({
        data: { barbershopId: shop.id, customerName: "Cliente Idemp", total: 0 },
      });
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: service.id,
          executorId: barber.id,
        });
      });

      const sItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: comanda.id } });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      // Pagamento parcial 1 (R$ 30 via PIX)
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 30,
          userId: uOwner.id,
        });
      });

      let entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.releasedAmount)).toBe(15); // 50% de 30

      // Pagamento parcial 2 (completa os 60) com idempotencyKey
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 30,
          userId: uOwner.id,
          idempotencyKey: "pay-part-2",
        });
      });

      entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.releasedAmount)).toBe(30);

      // Reenvio idêntico do pagamento parcial 2 com mesma idempotencyKey (idempotência)
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 30,
          userId: uOwner.id,
          idempotencyKey: "pay-part-2",
        });
      });

      entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.releasedAmount)).toBe(30); // não duplicou

      // Fechamento da comanda
      await prisma.$transaction(async (tx) => {
        await closeComanda(tx, shop.id, comanda.id);
      });

      // Estorno do segundo pagamento
      const payment2 = await prisma.payment.findFirstOrThrow({
        where: { comandaId: comanda.id, idempotencyKey: "pay-part-2" },
      });

      await prisma.$transaction(async (tx) => {
        await refundPayment(tx, {
          barbershopId: shop.id,
          paymentId: payment2.id,
          amount: 30,
          reason: "Estorno parcial solicitado",
          userId: uOwner.id,
        });
      });

      entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.reversedAmount)).toBe(15);
      expect(Number(entry.releasedAmount)).toBe(15);
    });

    it("3.3 Comissão de 0% é tratada como regra válida sem gerar valor indevido", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Zero", slug: "shop-zero", phone: "11999990051", zipCode: "01001-000", street: "Rua", number: "10", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Zero", phone: "11999990052" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barber Zero", phone: "11999990053" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });

      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({
        data: { barbershopId: shop.id, name: "Geral", slug: "geral-33" },
      });

      const service = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Acabamento 0%", price: 20, durationMin: 15 },
      });
      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: service.id,
          type: "PERCENTAGE",
          value: 0, // 0%
        });
      });

      const comanda = await prisma.comanda.create({
        data: { barbershopId: shop.id, customerName: "Cliente Zero", total: 0 },
      });
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: service.id,
          executorId: barber.id,
        });
      });

      const sItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: comanda.id } });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 20,
          userId: uOwner.id,
        });
        await closeComanda(tx, shop.id, comanda.id);
      });

      const entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.generatedAmount)).toBe(0);
      expect(Number(entry.releasedAmount)).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Permissões Reais no PostgreSQL
  // ─────────────────────────────────────────────────────────────
  describe("4. Permissões e Segurança de Dados Reais", () => {
    it("4.1 checkMemberPermission avalia overrides persistidos no PostgreSQL real", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Perms", slug: "shop-perms", phone: "11999990061", zipCode: "01001-000", street: "Rua", number: "11", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uManager = await prisma.user.create({ data: { name: "Manager Perms", phone: "11999990062" } });
      const manager = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uManager.id, role: "MANAGER", isCommissionEligible: true },
      });

      // Sem override: COMMISSIONS_MANAGE padrão do MANAGER é false
      const canManageCommissionsDefault = await checkMemberPermission(manager.id, "MANAGER", "COMMISSIONS_MANAGE", prisma as any);
      expect(canManageCommissionsDefault).toBe(false);

      // Gravar override concedendo COMMISSIONS_MANAGE
      await prisma.memberPermissionOverride.create({
        data: {
          barbershopId: shop.id,
          memberId: manager.id,
          permissionKey: "COMMISSIONS_MANAGE",
          allowed: true,
        },
      });

      const canManageCommissionsGranted = await checkMemberPermission(manager.id, "MANAGER", "COMMISSIONS_MANAGE", prisma as any);
      expect(canManageCommissionsGranted).toBe(true);

      // SERVICES_MANAGE padrão do MANAGER é true, mas se for revogado explicitamente via override:
      await prisma.memberPermissionOverride.create({
        data: {
          barbershopId: shop.id,
          memberId: manager.id,
          permissionKey: "SERVICES_MANAGE",
          allowed: false,
        },
      });
      const canManageServicesRevoked = await checkMemberPermission(manager.id, "MANAGER", "SERVICES_MANAGE", prisma as any);
      expect(canManageServicesRevoked).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Lacunas de Integração em PostgreSQL Real (Gate P2-F-RECOVERY)
  // ─────────────────────────────────────────────────────────────
  describe("5. Lacunas de Integração em PostgreSQL Real", () => {
    it("5.1 Atomicidade do PUT commission-settings desfaz todas as alterações em falha intermediária", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop PUT Rollback", slug: "shop-put-rb", phone: "11999990071", zipCode: "01001-000", street: "Rua", number: "12", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const cat = await prisma.category.create({ data: { barbershopId: shop.id, name: "Geral", slug: "geral-put-rb" } });
      const uBarber = await prisma.user.create({ data: { name: "Barber Put Rollback", phone: "11999990072" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });
      const srv1 = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte RB 1", price: 50, durationMin: 30 },
      });
      const srv2 = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte RB 2", price: 60, durationMin: 30 },
      });

      // Simular a transação do endpoint PUT /api/admin/team/[id]/commission-settings com erro no meio
      await expect(
        prisma.$transaction(async (tx) => {
          // Atualiza BarberService
          await tx.barberService.createMany({
            data: [{ barberId: barber.id, serviceId: srv1.id }],
          });
          // Cria regra
          await upsertCommissionConfig(tx, {
            barbershopId: shop.id,
            memberId: barber.id,
            serviceId: srv1.id,
            type: "PERCENTAGE",
            value: 40,
          });
          // Falha simulada durante a transação
          throw new Error("COMMISSION_SETTINGS_TRANSACTION_FAILURE");
        })
      ).rejects.toThrow("COMMISSION_SETTINGS_TRANSACTION_FAILURE");

      // Verificar que nada foi gravado
      const servicesCount = await prisma.barberService.count({ where: { barberId: barber.id } });
      expect(servicesCount).toBe(0);

      const configsCount = await prisma.commissionConfig.count({ where: { memberId: barber.id } });
      expect(configsCount).toBe(0);
    });

    it("5.2 Pagamento CASH com caixa aberto registra movimentação e comissão corretamente", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Cash Real", slug: "shop-cash-real", phone: "11999990073", zipCode: "01001-000", street: "Rua", number: "13", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Cash", phone: "11999990074" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barber Cash", phone: "11999990075" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });

      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({ data: { barbershopId: shop.id, name: "Geral", slug: "geral-cash" } });
      const srv = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte Cash", price: 80, durationMin: 30 },
      });

      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: srv.id,
          type: "PERCENTAGE",
          value: 50,
        });
      });

      // Abrir sessão de caixa
      const cashSession = await prisma.cashSession.create({
        data: {
          barbershopId: shop.id,
          openedById: uOwner.id,
          openingAmount: 100,
          expectedAmount: 100,
          status: "OPEN",
          openedAt: new Date(),
        },
      });

      const comanda = await prisma.comanda.create({
        data: { barbershopId: shop.id, customerName: "Cliente Cash", total: 0 },
      });
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: srv.id,
          executorId: barber.id,
        });
      });

      const sItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: comanda.id } });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      // Pagar em CASH com caixa aberto
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "CASH",
          amount: 80,
          userId: uOwner.id,
        });
        await closeComanda(tx, shop.id, comanda.id);
      });

      // Verificar que a comissão foi liberada
      const entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.generatedAmount)).toBe(40);
      expect(Number(entry.releasedAmount)).toBe(40);

      // Verificar que gerou movimento de caixa
      const movement = await prisma.cashMovement.findFirst({
        where: { cashSessionId: cashSession.id },
      });
      expect(movement).toBeDefined();
      expect(Number(movement?.amount)).toBe(80);
    });

    it("5.3 Cancelamento real de comanda reverte todas as comissões geradas", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Cancel", slug: "shop-cancel", phone: "11999990076", zipCode: "01001-000", street: "Rua", number: "14", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Cancel", phone: "11999990077" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barber Cancel", phone: "11999990078" } });
      const barber = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uBarber.id, role: "BARBER", isCommissionEligible: true },
      });

      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({ data: { barbershopId: shop.id, name: "Geral", slug: "geral-cancel" } });
      const srv = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte Cancel", price: 100, durationMin: 30 },
      });

      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: srv.id,
          type: "PERCENTAGE",
          value: 50,
        });
      });

      const comanda = await prisma.comanda.create({
        data: { barbershopId: shop.id, customerName: "Cliente Cancel", total: 0 },
      });
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: srv.id,
          executorId: barber.id,
        });
      });

      const sItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: comanda.id } });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 100,
          userId: uOwner.id,
        });
        await closeComanda(tx, shop.id, comanda.id);
      });

      // Cancelar a comanda com refundAll
      const { cancelComanda } = await import("@/lib/operations/comandas");
      await prisma.$transaction(async (tx) => {
        await cancelComanda(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          reason: "Cliente insatisfeito e pediu cancelamento",
          userId: uOwner.id,
          refundAll: true,
        });
      });

      // Comissão deve ter sido completamente revertida
      const entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.reversedAmount)).toBe(50);
      expect(Number(entry.releasedAmount)).toBe(0);
    });

    it("5.4 Comissão gerada antes da desativação do profissional é preservada em pagamento posterior", async () => {
      const shop = await prisma.barbershop.create({
        data: { name: "Shop Preserv", slug: "shop-preserv", phone: "11999990081", zipCode: "01001-000", street: "Rua", number: "15", neighborhood: "Bairro", city: "SP", state: "SP" },
      });
      const uOwner = await prisma.user.create({ data: { name: "Owner Preserv", phone: "11999990082" } });
      const owner = await prisma.barbershopMember.create({
        data: { barbershopId: shop.id, userId: uOwner.id, role: "OWNER", isCommissionEligible: true },
      });
      const uBarber = await prisma.user.create({ data: { name: "Barber Preserv", phone: "11999990083" } });
      const barber = await prisma.barbershopMember.create({
        data: {
          barbershopId: shop.id,
          userId: uBarber.id,
          role: "BARBER",
          isCommissionEligible: true,
          createdAt: new Date("2026-09-15T10:00:00Z"),
        },
      });

      await bootstrapFinancialPlan(prisma, shop.id);

      const cat = await prisma.category.create({ data: { barbershopId: shop.id, name: "Geral", slug: "geral-preserv" } });
      const srv = await prisma.service.create({
        data: { barbershopId: shop.id, categoryId: cat.id, name: "Corte Preserv", price: 100, durationMin: 30 },
      });

      await prisma.$transaction(async (tx) => {
        await upsertCommissionConfig(tx, {
          barbershopId: shop.id,
          memberId: barber.id,
          serviceId: srv.id,
          type: "PERCENTAGE",
          value: 50,
        });
      });

      const comanda = await prisma.comanda.create({
        data: { barbershopId: shop.id, customerName: "Cliente Preserv", total: 0 },
      });

      // 1. Serviço realizado em t1 quando o barbeiro era elegível
      const t1 = new Date("2026-10-01T10:00:00Z");
      await prisma.$transaction(async (tx) => {
        await addServiceItem(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          serviceId: srv.id,
          executorId: barber.id,
        });
      });

      const sItem = await prisma.comandaItem.findFirstOrThrow({ where: { comandaId: comanda.id } });
      await prisma.comandaItem.update({
        where: { id: sItem.id },
        data: { status: ComandaItemStatus.DONE, completedAt: t1 },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

      // 2. Posteriormente, em t2, desativa a elegibilidade do barbeiro
      const t2 = new Date("2026-10-05T10:00:00Z");
      await prisma.memberCommissionEligibilityEvent.create({
        data: {
          barbershopId: shop.id,
          memberId: barber.id,
          enabled: false,
          effectiveAt: t2,
          actorUserId: uOwner.id,
          createdAt: t2,
        },
      });
      await prisma.barbershopMember.update({
        where: { id: barber.id },
        data: { isCommissionEligible: false },
      });

      // 3. Pagamento e fechamento ocorrem em t3 (após a desativação cadastral)
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shop.id,
          comandaId: comanda.id,
          method: "PIX",
          amount: 100,
          userId: uOwner.id,
        });
        await closeComanda(tx, shop.id, comanda.id);
      });

      // A comissão do serviço de t1 DEVE ser reconhecida e liberada porque completedAt (t1) era elegível!
      const entry = await prisma.commissionEntry.findFirstOrThrow({ where: { barbershopId: shop.id } });
      expect(Number(entry.generatedAmount)).toBe(50);
      expect(Number(entry.releasedAmount)).toBe(50);
    });
  });
});
