/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { Pool, PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Prisma,
  CampaignStatus,
  RecipientDispatchStatus,
  MarketingConsentSource,
  MarketingConsentStatus,
} from "@prisma/client";
import {
  prepareManualReactivationCampaign,
  revalidateAndOpenManualRecipient,
  confirmManualRecipientSend,
  skipManualRecipient,
  cancelManualCampaign,
  getActiveManualCampaign,
  buildOpenPreparationId,
  DEFAULT_CRM_CHANNEL,
  DEFAULT_CRM_PURPOSE,
} from "@/lib/clients/reactivation";
import { listBarbershopClients } from "@/lib/customers";

const { getAdminSessionMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

import prismaSingleton from "@/lib/prisma";
import { POST as marketingConsentPOST } from "@/app/api/admin/clients/[id]/marketing-consent/route";

const rawDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const isSafeTestDb =
  Boolean(rawDbUrl) &&
  /localhost|127\.0\.0\.1|5439|55439/.test(rawDbUrl) &&
  /match_barber_test/.test(rawDbUrl) &&
  !/prod|production/i.test(rawDbUrl);

describe("G21-01 & G21-02 — PostgreSQL Real Concurrency, Advisory Locks & Integration", () => {
  let poolA: Pool | null = null;
  let poolB: Pool | null = null;
  let clientA: PoolClient | null = null;
  let clientB: PoolClient | null = null;
  let prismaA: PrismaClient | null = null;
  let prismaB: PrismaClient | null = null;

  const testBarbershopId = `shop-real-${Date.now()}`;
  const testCustomerId1 = `cust-real-1-${Date.now()}`;
  const testCustomerId2 = `cust-real-2-${Date.now()}`;
  const testUserId = `user-real-${Date.now()}`;
  const testCampaignId = `camp-real-${Date.now()}`;
  const testRecipientId1 = `rec-real-1-${Date.now()}`;
  const testRecipientId2 = `rec-real-2-${Date.now()}`;
  const testCustomerPhone = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testCustomerPhone2 = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;

  beforeAll(async () => {
    // G21-01: O teste não pode retornar PASS falsamente se o banco não estiver disponível
    if (!isSafeTestDb) {
      throw new Error(
        "POSTGRES_TEST_DATABASE_NOT_CONFIGURED: Testes de integração exigem banco local isolado match_barber_test na porta 5439."
      );
    }

    try {
      // Duas pools físicas independentes com max: 1 para garantir conexões físicas distintas
      poolA = new Pool({ connectionString: rawDbUrl, max: 2, connectionTimeoutMillis: 3000 });
      poolB = new Pool({ connectionString: rawDbUrl, max: 2, connectionTimeoutMillis: 3000 });

      clientA = await poolA.connect();
      clientB = await poolB.connect();

      // Confirma que são dois processos de backend físicos distintos no PostgreSQL
      const pidResA = await clientA.query("SELECT pg_backend_pid() as pid");
      const pidResB = await clientB.query("SELECT pg_backend_pid() as pid");
      const pidA = pidResA.rows[0].pid;
      const pidB = pidResB.rows[0].pid;

      expect(pidA).not.toBe(pidB);

      prismaA = new PrismaClient({ adapter: new PrismaPg(poolA) });
      prismaB = new PrismaClient({ adapter: new PrismaPg(poolB) });
      await prismaA.$connect();
      await prismaB.$connect();

      // Seed tenant e entidades para o teste
      await prismaA.barbershop.create({
        data: {
          id: testBarbershopId,
          name: "Barbearia Teste Real Postgres",
          slug: `slug-real-${Date.now()}`,
          phone: "5517999990000",
          zipCode: "15000000",
          street: "Rua Teste",
          number: "100",
          neighborhood: "Centro",
          city: "Sao Jose do Rio Preto",
          state: "SP",
        },
      });

      const randomPhone = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;

      await prismaA.user.create({
        data: {
          id: testUserId,
          name: "Operador Teste Real",
          email: `op-real-${Date.now()}@test.local`,
          phone: randomPhone,
        },
      });

      await prismaA.user.create({
        data: {
          id: testCustomerId1,
          name: "Cliente Teste Real 1",
          email: `client-real-1-${Date.now()}@test.local`,
          phone: testCustomerPhone,
        },
      });

      await prismaA.user.create({
        data: {
          id: testCustomerId2,
          name: "Cliente Teste Real 2",
          email: `client-real-2-${Date.now()}@test.local`,
          phone: testCustomerPhone2,
        },
      });

      const prepId1 = buildOpenPreparationId(
        testRecipientId1,
        1,
        testCustomerPhone,
        "RETURN_REMINDER",
        "Mensagem de teste concorrente 1"
      );

      const prepId2 = buildOpenPreparationId(
        testRecipientId2,
        1,
        testCustomerPhone2,
        "RETURN_REMINDER",
        "Mensagem de teste concorrente 2"
      );

      await prismaA.reactivationCampaign.create({
        data: {
          id: testCampaignId,
          barbershopId: testBarbershopId,
          name: "Fila Concorrente Real",
          channel: "WHATSAPP",
          status: CampaignStatus.IN_PROGRESS,
          createdByUserId: testUserId,
          targetSegment: {
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            workRoundId: `round_${Date.now()}`,
          },
          totalRecipients: 2,
          sentCount: 0,
          recipients: {
            create: [
              {
                id: testRecipientId1,
                customerId: testCustomerId1,
                customerNameSnapshot: "Cliente Teste Real 1",
                customerPhoneSnapshot: testCustomerPhone,
                timingStateSnapshot: "NO_HISTORY",
                scoreSnapshot: 0,
                dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
                dispatchAttemptCount: 1,
                payloadSnapshot: {
                  openPreparationId: prepId1,
                  openedPhoneNormalized: testCustomerPhone,
                  templateKey: "RETURN_REMINDER",
                  openedMessageText: "Mensagem de teste concorrente 1",
                  previewMessage: "Mensagem de teste concorrente 1",
                },
              },
              {
                id: testRecipientId2,
                customerId: testCustomerId2,
                customerNameSnapshot: "Cliente Teste Real 2",
                customerPhoneSnapshot: testCustomerPhone2,
                timingStateSnapshot: "NO_HISTORY",
                scoreSnapshot: 0,
                dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
                dispatchAttemptCount: 1,
                payloadSnapshot: {
                  openPreparationId: prepId2,
                  openedPhoneNormalized: testCustomerPhone2,
                  templateKey: "RETURN_REMINDER",
                  openedMessageText: "Mensagem de teste concorrente 2",
                  previewMessage: "Mensagem de teste concorrente 2",
                },
              },
            ],
          },
        },
      });
    } catch (err: any) {
      throw new Error(`POSTGRES_SETUP_FAILED: ${err.message}`);
    }
  });

  afterAll(async () => {
    try {
      if (prismaA) {
        await prismaA.customerContactLog.deleteMany({
          where: { barbershopId: testBarbershopId },
        });
        await prismaA.reactivationCampaignRecipient.deleteMany({
          where: { barbershopId: testBarbershopId },
        });
        await prismaA.reactivationCampaign.deleteMany({
          where: { barbershopId: testBarbershopId },
        });
        await prismaA.user.deleteMany({
          where: { id: { in: [testCustomerId1, testCustomerId2, testUserId] } },
        });
        await prismaA.barbershop.deleteMany({
          where: { id: testBarbershopId },
        });
      }
    } catch {
      // Ignora erro de limpeza após testes
    } finally {
      if (clientA) clientA.release();
      if (clientB) clientB.release();
      if (prismaA) await prismaA.$disconnect();
      if (prismaB) await prismaB.$disconnect();
      await prismaSingleton.$disconnect();
      if (poolA) await poolA.end();
      if (poolB) await poolB.end();
    }
  });

  it("G21-01: Prova a serialização física de pg_try_advisory_xact_lock entre duas conexões PostgreSQL independentes", async () => {
    if (!clientA || !clientB) {
      throw new Error("Conexões físicas com PostgreSQL não inicializadas.");
    }

    // Conexão A abre transação e adquire advisory lock
    await clientA.query("BEGIN");
    const lockResA = await clientA.query(
      `SELECT pg_try_advisory_xact_lock(hashtext('crm_dispatch:' || $1 || ':' || $2)) as acquired`,
      [testBarbershopId, testRecipientId1]
    );
    expect(lockResA.rows[0].acquired).toBe(true);

    // Conexão B tenta adquirir o mesmo advisory lock dentro de sua transação independente
    await clientB.query("BEGIN");
    const lockResB = await clientB.query(
      `SELECT pg_try_advisory_xact_lock(hashtext('crm_dispatch:' || $1 || ':' || $2)) as acquired`,
      [testBarbershopId, testRecipientId1]
    );
    // Deve retornar false porque Conexão A retém o lock exclusivo!
    expect(lockResB.rows[0].acquired).toBe(false);

    // Conexão A comita e libera o lock
    await clientA.query("COMMIT");

    // Agora Conexão B consegue adquirir o lock
    const lockResBRetry = await clientB.query(
      `SELECT pg_try_advisory_xact_lock(hashtext('crm_dispatch:' || $1 || ':' || $2)) as acquired`,
      [testBarbershopId, testRecipientId1]
    );
    expect(lockResBRetry.rows[0].acquired).toBe(true);
    await clientB.query("COMMIT");
  });

  it("G21-01: Concorrência de dispatch: duas conexões confirmando simultaneamente resultam em sentCount=1 e exatamente 1 contactLog", async () => {
    if (!prismaA || !prismaB) {
      throw new Error("Instâncias Prisma não inicializadas.");
    }

    const prepId = buildOpenPreparationId(
      testRecipientId1,
      1,
      testCustomerPhone,
      "RETURN_REMINDER",
      "Mensagem de teste concorrente 1"
    );

    // Executa confirmação concorrente em transações separadas
    const [resA, resB] = await Promise.all([
      prismaA.$transaction(async (tx) => {
        return confirmManualRecipientSend(tx, {
          barbershopId: testBarbershopId,
          campaignId: testCampaignId,
          recipientId: testRecipientId1,
          userId: testUserId,
          openPreparationId: prepId,
        });
      }),
      prismaB.$transaction(async (tx) => {
        return confirmManualRecipientSend(tx, {
          barbershopId: testBarbershopId,
          campaignId: testCampaignId,
          recipientId: testRecipientId1,
          userId: testUserId,
          openPreparationId: prepId,
        });
      }),
    ]);

    // Exatamente uma transação efetuou a primeira confirmação e a outra realizou replay idempotente
    const existingCount = (resA.isExisting ? 1 : 0) + (resB.isExisting ? 1 : 0);
    expect(existingCount).toBe(1);

    // Confere estado final persistido no PostgreSQL
    const finalCampaign = await prismaA.reactivationCampaign.findUnique({
      where: { id: testCampaignId },
    });
    expect(finalCampaign?.sentCount).toBe(1);

    const finalRecipient = await prismaA.reactivationCampaignRecipient.findUnique({
      where: { id: testRecipientId1 },
    });
    expect(finalRecipient?.dispatchStatus).toBe(RecipientDispatchStatus.SENT_CONFIRMED);

    const logs = await prismaA.customerContactLog.findMany({
      where: { reactivationRecipientId: testRecipientId1 },
    });
    expect(logs).toHaveLength(1);
  });

  it("G21-02: Concorrência entre cancelManualCampaign e confirmManualRecipientSend sob locks hierárquicos", async () => {
    if (!prismaA || !prismaB) {
      throw new Error("Instâncias Prisma não inicializadas.");
    }

    const raceCampId = `camp-race-${Date.now()}`;
    const raceRecId1 = `rec-race-1-${Date.now()}`;
    const raceRecId2 = `rec-race-2-${Date.now()}`;
    const raceCustId1 = `cust-race-1-${Date.now()}`;
    const raceCustId2 = `cust-race-2-${Date.now()}`;
    const racePhone1 = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;
    const racePhone2 = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;

    await prismaA.user.createMany({
      data: [
        { id: raceCustId1, name: "Cliente Race 1", email: `${raceCustId1}@test.local`, phone: racePhone1 },
        { id: raceCustId2, name: "Cliente Race 2", email: `${raceCustId2}@test.local`, phone: racePhone2 },
      ],
    });

    const racePrepId1 = buildOpenPreparationId(
      raceRecId1,
      1,
      racePhone1,
      "RETURN_REMINDER",
      "Mensagem de teste corrida"
    );

    await prismaA.reactivationCampaign.create({
      data: {
        id: raceCampId,
        barbershopId: testBarbershopId,
        name: "Fila Corrida Hierárquica Real",
        channel: "WHATSAPP",
        status: CampaignStatus.IN_PROGRESS,
        createdByUserId: testUserId,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        totalRecipients: 2,
        sentCount: 0,
        recipients: {
          create: [
            {
              id: raceRecId1,
              customerId: raceCustId1,
              customerNameSnapshot: "Cliente Race 1",
              customerPhoneSnapshot: racePhone1,
              timingStateSnapshot: "NO_HISTORY",
              scoreSnapshot: 0,
              dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
              dispatchAttemptCount: 1,
              payloadSnapshot: {
                openPreparationId: racePrepId1,
                openedPhoneNormalized: racePhone1,
                templateKey: "RETURN_REMINDER",
                openedMessageText: "Mensagem de teste corrida",
                previewMessage: "Mensagem de teste corrida",
              },
            },
            {
              id: raceRecId2,
              customerId: raceCustId2,
              customerNameSnapshot: "Cliente Race 2",
              customerPhoneSnapshot: racePhone2,
              timingStateSnapshot: "NO_HISTORY",
              scoreSnapshot: 0,
              dispatchStatus: RecipientDispatchStatus.READY,
              dispatchAttemptCount: 0,
              payloadSnapshot: {},
            },
          ],
        },
      },
    });

    // Conexão A cancela a campanha enquanto Conexão B tenta confirmar recipient 1
    let confirmError: any = null;
    let cancelResult: any = null;
    let confirmResult: any = null;

    await Promise.all([
      prismaA.$transaction(async (tx) => {
        cancelResult = await cancelManualCampaign(tx, {
          barbershopId: testBarbershopId,
          campaignId: raceCampId,
          userId: testUserId,
          reason: "Encerramento concorrente de teste",
        });
      }),
      prismaB.$transaction(async (tx) => {
        try {
          confirmResult = await confirmManualRecipientSend(tx, {
            barbershopId: testBarbershopId,
            campaignId: raceCampId,
            recipientId: raceRecId1,
            userId: testUserId,
            openPreparationId: racePrepId1,
          });
        } catch (err) {
          confirmError = err;
        }
      }),
    ]);

    expect(cancelResult).toBeDefined();

    // Estado final da campanha deve ser CANCELLED
    const finalCamp = await prismaA.reactivationCampaign.findUnique({
      where: { id: raceCampId },
    });
    expect(finalCamp?.status).toBe(CampaignStatus.CANCELLED);

    // Se a confirmação rodou antes do cancelamento, sentCount deve ser 1; se rodou depois, deve ser 0 e deu erro
    if (confirmError) {
      expect(["CAMPAIGN_CANCELLED", "INVALID_TRANSITION"]).toContain(confirmError.code);
      expect(finalCamp?.sentCount).toBe(0);
    } else {
      expect(confirmResult?.isExisting).toBe(false);
      expect(finalCamp?.sentCount).toBe(1);
    }

    // Nenhum destinatário confirmado duas vezes e nenhum log duplicado
    const logs = await prismaA.customerContactLog.findMany({
      where: { reactivationRecipientId: raceRecId1 },
    });
    expect(logs.length).toBeLessThanOrEqual(1);
  });

  it("G22-05: Confirmação antes do cancelamento: confirmação tem sucesso, cancelamento encerra pendentes e preserva envio", async () => {
    if (!prismaA) throw new Error("Prisma A não inicializado.");

    const campId = `camp-order-cf-${Date.now()}`;
    const rec1Id = `rec-cf-1-${Date.now()}`;
    const rec2Id = `rec-cf-2-${Date.now()}`;
    const custId1 = `cust-cf-1-${Date.now()}`;
    const custId2 = `cust-cf-2-${Date.now()}`;
    const phone1 = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;
    const phone2 = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;

    await prismaA.user.createMany({
      data: [
        { id: custId1, name: "Cliente CF 1", email: `${custId1}@test.local`, phone: phone1 },
        { id: custId2, name: "Cliente CF 2", email: `${custId2}@test.local`, phone: phone2 },
      ],
    });

    const prepId = buildOpenPreparationId(rec1Id, 1, phone1, "RETURN_REMINDER", "Msg CF 1");

    await prismaA.reactivationCampaign.create({
      data: {
        id: campId,
        barbershopId: testBarbershopId,
        name: "Campanha Ordem Confirm First",
        channel: "WHATSAPP",
        status: CampaignStatus.IN_PROGRESS,
        createdByUserId: testUserId,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        totalRecipients: 2,
        sentCount: 0,
        recipients: {
          create: [
            {
              id: rec1Id,
              customerId: custId1,
              customerNameSnapshot: "Cliente CF 1",
              customerPhoneSnapshot: phone1,
              timingStateSnapshot: "NO_HISTORY",
              scoreSnapshot: 0,
              dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
              dispatchAttemptCount: 1,
              payloadSnapshot: {
                openPreparationId: prepId,
                openedPhoneNormalized: phone1,
                templateKey: "RETURN_REMINDER",
                openedMessageText: "Msg CF 1",
                previewMessage: "Msg CF 1",
              },
            },
            {
              id: rec2Id,
              customerId: custId2,
              customerNameSnapshot: "Cliente CF 2",
              customerPhoneSnapshot: phone2,
              timingStateSnapshot: "NO_HISTORY",
              scoreSnapshot: 0,
              dispatchStatus: RecipientDispatchStatus.READY,
              dispatchAttemptCount: 0,
              payloadSnapshot: {},
            },
          ],
        },
      },
    });

    // 1. Confirmação executada ANTES do cancelamento
    const confirmRes = await prismaA.$transaction(async (tx) => {
      return confirmManualRecipientSend(tx, {
        barbershopId: testBarbershopId,
        campaignId: campId,
        recipientId: rec1Id,
        userId: testUserId,
        openPreparationId: prepId,
      });
    });

    expect(confirmRes.isExisting).toBe(false);

    // 2. Cancelamento executado APÓS a confirmação
    const cancelRes = await prismaA.$transaction(async (tx) => {
      return cancelManualCampaign(tx, {
        barbershopId: testBarbershopId,
        campaignId: campId,
        userId: testUserId,
        reason: "Cancelamento após confirmação",
      });
    });

    expect(cancelRes.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(cancelRes.cancelledRecipientsCount).toBe(1); // apenas recipient 2 foi cancelado

    // Valida estado persistido
    const campAfter = await prismaA.reactivationCampaign.findUnique({
      where: { id: campId },
      include: { recipients: true },
    });
    expect(campAfter?.sentCount).toBe(1);
    expect(campAfter?.status).toBe(CampaignStatus.CANCELLED);

    const r1 = campAfter?.recipients.find((r) => r.id === rec1Id);
    const r2 = campAfter?.recipients.find((r) => r.id === rec2Id);
    expect(r1?.dispatchStatus).toBe(RecipientDispatchStatus.SENT_CONFIRMED);
    expect(r2?.dispatchStatus).toBe(RecipientDispatchStatus.EXCLUDED);

    const logs = await prismaA.customerContactLog.findMany({
      where: { reactivationRecipientId: rec1Id },
    });
    expect(logs).toHaveLength(1);
  });

  it("G22-05: Cancelamento antes da confirmação: cancelamento encerra e confirmação subsequente é rejeitada", async () => {
    if (!prismaA) throw new Error("Prisma A não inicializado.");

    const campId = `camp-order-canf-${Date.now()}`;
    const recId = `rec-canf-${Date.now()}`;
    const custId = `cust-canf-${Date.now()}`;
    const phone = `55179${Math.floor(10000000 + Math.random() * 90000000)}`;

    await prismaA.user.create({
      data: { id: custId, name: "Cliente Cancel First", email: `${custId}@test.local`, phone },
    });

    const prepId = buildOpenPreparationId(recId, 1, phone, "RETURN_REMINDER", "Msg Cancel First");

    await prismaA.reactivationCampaign.create({
      data: {
        id: campId,
        barbershopId: testBarbershopId,
        name: "Campanha Cancel First",
        channel: "WHATSAPP",
        status: CampaignStatus.IN_PROGRESS,
        createdByUserId: testUserId,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        totalRecipients: 1,
        sentCount: 0,
        recipients: {
          create: [
            {
              id: recId,
              customerId: custId,
              customerNameSnapshot: "Cliente Cancel First",
              customerPhoneSnapshot: phone,
              timingStateSnapshot: "NO_HISTORY",
              scoreSnapshot: 0,
              dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
              dispatchAttemptCount: 1,
              payloadSnapshot: {
                openPreparationId: prepId,
                openedPhoneNormalized: phone,
                templateKey: "RETURN_REMINDER",
                openedMessageText: "Msg Cancel First",
                previewMessage: "Msg Cancel First",
              },
            },
          ],
        },
      },
    });

    // 1. Cancelamento executado ANTES
    await prismaA.$transaction(async (tx) => {
      return cancelManualCampaign(tx, {
        barbershopId: testBarbershopId,
        campaignId: campId,
        userId: testUserId,
        reason: "Cancelamento prévio",
      });
    });

    // 2. Tentativa de confirmação após cancelamento DEVE falhar com erro de campanha cancelada
    let confirmErr: any = null;
    try {
      await prismaA.$transaction(async (tx) => {
        return confirmManualRecipientSend(tx, {
          barbershopId: testBarbershopId,
          campaignId: campId,
          recipientId: recId,
          userId: testUserId,
          openPreparationId: prepId,
        });
      });
    } catch (err) {
      confirmErr = err;
    }

    expect(confirmErr).toBeDefined();
    expect(["CAMPAIGN_CANCELLED", "INVALID_TRANSITION"]).toContain(confirmErr?.code);

    const campAfter = await prismaA.reactivationCampaign.findUnique({
      where: { id: campId },
    });
    expect(campAfter?.sentCount).toBe(0);

    const logs = await prismaA.customerContactLog.findMany({
      where: { reactivationRecipientId: recId },
    });
    expect(logs).toHaveLength(0);
  });

  it("G22-03: Consulta JSON real no PostgreSQL: targetSegment {}, origin null, SMART_CRM, ASSISTED_QUEUE com paginação e tenant isolation", async () => {
    if (!prismaA) throw new Error("Prisma A não inicializado.");

    const otherShopId = `shop-other-${Date.now()}`;
    await prismaA.barbershop.create({
      data: {
        id: otherShopId,
        name: "Outra Barbearia",
        slug: `outra-${Date.now()}`,
        phone: "5517999999999",
        zipCode: "15000000",
        street: "Rua Outra",
        number: "200",
        neighborhood: "Centro",
        city: "Sao Jose do Rio Preto",
        state: "SP",
      },
    });

    const cEmptyId = `camp-json-empty-${Date.now()}`;
    const cNullId = `camp-json-null-${Date.now()}`;
    const cSmartId = `camp-json-smart-${Date.now()}`;
    const cQueueId = `camp-json-queue-${Date.now()}`;
    const cOtherId = `camp-json-other-${Date.now()}`;

    // 1. targetSegment = {} (objeto JSON vazio)
    await prismaA.reactivationCampaign.create({
      data: {
        id: cEmptyId,
        barbershopId: testBarbershopId,
        name: "Legada JSON Vazio",
        channel: "WHATSAPP",
        status: CampaignStatus.COMPLETED,
        createdByUserId: testUserId,
        targetSegment: {},
        totalRecipients: 0,
        sentCount: 0,
        createdAt: new Date(Date.now() - 4000),
      },
    });

    // 2. targetSegment = { origin: null }
    await prismaA.reactivationCampaign.create({
      data: {
        id: cNullId,
        barbershopId: testBarbershopId,
        name: "Legada Origin Null",
        channel: "WHATSAPP",
        status: CampaignStatus.COMPLETED,
        createdByUserId: testUserId,
        targetSegment: { origin: null },
        totalRecipients: 0,
        sentCount: 0,
        createdAt: new Date(Date.now() - 3000),
      },
    });

    // 3. targetSegment = { origin: "SMART_CRM_REACTIVATION" }
    await prismaA.reactivationCampaign.create({
      data: {
        id: cSmartId,
        barbershopId: testBarbershopId,
        name: "Legada Smart CRM",
        channel: "WHATSAPP",
        status: CampaignStatus.COMPLETED,
        createdByUserId: testUserId,
        targetSegment: { origin: "SMART_CRM_REACTIVATION" },
        totalRecipients: 0,
        sentCount: 0,
        createdAt: new Date(Date.now() - 2000),
      },
    });

    // 4. targetSegment = { origin: "CLIENTS_BASE_ASSISTED_QUEUE" }
    await prismaA.reactivationCampaign.create({
      data: {
        id: cQueueId,
        barbershopId: testBarbershopId,
        name: "Fila Assistida Base",
        channel: "WHATSAPP",
        status: CampaignStatus.IN_PROGRESS,
        createdByUserId: testUserId,
        targetSegment: { origin: "CLIENTS_BASE_ASSISTED_QUEUE" },
        totalRecipients: 0,
        sentCount: 0,
        createdAt: new Date(Date.now() - 1000),
      },
    });

    // 5. Outro tenant (mesma origem legada, mas barbearia diferente)
    await prismaA.reactivationCampaign.create({
      data: {
        id: cOtherId,
        barbershopId: otherShopId,
        name: "Campanha Outro Tenant",
        channel: "WHATSAPP",
        status: CampaignStatus.COMPLETED,
        createdByUserId: testUserId,
        targetSegment: { origin: "SMART_CRM_REACTIVATION" },
        totalRecipients: 0,
        sentCount: 0,
        createdAt: new Date(),
      },
    });

    // Consulta A: Legadas do Smart CRM usando a cláusula OR exata do endpoint
    const legacyWhereClause: any = {
      barbershopId: testBarbershopId,
      OR: [
        { targetSegment: { equals: {} } },
        { targetSegment: { path: ["origin"], equals: Prisma.DbNull } },
        { targetSegment: { path: ["origin"], equals: Prisma.JsonNull } },
        { targetSegment: { path: ["origin"], equals: "SMART_CRM_REACTIVATION" } },
        {
          NOT: {
            targetSegment: {
              path: ["origin"],
              equals: "CLIENTS_BASE_ASSISTED_QUEUE",
            },
          },
        },
      ],
    };

    const legacyResults = await prismaA.reactivationCampaign.findMany({
      where: legacyWhereClause,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const legacyIds = legacyResults.map((c) => c.id);
    expect(legacyIds).toContain(cEmptyId);
    expect(legacyIds).toContain(cNullId);
    expect(legacyIds).toContain(cSmartId);
    expect(legacyIds).not.toContain(cQueueId); // Fila Assistida excluída
    expect(legacyIds).not.toContain(cOtherId); // Outro tenant excluído

    // Consulta B: Fila Assistida da Base de Clientes
    const queueWhereClause: any = {
      barbershopId: testBarbershopId,
      targetSegment: {
        path: ["origin"],
        equals: "CLIENTS_BASE_ASSISTED_QUEUE",
      },
    };

    const queueResults = await prismaA.reactivationCampaign.findMany({
      where: queueWhereClause,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const queueIds = queueResults.map((c) => c.id);
    expect(queueIds).toContain(cQueueId);
    expect(queueIds).not.toContain(cEmptyId);
    expect(queueIds).not.toContain(cNullId);
    expect(queueIds).not.toContain(cSmartId);
    expect(queueIds).not.toContain(cOtherId);

    // Consulta C: Paginação por cursor determinística
    const page1 = await prismaA.reactivationCampaign.findMany({
      where: legacyWhereClause,
      take: 2,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(page1).toHaveLength(2);

    const cursorId = page1[page1.length - 1].id;
    const page2 = await prismaA.reactivationCampaign.findMany({
      where: legacyWhereClause,
      take: 2,
      cursor: { id: cursorId },
      skip: 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(page2.length).toBeGreaterThanOrEqual(1);

    // Garante ausência de duplicatas entre páginas
    const page1Ids = new Set(page1.map((p) => p.id));
    for (const p of page2) {
      expect(page1Ids.has(p.id)).toBe(false);
    }

    // Cleanup dos dados deste teste
    await prismaA.reactivationCampaign.deleteMany({
      where: { id: { in: [cEmptyId, cNullId, cSmartId, cQueueId, cOtherId] } },
    });
    await prismaA.barbershop.delete({ where: { id: otherShopId } });
  });

  describe("G3.1 — Integração Real Sem Mocks para BUG-G3-01, BUG-G3-02 e BUG-G3-03", () => {
    it("G31-PG-01 (BUG-G3-01): prepareManualReactivationCampaign real com User.comandas, isolamento multi-tenant, idempotência, limite 50 e legado isolado", async () => {
      if (!prismaA) throw new Error("Prisma A não inicializado.");
      const suffix = `g31p1-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const shopA = `shop-a-${suffix}`;
      const shopB = `shop-b-${suffix}`;
      const opA = `op-a-${suffix}`;
      const custComanda = `cust-cmd-${suffix}`;
      const custLink = `cust-lnk-${suffix}`;
      const custShopB = `cust-b-${suffix}`;
      const randPhone = (d: number) => `55179${String(10000000 + Math.floor(Math.random() * 80000000) + d).slice(0, 8)}`;

      try {
        await prismaA.barbershop.createMany({
          data: [
            {
              id: shopA,
              name: "Barbearia G31 A",
              slug: `g31-a-${suffix}`,
              phone: "5517991110001",
              zipCode: "15000000",
              street: "Rua A",
              number: "1",
              neighborhood: "Centro",
              city: "Sao Jose do Rio Preto",
              state: "SP",
            },
            {
              id: shopB,
              name: "Barbearia G31 B",
              slug: `g31-b-${suffix}`,
              phone: "5517991110002",
              zipCode: "15000000",
              street: "Rua B",
              number: "2",
              neighborhood: "Centro",
              city: "Sao Jose do Rio Preto",
              state: "SP",
            },
          ],
        });

        await prismaA.user.createMany({
          data: [
            { id: opA, name: "Owner G31", email: `${opA}@test.local`, phone: randPhone(1) },
            { id: custComanda, name: "Cliente Comanda", email: `${custComanda}@test.local`, phone: randPhone(2) },
            { id: custLink, name: "Cliente Link", email: `${custLink}@test.local`, phone: randPhone(3) },
            { id: custShopB, name: "Cliente Shop B", email: `${custShopB}@test.local`, phone: randPhone(4) },
          ],
        });

        // Cliente vinculado APENAS por Comanda em shopA (exercita relação User.comandas corrigida!)
        await prismaA.comanda.create({
          data: {
            barbershopId: shopA,
            customerId: custComanda,
            customerName: "Cliente Comanda",
          },
        });
        await prismaA.customerBarbershopLink.create({
          data: { barbershopId: shopA, customerId: custLink },
        });
        await prismaA.customerBarbershopLink.create({
          data: { barbershopId: shopB, customerId: custShopB },
        });

        await prismaA.customerMarketingConsent.createMany({
          data: [
            {
              barbershopId: shopA,
              customerId: custComanda,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              evidence: "Autorizado G31 PG",
              lastConfirmedAt: new Date(),
            },
            {
              barbershopId: shopA,
              customerId: custLink,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              evidence: "Autorizado G31 PG",
              lastConfirmedAt: new Date(),
            },
            {
              barbershopId: shopB,
              customerId: custShopB,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              evidence: "Autorizado G31 Shop B",
              lastConfirmedAt: new Date(),
            },
          ],
        });

        // Campanha legada Smart CRM READY no mesmo tenant não pode colidir com a Fila Assistida
        const legacyId = `camp-leg-${suffix}`;
        await prismaA.reactivationCampaign.create({
          data: {
            id: legacyId,
            barbershopId: shopA,
            name: "Smart CRM Legado",
            channel: DEFAULT_CRM_CHANNEL,
            status: CampaignStatus.READY,
            createdByUserId: opA,
            targetSegment: { origin: "SMART_CRM_REACTIVATION" },
            totalRecipients: 0,
          },
        });

        // Limite máximo de 50 clientes por lote
        await expect(
          prismaA.$transaction((tx) =>
            prepareManualReactivationCampaign(tx, {
              barbershopId: shopA,
              userId: opA,
              requestKey: `rk-limit-${suffix}`,
              selectedCustomerIds: Array.from({ length: 51 }, (_, i) => `id-${i}`),
              templateKey: "RETURN_REMINDER",
              origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            })
          )
        ).rejects.toThrow(/BATCH_LIMIT_EXCEEDED/);

        // Preparação real passando cliente de Comanda, cliente de Link e cliente de OUTRA barbearia (custShopB)
        const reqKey = `rk-${suffix}`;
        const prep = await prismaA.$transaction((tx) =>
          prepareManualReactivationCampaign(tx, {
            barbershopId: shopA,
            userId: opA,
            requestKey: reqKey,
            selectedCustomerIds: [custComanda, custLink, custShopB],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            baseUrl: "http://localhost:3099",
          })
        );

        expect(prep.isExisting).toBe(false);
        expect(prep.accepted).toHaveLength(2);
        expect(prep.accepted.map((r) => r.customerId)).toEqual([custComanda, custLink]);
        expect(prep.rejected).toEqual([
          expect.objectContaining({
            customerId: custShopB,
            reasonCode: "CUSTOMER_NOT_FOUND",
          }),
        ]);

        // Replay idempotente com mesmo requestKey
        const replay = await prismaA.$transaction((tx) =>
          prepareManualReactivationCampaign(tx, {
            barbershopId: shopA,
            userId: opA,
            requestKey: reqKey,
            selectedCustomerIds: [custComanda, custLink, custShopB],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          })
        );
        expect(replay.isExisting).toBe(true);
        expect(replay.campaign.id).toBe(prep.campaign.id);

        // Nova requisição com requestKey distinto enquanto fila ativa existe deve bloquear com ACTIVE_QUEUE_ALREADY_EXISTS
        await expect(
          prismaA.$transaction((tx) =>
            prepareManualReactivationCampaign(tx, {
              barbershopId: shopA,
              userId: opA,
              requestKey: `rk-other-${suffix}`,
              selectedCustomerIds: [custComanda],
              templateKey: "RETURN_REMINDER",
              origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            })
          )
        ).rejects.toThrow(/ACTIVE_QUEUE_ALREADY_EXISTS/);

        const legacyRow = await prismaA.reactivationCampaign.findUnique({ where: { id: legacyId } });
        expect(legacyRow?.status).toBe(CampaignStatus.READY);
      } finally {
        await prismaA.reactivationCampaignRecipient.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.reactivationCampaign.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.comanda.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.customerMarketingConsent.deleteMany({ where: { barbershopId: { in: [shopA, shopB] } } });
        await prismaA.customerBarbershopLink.deleteMany({ where: { barbershopId: { in: [shopA, shopB] } } });
        await prismaA.user.deleteMany({ where: { id: { in: [opA, custComanda, custLink, custShopB] } } });
        await prismaA.barbershop.deleteMany({ where: { id: { in: [shopA, shopB] } } });
      }
    });

    it("G31-PG-02 (BUG-G3-02): consentimento gravado em MARKETING reflete em listBarbershopClients sem promover UNKNOWN/legado ou ignorar OPTED_OUT", async () => {
      if (!prismaA) throw new Error("Prisma A não inicializado.");
      const suffix = `g31p2-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const shopA = `shop-c-${suffix}`;
      const cUnknown = `cust-unk-${suffix}`;
      const cOptedOut = `cust-out-${suffix}`;
      const cLegacy = `cust-leg-${suffix}`;
      const randPhone = (d: number) => `55179${String(20000000 + Math.floor(Math.random() * 70000000) + d).slice(0, 8)}`;

      try {
        await prismaA.barbershop.create({
          data: {
            id: shopA,
            name: "Barbearia Consent PG",
            slug: `g31-c-${suffix}`,
            phone: "5517991110003",
            zipCode: "15000000",
            street: "Rua C",
            number: "3",
            neighborhood: "Centro",
            city: "Sao Jose do Rio Preto",
            state: "SP",
          },
        });
        await prismaA.user.createMany({
          data: [
            { id: cUnknown, name: "Cliente Unknown", email: `${cUnknown}@test.local`, phone: randPhone(1) },
            { id: cOptedOut, name: "Cliente OptedOut", email: `${cOptedOut}@test.local`, phone: randPhone(2) },
            { id: cLegacy, name: "Cliente Legado", email: `${cLegacy}@test.local`, phone: randPhone(3) },
          ],
        });
        await prismaA.customerBarbershopLink.createMany({
          data: [
            { barbershopId: shopA, customerId: cUnknown },
            { barbershopId: shopA, customerId: cOptedOut },
            { barbershopId: shopA, customerId: cLegacy },
          ],
        });

        await prismaA.customerMarketingConsent.createMany({
          data: [
            {
              barbershopId: shopA,
              customerId: cOptedOut,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
              status: MarketingConsentStatus.OPTED_OUT,
              source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
              evidence: "Solicitou opt-out",
              optedOutAt: new Date(),
            },
            {
              barbershopId: shopA,
              customerId: cLegacy,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: "REACTIVATION_MARKETING",
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              evidence: "Registro historico antigo",
              lastConfirmedAt: new Date(),
            },
          ],
        });

        const beforeList = await listBarbershopClients(prismaA, { barbershopId: shopA });
        const byIdBefore = new Map(beforeList.clients.map((c) => [c.id, c]));
        expect(byIdBefore.get(cUnknown)?.whatsappQueue?.consentStatus).toBe("UNKNOWN");
        expect(byIdBefore.get(cUnknown)?.whatsappQueue?.eligible).toBe(false);
        expect(byIdBefore.get(cOptedOut)?.whatsappQueue?.consentStatus).toBe("OPTED_OUT");
        expect(byIdBefore.get(cOptedOut)?.whatsappQueue?.eligible).toBe(false);
        // Registro histórico REACTIVATION_MARKETING não é migrado/promovido automaticamente
        expect(byIdBefore.get(cLegacy)?.whatsappQueue?.consentStatus).toBe("UNKNOWN");
        expect(byIdBefore.get(cLegacy)?.whatsappQueue?.eligible).toBe(false);

        // Registra consentimento canônico MARKETING + OPTED_IN (como POST /marketing-consent)
        await prismaA.customerMarketingConsent.upsert({
          where: {
            barbershopId_customerId_channel_purpose: {
              barbershopId: shopA,
              customerId: cUnknown,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
            },
          },
          create: {
            barbershopId: shopA,
            customerId: cUnknown,
            channel: DEFAULT_CRM_CHANNEL,
            purpose: DEFAULT_CRM_PURPOSE,
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.ADMIN_WITH_PROOF,
            evidence: "Cliente autorizou presencialmente em 11/11/2026",
            lastConfirmedAt: new Date(),
          },
          update: {
            status: MarketingConsentStatus.OPTED_IN,
            lastConfirmedAt: new Date(),
          },
        });

        const afterList = await listBarbershopClients(prismaA, { barbershopId: shopA });
        const byIdAfter = new Map(afterList.clients.map((c) => [c.id, c]));
        expect(byIdAfter.get(cUnknown)?.whatsappQueue?.consentStatus).toBe("OPTED_IN");
        expect(byIdAfter.get(cUnknown)?.whatsappQueue?.eligible).toBe(true);
        expect(byIdAfter.get(cOptedOut)?.whatsappQueue?.consentStatus).toBe("OPTED_OUT");
      } finally {
        await prismaA.customerMarketingConsent.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.customerBarbershopLink.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.user.deleteMany({ where: { id: { in: [cUnknown, cOptedOut, cLegacy] } } });
        await prismaA.barbershop.deleteMany({ where: { id: shopA } });
      }
    });

    it("G31-PG-03 (BUG-G3-03): abertura real via revalidateAndOpenManualRecipient, lease 5min, retomada, validação openPreparationId, skip e cancelamento", async () => {
      if (!prismaA) throw new Error("Prisma A não inicializado.");
      const suffix = `g31p3-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const shopA = `shop-o-${suffix}`;
      const op1 = `op1-${suffix}`;
      const op2 = `op2-${suffix}`;
      const cust1 = `cust1-${suffix}`;
      const cust2 = `cust2-${suffix}`;
      const cust3 = `cust3-${suffix}`;
      const randPhone = (d: number) => `55179${String(30000000 + Math.floor(Math.random() * 60000000) + d).slice(0, 8)}`;

      try {
        await prismaA.barbershop.create({
          data: {
            id: shopA,
            name: "Barbearia Open PG",
            slug: `g31-o-${suffix}`,
            phone: "5517991110004",
            zipCode: "15000000",
            street: "Rua O",
            number: "4",
            neighborhood: "Centro",
            city: "Sao Jose do Rio Preto",
            state: "SP",
          },
        });
        await prismaA.user.createMany({
          data: [
            { id: op1, name: "Operador 1", email: `${op1}@test.local`, phone: randPhone(1) },
            { id: op2, name: "Operador 2", email: `${op2}@test.local`, phone: randPhone(2) },
            { id: cust1, name: "Cliente Fila 1", email: `${cust1}@test.local`, phone: randPhone(3) },
            { id: cust2, name: "Cliente Fila 2", email: `${cust2}@test.local`, phone: randPhone(4) },
            { id: cust3, name: "Cliente Fila 3", email: `${cust3}@test.local`, phone: randPhone(5) },
          ],
        });
        await prismaA.customerBarbershopLink.createMany({
          data: [
            { barbershopId: shopA, customerId: cust1 },
            { barbershopId: shopA, customerId: cust2 },
            { barbershopId: shopA, customerId: cust3 },
          ],
        });
        await prismaA.customerMarketingConsent.createMany({
          data: [cust1, cust2, cust3].map((customerId) => ({
            barbershopId: shopA,
            customerId,
            channel: DEFAULT_CRM_CHANNEL,
            purpose: DEFAULT_CRM_PURPOSE,
            status: MarketingConsentStatus.OPTED_IN,
            source: MarketingConsentSource.ADMIN_WITH_PROOF,
            evidence: "Autorizado G31 Flow",
            lastConfirmedAt: new Date(),
          })),
        });

        const prep = await prismaA.$transaction((tx) =>
          prepareManualReactivationCampaign(tx, {
            barbershopId: shopA,
            userId: op1,
            requestKey: `rk-flow-${suffix}`,
            selectedCustomerIds: [cust1, cust2, cust3],
            templateKey: "RETURN_REMINDER",
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            baseUrl: "http://localhost:3099",
          })
        );
        const [rec1, rec2, rec3] = prep.accepted;
        const tOpen1 = new Date("2026-11-11T14:00:00.000Z");

        // 1) Abertura real no backend (BUG-G3-03 corrigido — sem coluna whatsappOpenedAt)
        const open1 = await prismaA.$transaction((tx) =>
          revalidateAndOpenManualRecipient(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            recipientId: rec1.recipientId,
            userId: op1,
            userRole: "OWNER",
            operatorName: "Operador 1",
            returnOutcomeOnStale: true,
            now: tOpen1,
          })
        );
        expect(open1.ok).toBe(true);
        expect(open1.whatsappUrl).toMatch(/^https:\/\/wa\.me\/55/);
        expect(open1.openPreparationId).toBeTruthy();
        expect(open1.campaignStatus).toBe(CampaignStatus.IN_PROGRESS);

        // 2) Retomada persistida em getActiveManualCampaign preserva timestamp e lease
        const activeAfterOpen = await getActiveManualCampaign(prismaA, {
          barbershopId: shopA,
          origin: "CLIENTS_BASE_ASSISTED_QUEUE",
          currentUserId: op1,
          now: new Date("2026-11-11T14:01:00.000Z"),
        });
        const activeRec1 = activeAfterOpen?.recipients.find((r) => r.recipientId === rec1.recipientId);
        expect(activeRec1?.dispatchStatus).toBe(RecipientDispatchStatus.WHATSAPP_OPENED);
        expect(activeRec1?.whatsappOpenedAt).toBe(tOpen1.toISOString());
        expect(activeRec1?.openPreparationId).toBe(open1.openPreparationId);
        expect(activeRec1?.lease?.isExpired).toBe(false);

        // 3) Segundo operador bloqueado durante lease de 5 minutos
        await expect(
          prismaA.$transaction((tx) =>
            revalidateAndOpenManualRecipient(tx, {
              barbershopId: shopA,
              campaignId: prep.campaign.id,
              recipientId: rec1.recipientId,
              userId: op2,
              userRole: "OWNER",
              operatorName: "Operador 2",
              now: new Date("2026-11-11T14:02:00.000Z"),
            })
          )
        ).rejects.toThrow(/RECIPIENT_LOCKED_BY_OTHER_OPERATOR/);

        // 4) Reabertura após edição gera novo openPreparationId preservando whatsappOpenedAt inicial
        const open2 = await prismaA.$transaction((tx) =>
          revalidateAndOpenManualRecipient(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            recipientId: rec1.recipientId,
            userId: op1,
            userRole: "OWNER",
            operatorName: "Operador 1",
            messageText: "Mensagem editada pelo operador no G31",
            now: new Date("2026-11-11T14:02:30.000Z"),
          })
        );
        expect(open2.openPreparationId).not.toBe(open1.openPreparationId);

        // 5) Preparação obsoleta é rejeitada em confirmManualRecipientSend
        await expect(
          prismaA.$transaction((tx) =>
            confirmManualRecipientSend(tx, {
              barbershopId: shopA,
              campaignId: prep.campaign.id,
              recipientId: rec1.recipientId,
              userId: op1,
              userRole: "OWNER",
              openPreparationId: open1.openPreparationId,
              now: new Date("2026-11-11T14:03:00.000Z"),
            })
          )
        ).rejects.toThrow(/STALE_OPEN_PREPARATION/);

        // 6) Confirmação com openPreparationId vigente grava CustomerContactLog único e replay é idempotente
        const conf1 = await prismaA.$transaction((tx) =>
          confirmManualRecipientSend(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            recipientId: rec1.recipientId,
            userId: op1,
            userRole: "OWNER",
            openPreparationId: open2.openPreparationId,
            now: new Date("2026-11-11T14:03:10.000Z"),
          })
        );
        expect(conf1.isExisting).toBe(false);
        expect(conf1.recipient.dispatchStatus).toBe(RecipientDispatchStatus.SENT_CONFIRMED);

        const confReplay = await prismaA.$transaction((tx) =>
          confirmManualRecipientSend(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            recipientId: rec1.recipientId,
            userId: op1,
            userRole: "OWNER",
            openPreparationId: open2.openPreparationId,
          })
        );
        expect(confReplay.isExisting).toBe(true);

        const logsRec1 = await prismaA.customerContactLog.findMany({
          where: { reactivationRecipientId: rec1.recipientId },
        });
        expect(logsRec1).toHaveLength(1);

        // 7) Skip do cliente 2 não gera CustomerContactLog
        const skipped2 = await prismaA.$transaction((tx) =>
          skipManualRecipient(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            recipientId: rec2.recipientId,
            userId: op1,
            userRole: "OWNER",
          })
        );
        expect(skipped2.recipient.dispatchStatus).toBe(RecipientDispatchStatus.EXCLUDED);
        const logsCust2 = await prismaA.customerContactLog.findMany({
          where: { barbershopId: shopA, customerId: cust2 },
        });
        expect(logsCust2).toHaveLength(0);

        // 8) Cancelamento encerra fila mantendo rec3 EXCLUDED
        const cancelled = await prismaA.$transaction((tx) =>
          cancelManualCampaign(tx, {
            barbershopId: shopA,
            campaignId: prep.campaign.id,
            userId: op1,
            userRole: "OWNER",
          })
        );
        expect(cancelled.campaign.status).toBe(CampaignStatus.CANCELLED);
        expect(cancelled.cancelledRecipientsCount).toBe(1);
        const rowRec3 = await prismaA.reactivationCampaignRecipient.findUnique({
          where: { id: rec3.recipientId },
        });
        expect(rowRec3?.dispatchStatus).toBe(RecipientDispatchStatus.EXCLUDED);
      } finally {
        await prismaA.customerContactLog.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.reactivationCampaignRecipient.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.reactivationCampaign.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.customerMarketingConsent.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.customerBarbershopLink.deleteMany({ where: { barbershopId: shopA } });
        await prismaA.user.deleteMany({ where: { id: { in: [op1, op2, cust1, cust2, cust3] } } });
        await prismaA.barbershop.deleteMany({ where: { id: shopA } });
      }
    });

    it("GITHUB-01-PG: rota POST /marketing-consent exige prova real no PostgreSQL, preserva OPTED_OUT sem evidência, bloqueia sem CLIENTS_MANAGE e isola outro tenant", async () => {
      if (!prismaA) throw new Error("Prisma A não inicializado.");
      const suffix = `gh01-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const shopA = `shop-gha-${suffix}`;
      const shopB = `shop-ghb-${suffix}`;
      const ownerId = `own-${suffix}`;
      const barberId = `bar-${suffix}`;
      const memberBarberId = `mbr-bar-${suffix}`;
      const custA = `custa-${suffix}`;
      const custB = `custb-${suffix}`;
      const randPhone = (d: number) => `55179${String(40000000 + Math.floor(Math.random() * 50000000) + d).slice(0, 8)}`;

      try {
        await prismaA.barbershop.createMany({
          data: [
            {
              id: shopA,
              name: "Barbearia GH01 A",
              slug: `gh01-a-${suffix}`,
              phone: "5517991111101",
              zipCode: "15000000",
              street: "Rua A",
              number: "1",
              neighborhood: "Centro",
              city: "Sao Jose do Rio Preto",
              state: "SP",
            },
            {
              id: shopB,
              name: "Barbearia GH01 B",
              slug: `gh01-b-${suffix}`,
              phone: "5517991111102",
              zipCode: "15000000",
              street: "Rua B",
              number: "2",
              neighborhood: "Centro",
              city: "Sao Jose do Rio Preto",
              state: "SP",
            },
          ],
        });

        await prismaA.user.createMany({
          data: [
            { id: ownerId, name: "Owner GH01", email: `${ownerId}@test.local`, phone: randPhone(1) },
            { id: barberId, name: "Barber GH01", email: `${barberId}@test.local`, phone: randPhone(2) },
            { id: custA, name: "Cliente GH01 A", email: `${custA}@test.local`, phone: randPhone(3) },
            { id: custB, name: "Cliente GH01 B", email: `${custB}@test.local`, phone: randPhone(4) },
          ],
        });

        await prismaA.barbershopMember.create({
          data: {
            id: memberBarberId,
            barbershopId: shopA,
            userId: barberId,
            role: "BARBER",
            isActive: true,
          },
        });

        await prismaA.customerBarbershopLink.createMany({
          data: [
            { barbershopId: shopA, customerId: custA },
            { barbershopId: shopB, customerId: custB },
          ],
        });

        const ownerSession = {
          error: null,
          data: { userId: ownerId, role: "OWNER", memberId: null, barbershopId: shopA },
        };

        // 1) OPTED_IN sem evidência, omitindo context e declaração -> 400 sem gravação
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resNoProof = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
              eventKey: `evt-gh01-noproof-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resNoProof.status).toBe(400);

        // 2) OPTED_IN com declaração falsa ou evidência curta -> 400 sem gravação
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resFalseDecl = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
              declaredPriorAuthorization: false,
              evidence: "Autorização válida suficientemente longa",
              eventKey: `evt-gh01-falsedecl-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resFalseDecl.status).toBe(400);

        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resShortEv = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
              declaredPriorAuthorization: true,
              evidence: "curto",
              eventKey: `evt-gh01-short-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resShortEv.status).toBe(400);

        expect(
          await prismaA.customerMarketingConsent.count({
            where: { barbershopId: shopA, customerId: custA },
          })
        ).toBe(0);
        expect(
          await prismaA.customerMarketingConsentEvent.count({
            where: { barbershopId: shopA, customerId: custA },
          })
        ).toBe(0);

        // 3) Colaborador sem CLIENTS_MANAGE -> 403 sem gravação
        getAdminSessionMock.mockResolvedValueOnce({
          error: null,
          data: {
            userId: barberId,
            role: "BARBER",
            memberId: memberBarberId,
            barbershopId: shopA,
          },
        });
        const resForbidden = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              declaredPriorAuthorization: true,
              evidence: "Evidência válida que colaborador sem permissão não pode gravar",
              eventKey: `evt-gh01-403-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resForbidden.status).toBe(403);

        // 4) Cliente de outra barbearia -> 404 acesso negado sem gravação
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resCrossTenant = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custB}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.ADMIN_WITH_PROOF,
              declaredPriorAuthorization: true,
              evidence: "Tentativa indevida em outro tenant com prova",
              eventKey: `evt-gh01-cross-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custB }) }
        );
        expect(resCrossTenant.status).toBe(404);
        expect(
          await prismaA.customerMarketingConsent.count({
            where: { customerId: custB },
          })
        ).toBe(0);

        // 5) OPTED_IN com autorização declarada e evidência válida -> 200 e persistência real no Postgres
        const validEventKey = `evt-gh01-valid-${suffix}`;
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resValidIn = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_IN,
              source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
              declaredPriorAuthorization: true,
              evidence: "Cliente autorizou presencialmente no balcão em 11/11/2026.",
              eventKey: validEventKey,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resValidIn.status).toBe(200);

        const savedConsent = await prismaA.customerMarketingConsent.findUnique({
          where: {
            barbershopId_customerId_channel_purpose: {
              barbershopId: shopA,
              customerId: custA,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
            },
          },
        });
        expect(savedConsent?.status).toBe(MarketingConsentStatus.OPTED_IN);
        expect(savedConsent?.source).toBe(MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON);
        expect(savedConsent?.evidence).toBe("Cliente autorizou presencialmente no balcão em 11/11/2026.");

        // 6) OPTED_OUT sem evidência -> 200 e atualização real no Postgres
        getAdminSessionMock.mockResolvedValueOnce(ownerSession);
        const resValidOut = await marketingConsentPOST(
          new NextRequest(`http://localhost/api/admin/clients/${custA}/marketing-consent`, {
            method: "POST",
            body: JSON.stringify({
              status: MarketingConsentStatus.OPTED_OUT,
              eventKey: `evt-gh01-out-${suffix}`,
            }),
          }),
          { params: Promise.resolve({ id: custA }) }
        );
        expect(resValidOut.status).toBe(200);

        const afterOutConsent = await prismaA.customerMarketingConsent.findUnique({
          where: {
            barbershopId_customerId_channel_purpose: {
              barbershopId: shopA,
              customerId: custA,
              channel: DEFAULT_CRM_CHANNEL,
              purpose: DEFAULT_CRM_PURPOSE,
            },
          },
        });
        expect(afterOutConsent?.status).toBe(MarketingConsentStatus.OPTED_OUT);
        expect(
          await prismaA.customerMarketingConsentEvent.count({
            where: { barbershopId: shopA, customerId: custA },
          })
        ).toBe(2);
      } finally {
        await prismaA.customerMarketingConsentEvent.deleteMany({
          where: { barbershopId: { in: [shopA, shopB] } },
        });
        await prismaA.customerMarketingConsent.deleteMany({
          where: { barbershopId: { in: [shopA, shopB] } },
        });
        await prismaA.customerBarbershopLink.deleteMany({
          where: { barbershopId: { in: [shopA, shopB] } },
        });
        await prismaA.barbershopMember.deleteMany({
          where: { id: memberBarberId },
        });
        await prismaA.user.deleteMany({
          where: { id: { in: [ownerId, barberId, custA, custB] } },
        });
        await prismaA.barbershop.deleteMany({
          where: { id: { in: [shopA, shopB] } },
        });
      }
    });
  });
});
