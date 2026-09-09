import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

const { prismaMock } = vi.hoisted(() => {
  const pMock = {
    metaConnection: {
      findUnique: vi.fn(),
    },
    webhookInbox: {
      upsert: vi.fn(),
    },
  };
  return {
    prismaMock: pMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { GET, POST } from "@/app/api/webhooks/meta/whatsapp/route";

describe("Meta WhatsApp Webhook API", () => {
  const originalEnv = process.env;
  const testAppSecret = "webhook_secret_abc123";
  const testVerifyToken = "verify_token_tem_barber";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      META_APP_SECRET: testAppSecret,
      META_WEBHOOK_VERIFY_TOKEN: testVerifyToken,
    };
  });

  describe("GET /api/webhooks/meta/whatsapp (Handshake)", () => {
    it("returns 200 with challenge when hub.mode=subscribe and token matches", async () => {
      const url = `http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${testVerifyToken}&hub.challenge=1158201444`;
      const req = new NextRequest(url);

      const res = await GET(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("1158201444");
    });

    it("returns 403 Forbidden when verify token does not match", async () => {
      const url = `http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=1158201444`;
      const req = new NextRequest(url);

      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it("returns 403 Forbidden when hub.mode is not subscribe", async () => {
      const url = `http://localhost/api/webhooks/meta/whatsapp?hub.mode=other&hub.verify_token=${testVerifyToken}&hub.challenge=1158201444`;
      const req = new NextRequest(url);

      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/webhooks/meta/whatsapp (Event Ingestion & ACK Durability)", () => {
    function createSignedRequest(
      bodyObj: Record<string, unknown>,
      secret = testAppSecret,
      headerOverride?: string
    ) {
      const bodyStr = JSON.stringify(bodyObj);
      const hmac = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
      const sigHeader = headerOverride !== undefined ? headerOverride : `sha256=${hmac}`;

      return new NextRequest("http://localhost/api/webhooks/meta/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sigHeader ? { "x-hub-signature-256": sigHeader } : {}),
        },
        body: bodyStr,
      });
    }

    it("returns 401 Unauthorized when signature is missing or invalid", async () => {
      const req = createSignedRequest({ test: 123 }, "wrong_secret");
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Assinatura do webhook inválida.");
    });

    it("ingests message webhook, fans out event, and resolves mapped tenant", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_1001",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "5517999999999",
                    phone_number_id: "phone_num_2002",
                  },
                  contacts: [
                    {
                      profile: { name: "Cliente Teste" },
                      wa_id: "5517988888888",
                    },
                  ],
                  messages: [
                    {
                      from: "5517988888888",
                      id: "wamid.HBgLMTIzNDU2",
                      timestamp: "1725825600",
                      text: { body: "Olá, gostaria de agendar" },
                      type: "text",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
        id: "conn_tenant_1",
        barbershopId: "barber_shop_1",
      });

      prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_1" });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
      expect(json.count).toBe(1);

      // Verify connection lookup
      expect(prismaMock.metaConnection.findUnique).toHaveBeenCalledWith({
        where: { phoneNumberId: "phone_num_2002" },
        select: { id: true, barbershopId: true },
      });

      // Verify inbox upsert
      expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith({
        where: {
          provider_eventKey: {
            provider: "meta",
            eventKey: "message:phone_num_2002:wamid.HBgLMTIzNDU2",
          },
        },
        create: expect.objectContaining({
          provider: "meta",
          eventKey: "message:phone_num_2002:wamid.HBgLMTIzNDU2",
          eventType: "messages",
          wabaId: "waba_1001",
          phoneNumberId: "phone_num_2002",
          providerMessageId: "wamid.HBgLMTIzNDU2",
          barbershopId: "barber_shop_1",
          metaConnectionId: "conn_tenant_1",
          processingStatus: "PENDING",
        }),
        update: {},
      });
    });

    it("ingests status update webhook and sets status IGNORED with UNKNOWN_PHONE_NUMBER_ID when phone is unmapped", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_1001",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "5517999999999",
                    phone_number_id: "phone_unmapped_999",
                  },
                  statuses: [
                    {
                      id: "wamid.HBgLMTIzNDU2",
                      status: "delivered",
                      timestamp: "1725825610",
                      recipient_id: "5517988888888",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_2" });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
      expect(json.count).toBe(1);

      expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith({
        where: {
          provider_eventKey: {
            provider: "meta",
            eventKey: "status:phone_unmapped_999:wamid.HBgLMTIzNDU2:delivered:1725825610",
          },
        },
        create: expect.objectContaining({
          provider: "meta",
          eventKey: "status:phone_unmapped_999:wamid.HBgLMTIzNDU2:delivered:1725825610",
          eventType: "statuses",
          wabaId: "waba_1001",
          phoneNumberId: "phone_unmapped_999",
          providerMessageId: "wamid.HBgLMTIzNDU2",
          barbershopId: null,
          metaConnectionId: null,
          processingStatus: "IGNORED",
          processingError: "UNKNOWN_PHONE_NUMBER_ID",
        }),
        update: {},
      });
    });

    it("ingests generic change event (account_update) and computes deterministic eventKey", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_9999",
            changes: [
              {
                field: "account_update",
                value: {
                  event_time: 1725826000,
                  metadata: {
                    phone_number_id: "phone_gen_888",
                  },
                  ban_info: {
                    waba_ban_state: "SCHEDULE_FOR_DISABLE",
                  },
                },
              },
            ],
          },
        ],
      };

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
        id: "conn_gen_1",
        barbershopId: "shop_gen_1",
      });
      prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_gen_1" });

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);

      const upsertCall = prismaMock.webhookInbox.upsert.mock.calls[0][0];
      expect(upsertCall.where.provider_eventKey.eventKey).toContain("change:account_update:phone_gen_888:1725826000:");
      expect(upsertCall.create.eventType).toBe("account_update");
      expect(upsertCall.create.barbershopId).toBe("shop_gen_1");
      expect(upsertCall.create.metaConnectionId).toBe("conn_gen_1");
      expect(upsertCall.create.processingStatus).toBe("PENDING");
      expect(upsertCall.update).toEqual({});
    });

    it("preserves idempotency on duplicate event without mutating original row fields", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_dup",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "phone_dup" },
                  messages: [
                    { id: "msg_dup_123", timestamp: "1725825000", text: { body: "hi" } },
                  ],
                },
              },
            ],
          },
        ],
      };

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
        id: "conn_dup",
        barbershopId: "shop_dup",
      });
      // Existing row returned
      const existingRow = {
        id: "inbox_original_id",
        eventKey: "message:phone_dup:msg_dup_123",
        processingStatus: "PROCESSED",
        receivedAt: new Date("2026-09-08T10:00:00Z"),
        barbershopId: "shop_dup",
        payload: { original: true },
      };
      prismaMock.webhookInbox.upsert.mockResolvedValueOnce(existingRow);

      const req = createSignedRequest(payload);
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);

      // Assert update payload in upsert is strictly empty
      expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_eventKey: {
              provider: "meta",
              eventKey: "message:phone_dup:msg_dup_123",
            },
          },
          update: {},
        })
      );
    });

    it("returns HTTP 500 when database write fails before persisting (ACK durability)", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_fail",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "phone_fail" },
                  messages: [
                    { id: "msg_fail_1", timestamp: "1725825000", text: { body: "fail" } },
                  ],
                },
              },
            ],
          },
        ],
      };

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      // Simulate database write failure / connection pool error
      prismaMock.webhookInbox.upsert.mockRejectedValueOnce(new Error("DB connection failure"));

      const req = createSignedRequest(payload);
      const res = await POST(req);

      // Must NOT return HTTP 200 on DB failure
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Erro interno ao processar webhook.");
    });

    describe("Coexistence Webhook Ingestion (history, smb_app_state_sync, smb_message_echoes)", () => {
      it("ingests 'history' webhook event into inbox without mutating customers or appointments", async () => {
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "waba_coex_1",
              changes: [
                {
                  field: "history",
                  value: {
                    metadata: { phone_number_id: "phone_coex_1" },
                    threads: [{ id: "thread_123", messages_count: 10 }],
                  },
                },
              ],
            },
          ],
        };

        prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
          id: "conn_coex_1",
          barbershopId: "shop_coex_1",
        });
        prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_history_1" });

        const req = createSignedRequest(payload);
        const res = await POST(req);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.received).toBe(true);

        expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              eventType: "history",
              phoneNumberId: "phone_coex_1",
              barbershopId: "shop_coex_1",
              processingStatus: "PENDING",
            }),
          })
        );
      });

      it("ingests 'smb_app_state_sync' webhook event into inbox without domain mutation", async () => {
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "waba_coex_2",
              changes: [
                {
                  field: "smb_app_state_sync",
                  value: {
                    metadata: { phone_number_id: "phone_coex_2" },
                    state: "SYNCED",
                  },
                },
              ],
            },
          ],
        };

        prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
          id: "conn_coex_2",
          barbershopId: "shop_coex_2",
        });
        prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_sync_1" });

        const req = createSignedRequest(payload);
        const res = await POST(req);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.received).toBe(true);

        expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              eventType: "smb_app_state_sync",
              phoneNumberId: "phone_coex_2",
              barbershopId: "shop_coex_2",
              processingStatus: "PENDING",
            }),
          })
        );
      });

      it("ingests 'smb_message_echoes' webhook event into inbox without domain mutation", async () => {
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "waba_coex_3",
              changes: [
                {
                  field: "smb_message_echoes",
                  value: {
                    metadata: { phone_number_id: "phone_coex_3" },
                    echoes: [{ id: "echo_1", text: "Sent from phone app" }],
                  },
                },
              ],
            },
          ],
        };

        prismaMock.metaConnection.findUnique.mockResolvedValueOnce({
          id: "conn_coex_3",
          barbershopId: "shop_coex_3",
        });
        prismaMock.webhookInbox.upsert.mockResolvedValueOnce({ id: "inbox_echo_1" });

        const req = createSignedRequest(payload);
        const res = await POST(req);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.received).toBe(true);

        expect(prismaMock.webhookInbox.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              eventType: "smb_message_echoes",
              phoneNumberId: "phone_coex_3",
              barbershopId: "shop_coex_3",
              processingStatus: "PENDING",
            }),
          })
        );
      });
    });
  });
});
