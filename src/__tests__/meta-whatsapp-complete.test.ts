import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { setMetaFetchHandler } from "@/lib/meta/client";

const { requireOperationalSessionMock, prismaMock } = vi.hoisted(() => {
  type MockTxCallback<T = unknown> = (tx: unknown) => Promise<T>;
  const pMock = {
    metaOnboardingSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    metaConnection: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    metaConnectionEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    metaConnectionSecret: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: MockTxCallback) => cb(pMock)),
  };
  return {
    requireOperationalSessionMock: vi.fn(),
    prismaMock: pMock,
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: requireOperationalSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

import { POST } from "@/app/api/admin/integrations/meta/whatsapp/onboarding/complete/route";
import {
  launchCoexistenceEmbeddedSignup,
  isAllowedSignupOrigin,
  ALLOWED_SIGNUP_ORIGINS,
} from "@/lib/meta/whatsapp/embedded-signup";

describe("Meta WhatsApp Coexistence Onboarding Complete & Orchestrator", () => {
  const originalEnv = process.env;

  const validSessionId = "sess_valid_123";
  const validNonce = "a".repeat(64);
  const validNonceHash = crypto.createHash("sha256").update(validNonce).digest("hex");
  const validCode = "valid_oauth_code_xyz";
  const barbershopId = "shop_123";
  const userId = "user_owner_1";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      META_APP_ID: "app_123456",
      META_APP_SECRET: "app_secret_789",
      META_BUSINESS_ID: "biz_999000",
      META_SYSTEM_USER_ID: "sys_user_555",
      META_SYSTEM_USER_ACCESS_TOKEN: "sys_token_abc",
      META_ADMIN_SYSTEM_USER_ACCESS_TOKEN: "admin_sys_token_def",
      META_WEBHOOK_VERIFY_TOKEN: "verify_token_xyz",
      META_EMBEDDED_SIGNUP_CONFIG_ID: "signup_cfg_1",
      META_GRAPH_API_VERSION: "v21.0",
      META_WABA_SYSTEM_USER_TASK: "MANAGE",
      META_CREDENTIAL_ENCRYPTION_KEY_V1:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
  });

  afterEach(() => {
    setMetaFetchHandler(null);
    process.env = originalEnv;
  });

  function createCompleteRequest(bodyObj: Record<string, unknown>) {
    return new NextRequest(
      "http://localhost/api/admin/integrations/meta/whatsapp/onboarding/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      }
    );
  }

  function setupValidActiveSession() {
    prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
      id: validSessionId,
      barbershopId,
      createdByUserId: userId,
      nonceHash: validNonceHash,
      status: "INITIATED",
      expiresAt: new Date(Date.now() + 600000),
      consumedAt: null,
    });
    prismaMock.metaOnboardingSession.update.mockResolvedValue({});
  }

  describe("RBAC Matrix", () => {
    it("returns 401 if unauthenticated", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects MANAGER role with HTTP 403", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user_mgr", role: "MANAGER", barbershopId },
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Apenas proprietários");
    });

    it("rejects SUPER_ADMIN role with HTTP 403", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId: "user_sa", role: "SUPER_ADMIN", barbershopId },
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Apenas proprietários");
    });

    it("rejects invalid request body missing required fields with HTTP 400", async () => {
      requireOperationalSessionMock.mockResolvedValueOnce({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        // missing nonce and code
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Parâmetros obrigatórios ausentes");
    });
  });

  describe("Session Validation & Anti-Replay", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
    });

    it("blocks request if session belongs to another barbershop", async () => {
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId: "other_barbershop",
        createdByUserId: userId,
        nonceHash: validNonceHash,
        status: "INITIATED",
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("não pertence a esta barbearia");
    });

    it("blocks request if session was created by another user", async () => {
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId,
        createdByUserId: "other_user",
        nonceHash: validNonceHash,
        status: "INITIATED",
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("criada por outro usuário");
    });

    it("blocks request if session is expired", async () => {
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: validNonceHash,
        status: "INITIATED",
        expiresAt: new Date(Date.now() - 10000), // expired
        consumedAt: null,
      });
      prismaMock.metaOnboardingSession.update.mockResolvedValue({});

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("expirou");
    });

    it("blocks request if nonce does not match hash", async () => {
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: validNonceHash,
        status: "INITIATED",
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: null,
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: "wrong_nonce_value",
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Nonce inválido");
    });

    it("blocks replayed requests if session is already CONSUMED (zero provider call)", async () => {
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: validNonceHash,
        status: "CONSUMED",
        expiresAt: new Date(Date.now() + 600000),
        consumedAt: new Date(Date.now() - 5000),
      });

      let providerCalled = false;
      setMetaFetchHandler(async () => {
        providerCalled = true;
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("já utilizada ou inválida");
      expect(providerCalled).toBe(false);
    });
  });

  describe("Provider Token Debug & Authority Validation", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("blocks when debug_token returns is_valid = false", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "transient_token_123" }), {
            status: 200,
          });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: false,
                error: { message: "Token expired or revoked" },
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Invalid OAuth token");
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled();
    });

    it("blocks when debug_token app_id does not match platform app_id", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "transient_token_123" }), {
            status: 200,
          });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                app_id: "different_app_id_999",
                scopes: ["whatsapp_business_management"],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Token app_id mismatch");
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled();
    });

    it("blocks when debug_token lacks required whatsapp scopes", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "transient_token_123" }), {
            status: 200,
          });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                app_id: "app_123456",
                scopes: ["public_profile", "email"], // Missing whatsapp scopes
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("missing required WhatsApp Business management scope");
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled();
    });

    it("SCOPE_POLICY_PROVEN: blocks when token only has whatsapp_business_messaging without whatsapp_business_management", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "transient_token_123" }), {
            status: 200,
          });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                app_id: "app_123456",
                scopes: ["whatsapp_business_messaging"], // Messaging only - lacks management
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("missing required WhatsApp Business management scope");
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled();
    });
  });

  describe("Server Asset Authority & Deterministic Selection", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("blocks when multiple WABAs discovered without an explicit hint", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_1" }, { id: "waba_2" }], // Multiple WABAs
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Múltiplas contas WABA encontradas");
    });

    it("blocks when WABA hint is not found in server-discovered WABAs", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_server_actual" }],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        wabaIdHint: "waba_untrusted_fake",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("não encontrada nas contas compartilhadas");
    });

    it("blocks when multiple phones exist without an explicit hint", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_single" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "phone_1", display_phone_number: "+5517999991111" },
                { id: "phone_2", display_phone_number: "+5517999992222" },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Múltiplos números de telefone encontrados");
    });

    it("blocks when phone hint does not belong to selected WABA", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_single" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_actual_1", display_phone_number: "+5517999991111" }],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        phoneNumberIdHint: "phone_untrusted_wrong",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("não pertence à conta WABA selecionada");
    });
  });

  describe("Reconciliation, Structural Mutations & Zero /register Verification", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("successfully connects when single WABA and single phone discovered, executing reconciliation and zero /register calls", async () => {
      const calls: string[] = [];
      let registerCallCount = 0;
      let assignedUsersPostCount = 0;
      let subscribedAppsPostCount = 0;

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";
        calls.push(`${method} ${urlStr}`);

        if (urlStr.includes("/register")) {
          registerCallCount++;
        }

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_transient_1" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_main_100", name: "Barbearia WABA" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "phone_main_200",
                  display_phone_number: "+55 17 99999-0000",
                  verified_name: "Barbearia Top",
                  quality_rating: "GREEN",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            // First time: not assigned yet
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          }
          if (method === "POST") {
            assignedUsersPostCount++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") {
            // First time: not subscribed yet
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
          }
          if (method === "POST") {
            subscribedAppsPostCount++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_coex_1",
        barbershopId,
        connectionMode: "COEXISTENCE",
        wabaId: "waba_main_100",
        phoneNumberId: "phone_main_200",
        displayPhoneNumber: "+55 17 99999-0000",
        verifiedName: "Barbearia Top",
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.connection.status).toBe("CONNECTED");
      expect(json.connection.connectionMode).toBe("COEXISTENCE");
      expect(json.connection.wabaId).toBe("waba_main_100");
      expect(json.connection.phoneNumberId).toBe("phone_main_200");

      // Critical Assertions
      expect(registerCallCount).toBe(0); // STANDARD_REGISTER_CALLS = 0
      expect(prismaMock.metaConnectionSecret.create).not.toHaveBeenCalled(); // 0 secrets created
      expect(assignedUsersPostCount).toBe(1);
      expect(subscribedAppsPostCount).toBe(1);

      // Verify DB Upsert payload
      const upsertArgs = prismaMock.metaConnection.upsert.mock.calls[0][0];
      expect(upsertArgs.create.connectionMode).toBe("COEXISTENCE");
      expect(upsertArgs.create.phoneRegisteredAt).toBeNull();
      expect(upsertArgs.create.status).toBe("CONNECTED");
      expect(upsertArgs.create.wabaReviewStatus).toBeNull(); // WABA_NAME_PRESENT_DOES_NOT_IMPLY_APPROVED
      expect(upsertArgs.update.wabaReviewStatus).toBeNull();

      // Verify audit events
      expect(prismaMock.metaConnectionEvent.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ type: "ASSETS_DISCOVERED" }),
            expect.objectContaining({ type: "SYSTEM_USER_ASSIGNED" }),
            expect.objectContaining({ type: "WEBHOOK_SUBSCRIBED" }),
            expect.objectContaining({ type: "ONBOARDING_COMPLETED" }),
            expect.objectContaining({ type: "CONNECTED" }),
          ]),
        })
      );
    });

    it("WABA_NAME_PRESENT_DOES_NOT_IMPLY_APPROVED: wabaReviewStatus remains null even when WABA has a name", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_123" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_named_100", name: "Minha Barbearia Oficial Ltda" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_named_waba",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const upsertArgs = prismaMock.metaConnection.upsert.mock.calls[0][0];
      expect(upsertArgs.create.wabaReviewStatus).toBeNull();
      expect(upsertArgs.update.wabaReviewStatus).toBeNull();
    });

    it("reconciles already-assigned system user and subscribed app without duplicate structural POSTs", async () => {
      let assignedUsersPostCount = 0;
      let subscribedAppsPostCount = 0;

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_transient_1" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_main_100", name: "Barbearia WABA" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_main_200", display_phone_number: "+55 17 99999-0000" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            // Already assigned
            return new Response(
              JSON.stringify({
                data: [{ id: "sys_user_555", tasks: ["MANAGE"] }],
              }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            assignedUsersPostCount++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") {
            // Already subscribed
            return new Response(
              JSON.stringify({
                data: [{ whatsapp_business_api_data: { id: "app_123456" } }],
              }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            subscribedAppsPostCount++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_coex_2",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Reconciled: both POST counts should be strictly 0
      expect(assignedUsersPostCount).toBe(0);
      expect(subscribedAppsPostCount).toBe(0);
    });

    it("audits safe ONBOARDING_FAILED event when provider call fails and prevents false CONNECTED", async () => {
      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_transient_1" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_main_100" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_main_200", display_phone_number: "+55 17 99999-0000" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
          // Simulate assignment failure
          return new Response(
            JSON.stringify({
              error: {
                message: "Permission denied for system user assignment",
                code: 200,
                error_subcode: 1234,
                fbtrace_id: "trace_err_999",
              },
            }),
            { status: 403 }
          );
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnectionEvent.create.mockResolvedValueOnce({ id: "evt_fail_1" });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled();

      // Check ONBOARDING_FAILED event
      expect(prismaMock.metaConnectionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            barbershopId,
            type: "ONBOARDING_FAILED",
            metadata: expect.objectContaining({
              stage: "SYSTEM_USER_ASSIGNMENT",
              graphCode: "200",
              graphSubcode: "1234",
              fbtraceId: "trace_err_999",
            }),
          }),
        })
      );
    });
  });

  describe("Pagination & Multi-Page Asset Discovery (R6.1B.1 Closure Delta)", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("WABA_HINT_ON_PAGE_2: finds target WABA on page 2 when hint is provided and connects", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          if (!urlStr.includes("after=")) {
            // Page 1
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_page1_unrelated" }],
                paging: {
                  next: "https://graph.facebook.com/v21.0/biz_999000/client_whatsapp_business_accounts?after=page2_cursor",
                },
              }),
              { status: 200 }
            );
          } else {
            // Page 2
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_page2_target", name: "Target Barbearia WABA" }],
              }),
              { status: 200 }
            );
          }
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_100", display_phone_number: "+55 17 99999-1111" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_p2_1",
        barbershopId,
        wabaId: "waba_page2_target",
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        wabaIdHint: "waba_page2_target",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.connection.wabaId).toBe("waba_page2_target");
    });

    it("MULTIPLE_WABAS_ACROSS_PAGES_WITHOUT_HINT: exhausts pages and blocks with HTTP 400", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          if (!urlStr.includes("after=")) {
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_1" }],
                paging: {
                  next: "https://graph.facebook.com/v21.0/biz_999000/client_whatsapp_business_accounts?after=page2_cursor",
                },
              }),
              { status: 200 }
            );
          } else {
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_2" }],
              }),
              { status: 200 }
            );
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Múltiplas contas WABA encontradas");
    });

    it("PHONE_HINT_ON_PAGE_2: finds target phone on page 2 and connects", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          if (!urlStr.includes("after=")) {
            return new Response(
              JSON.stringify({
                data: [{ id: "phone_p1_other", display_phone_number: "+55 17 99999-0001" }],
                paging: {
                  next: "https://graph.facebook.com/v21.0/waba_100/phone_numbers?after=phone_p2_cursor",
                },
              }),
              { status: 200 }
            );
          } else {
            return new Response(
              JSON.stringify({
                data: [{ id: "phone_p2_target", display_phone_number: "+55 17 99999-0002" }],
              }),
              { status: 200 }
            );
          }
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_p2_phone",
        barbershopId,
        wabaId: "waba_100",
        phoneNumberId: "phone_p2_target",
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        phoneNumberIdHint: "phone_p2_target",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.connection.phoneNumberId).toBe("phone_p2_target");
    });

    it("MULTIPLE_PHONES_ACROSS_PAGES_WITHOUT_HINT: exhausts pages and blocks with HTTP 400", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          if (!urlStr.includes("after=")) {
            return new Response(
              JSON.stringify({
                data: [{ id: "phone_1", display_phone_number: "+55 17 99999-0001" }],
                paging: {
                  next: "https://graph.facebook.com/v21.0/waba_100/phone_numbers?after=phone_p2",
                },
              }),
              { status: 200 }
            );
          } else {
            return new Response(
              JSON.stringify({
                data: [{ id: "phone_2", display_phone_number: "+55 17 99999-0002" }],
              }),
              { status: 200 }
            );
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Múltiplos números de telefone encontrados");
    });

    it("ASSIGNED_USER_ON_PAGE_2: skips POST when system user is found on page 2", async () => {
      let assignedPostCalls = 0;

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0001" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            if (!urlStr.includes("after=")) {
              return new Response(
                JSON.stringify({
                  data: [{ id: "other_user_1", tasks: ["MANAGE"] }],
                  paging: {
                    next: "https://graph.facebook.com/v21.0/waba_100/assigned_users?after=usr_p2",
                  },
                }),
                { status: 200 }
              );
            } else {
              return new Response(
                JSON.stringify({
                  data: [{ id: "sys_user_555", tasks: ["MANAGE"] }],
                }),
                { status: 200 }
              );
            }
          }
          if (method === "POST") {
            assignedPostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_p2_assign",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(assignedPostCalls).toBe(0); // Reconciled on page 2!
    });

    it("APP_SUBSCRIPTION_ON_PAGE_2: skips POST when app subscription is found on page 2", async () => {
      let subscribePostCalls = 0;

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0001" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") {
            if (!urlStr.includes("after=")) {
              return new Response(
                JSON.stringify({
                  data: [{ whatsapp_business_api_data: { id: "other_app_999" } }],
                  paging: {
                    next: "https://graph.facebook.com/v21.0/waba_100/subscribed_apps?after=subs_p2",
                  },
                }),
                { status: 200 }
              );
            } else {
              return new Response(
                JSON.stringify({
                  data: [{ whatsapp_business_api_data: { id: "app_123456" } }],
                }),
                { status: 200 }
              );
            }
          }
          if (method === "POST") {
            subscribePostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_p2_subs",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(subscribePostCalls).toBe(0); // Reconciled on page 2!
    });

    it("INVALID_PAGINATION_HOST: rejects unexpected external domain in next URL", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "waba_1" }],
              paging: {
                next: "https://malicious-external-host.com/v21.0/waba_1",
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain("Invalid pagination host");
    });

    it("PAGINATION_SECRET_HARDENING: strips access_token and appsecret_proof from next URL and prevents secret leakage", async () => {
      const recordedUrls: string[] = [];
      const secretInNextUrl = "R6_SECRET_LEAK_TEST_TOKEN";
      const proofInNextUrl = "R6_SECRET_LEAK_TEST_PROOF";

      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        recordedUrls.push(urlStr);

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          if (!urlStr.includes("after=")) {
            // Page 1 returns paging.next containing query params including access_token and appsecret_proof
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_1" }],
                paging: {
                  next: `https://graph.facebook.com/v21.0/biz_999000/client_whatsapp_business_accounts?after=page2_cursor&access_token=${secretInNextUrl}&appsecret_proof=${proofInNextUrl}&limit=25`,
                },
              }),
              { status: 200 }
            );
          } else {
            // Page 2 returns target
            return new Response(
              JSON.stringify({
                data: [{ id: "waba_2", name: "Target WABA" }],
              }),
              { status: 200 }
            );
          }
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_1", display_phone_number: "+55 17 99999-1111" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_p2_secret_test",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        wabaIdHint: "waba_2",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify that the second page request URL never contains secretInNextUrl or proofInNextUrl
      const page2Request = recordedUrls.find((u) => u.includes("after=page2_cursor"));
      expect(page2Request).toBeDefined();
      expect(page2Request).not.toContain(secretInNextUrl);
      expect(page2Request).not.toContain(proofInNextUrl);
      // Verify safe cursor 'limit' and 'after' were preserved
      expect(page2Request).toContain("after=page2_cursor");
    });
  });

  describe("Granular Scope Target Validation", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("WRONG_GRANULAR_TARGET: blocks when granular scopes do not grant access to target WABA", async () => {
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_abc" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                app_id: "app_123456",
                scopes: ["whatsapp_business_management"],
                granular_scopes: [
                  {
                    scope: "whatsapp_business_management",
                    target_ids: ["waba_authorized_only_999"],
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: validCode,
        wabaIdHint: "waba_unauthorized_different",
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("granular scopes do not grant access to target WABA");
    });
  });

  describe("Embedded Signup Client Security (Unit)", () => {
    let mockWindow: {
      listeners: Record<string, ((e: unknown) => void)[]>;
      addEventListener: (type: string, fn: (e: unknown) => void) => void;
      removeEventListener: (type: string, fn: (e: unknown) => void) => void;
      dispatchEvent: (e: { type: string; origin?: string; data?: unknown }) => void;
      FB?: unknown;
    };

    beforeEach(() => {
      mockWindow = {
        listeners: {},
        addEventListener(type, fn) {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
          if (!this.listeners[type]) return;
          this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
        },
        dispatchEvent(e) {
          if (!this.listeners[e.type]) return;
          for (const fn of this.listeners[e.type]) {
            fn(e);
          }
        },
      };
      (globalThis as unknown as { window: unknown }).window = mockWindow;
    });

    afterEach(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
    });

    it("isAllowedSignupOrigin: strictly validates allowed origins", () => {
      expect(ALLOWED_SIGNUP_ORIGINS).toEqual([
        "https://www.facebook.com",
        "https://web.facebook.com",
      ]);
      expect(isAllowedSignupOrigin("https://www.facebook.com")).toBe(true);
      expect(isAllowedSignupOrigin("https://web.facebook.com")).toBe(true);
      expect(isAllowedSignupOrigin("https://evil.facebook.com")).toBe(false);
      expect(isAllowedSignupOrigin("https://attacker.com")).toBe(false);
      expect(isAllowedSignupOrigin("http://www.facebook.com")).toBe(false);
    });

    it("FOREIGN_ORIGIN & INVALID_MESSAGE: ignores message events from untrusted origins or bad payloads", () => {
      let completeCount = 0;
      let errorCount = 0;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCount++;
        },
        onError: () => {
          errorCount++;
        },
      });

      // Untrusted origin event
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://attacker.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "fake" },
        }),
      });

      // Malformed non-signup event
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({ type: "SOME_OTHER_EVENT", event: "FINISH" }),
      });

      expect(completeCount).toBe(0);
      expect(errorCount).toBe(0);
      cleanup();
    });

    it("NO_SESSION_NONCE_TRANSMITTED_TO_META: FB.login receives clean extras with featureType and empty setup (zero internal nonce sent)", () => {
      let loginOptions: Record<string, unknown> | null = null;
      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((_cb, opts) => {
          loginOptions = opts;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        nonce: "anti_replay_internal_nonce_123",
        onComplete: vi.fn(),
      });

      expect(loginOptions).toEqual({
        config_id: "cfg_123",
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
        },
      });

      const extras = (loginOptions as unknown as { extras?: Record<string, unknown> })?.extras;
      const setup = extras?.setup as Record<string, unknown> | undefined;
      expect(setup?.session_id).toBeUndefined();

      cleanup();
    });

    it("GENERIC_FINISH = IGNORED / NOT COEXISTENCE_COMPLETE: generic FINISH does not complete coexistence flow", () => {
      let completeCalls = 0;
      let loginCallback: ((res: { authResponse: { code: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      // Provide auth code first
      loginCallback!({ authResponse: { code: "oauth_code_123" } });

      // Dispatch generic FINISH event (should be ignored)
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "waba_generic" },
        }),
      });

      expect(completeCalls).toBe(0);
      cleanup();
    });

    it("COEXISTENCE_FINISH = ACCEPTED: FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING triggers successful completion", () => {
      let completeCalls = 0;
      let capturedResult: unknown = null;
      let loginCallback: ((res: { authResponse: { code: string; grantedScopes: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: (data) => {
          completeCalls++;
          capturedResult = data;
        },
      });

      // 1. Auth code arrives
      loginCallback!({
        authResponse: {
          code: "auth_code_coex_1",
          grantedScopes: "whatsapp_business_management",
        },
      });

      // 2. Coexistence finish event arrives
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          sessionInfoVersion: "3",
          data: {
            waba_id: "waba_coex_100",
            phone_number_id: "phone_coex_200",
            current_screen: "VERIFY_CODE",
          },
        }),
      });

      expect(completeCalls).toBe(1);
      expect(capturedResult).toEqual({
        code: "auth_code_coex_1",
        wabaIdHint: "waba_coex_100",
        phoneNumberIdHint: "phone_coex_200",
        metadata: {
          sessionInfoVersion: "3",
          screen: "VERIFY_CODE",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          grantedScopes: "whatsapp_business_management",
        },
      });

      cleanup();
    });

    it("CODE_BEFORE_FINISH = PASS: rendezvous succeeds when code arrives before session finish event", () => {
      let completeCalls = 0;
      let loginCallback: ((res: { authResponse: { code: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      // Step 1: Code resolves first
      loginCallback!({ authResponse: { code: "code_step1" } });
      expect(completeCalls).toBe(0); // Not completed yet

      // Step 2: Coexistence Finish event fires second
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "waba_1" },
        }),
      });

      expect(completeCalls).toBe(1);
      cleanup();
    });

    it("FINISH_BEFORE_CODE = PASS: rendezvous succeeds when session finish event arrives before code", () => {
      let completeCalls = 0;
      let loginCallback: ((res: { authResponse: { code: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      // Step 1: Coexistence Finish event fires first
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "waba_1" },
        }),
      });
      expect(completeCalls).toBe(0); // Not completed yet

      // Step 2: Code resolves second
      loginCallback!({ authResponse: { code: "code_step2" } });

      expect(completeCalls).toBe(1);
      cleanup();
    });

    it("CODE_WITHOUT_FINISH = NO_COMPLETION: flow remains uncompleted if finish event is never received", () => {
      let completeCalls = 0;
      let loginCallback: ((res: { authResponse: { code: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      loginCallback!({ authResponse: { code: "code_only" } });
      expect(completeCalls).toBe(0);
      cleanup();
    });

    it("FINISH_WITHOUT_CODE = NO_COMPLETION: flow remains uncompleted if code is never received", () => {
      let completeCalls = 0;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn(), // Login never resolves
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "waba_1" },
        }),
      });

      expect(completeCalls).toBe(0);
      cleanup();
    });

    it("DUPLICATE_EVENTS = ONE_COMPLETION_ONLY: multiple finish events after completion are safely ignored", () => {
      let completeCalls = 0;
      let loginCallback: ((res: { authResponse: { code: string } }) => void) | null = null;

      mockWindow.FB = {
        init: vi.fn(),
        login: vi.fn((cb) => {
          loginCallback = cb;
        }),
      };

      const cleanup = launchCoexistenceEmbeddedSignup({
        appId: "app_123",
        configId: "cfg_123",
        onComplete: () => {
          completeCalls++;
        },
      });

      loginCallback!({ authResponse: { code: "code_single" } });

      // First finish event -> completes
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "waba_1" },
        }),
      });

      // Second duplicate finish event
      mockWindow.dispatchEvent({
        type: "message",
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "waba_1" },
        }),
      });

      expect(completeCalls).toBe(1);
      cleanup();
    });
  });

  describe("Secret Non-Persistence Proof Test (R6.1B.1 Closure Delta)", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
      setupValidActiveSession();
    });

    it("ensures transient code, transient token, and system tokens are NEVER written to DB or audit events", async () => {
      const sentinelCode = "R6_TEST_OAUTH_CODE_DO_NOT_PERSIST";
      const sentinelTransientToken = "R6_TEST_TRANSIENT_TOKEN_DO_NOT_PERSIST";
      const sentinelSystemToken = "sys_token_abc";
      const sentinelAdminSystemToken = "R6_TEST_ADMIN_SYSTEM_TOKEN_DO_NOT_PERSIST";
      process.env.META_ADMIN_SYSTEM_USER_ACCESS_TOKEN = sentinelAdminSystemToken;

      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: sentinelTransientToken }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_main_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "phone_main_200", display_phone_number: "+55 17 99999-0000" }],
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_sentinel_proof",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const req = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: sentinelCode,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify zero MetaConnectionSecret calls
      expect(prismaMock.metaConnectionSecret.create).not.toHaveBeenCalled();

      // Check MetaConnection.upsert payload for sentinels
      const upsertCalls = prismaMock.metaConnection.upsert.mock.calls;
      const upsertString = JSON.stringify(upsertCalls);
      expect(upsertString).not.toContain(sentinelCode);
      expect(upsertString).not.toContain(sentinelTransientToken);
      expect(upsertString).not.toContain(sentinelSystemToken);
      expect(upsertString).not.toContain(sentinelAdminSystemToken);

      // Check MetaConnectionEvent.createMany payload for sentinels
      const eventCalls = prismaMock.metaConnectionEvent.createMany.mock.calls;
      const eventString = JSON.stringify(eventCalls);
      expect(eventString).not.toContain(sentinelCode);
      expect(eventString).not.toContain(sentinelTransientToken);
      expect(eventString).not.toContain(sentinelSystemToken);
      expect(eventString).not.toContain(sentinelAdminSystemToken);

      // Check MetaOnboardingSession.update payload for sentinels
      const sessionUpdateCalls = prismaMock.metaOnboardingSession.update.mock.calls;
      const sessionUpdateString = JSON.stringify(sessionUpdateCalls);
      expect(sessionUpdateString).not.toContain(sentinelCode);
      expect(sessionUpdateString).not.toContain(sentinelTransientToken);
      expect(sessionUpdateString).not.toContain(sentinelSystemToken);
      expect(sessionUpdateString).not.toContain(sentinelAdminSystemToken);
    });
  });

  describe("Session-Consumption Recovery & Partial Failure Idempotency (R6.1B.1 Delta Proof)", () => {
    beforeEach(() => {
      requireOperationalSessionMock.mockResolvedValue({
        error: null,
        data: { userId, role: "OWNER", barbershopId },
      });
    });

    it("MODE 1 (Code Exchange Failure): marks session CONSUMED, blocks replaying dead code, permits fresh retry", async () => {
      // First Attempt: Code exchange fails
      setupValidActiveSession();
      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(
            JSON.stringify({ error: { message: "Invalid verification code", code: 100 } }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req1 = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: "bad_code_1",
      });

      const res1 = await POST(req1);
      expect(res1.status).toBe(400);

      // Verify session was consumed atomically in TX 1 to prevent code replay
      expect(prismaMock.metaOnboardingSession.update).toHaveBeenCalledWith({
        where: { id: validSessionId },
        data: expect.objectContaining({ status: "CONSUMED" }),
      });

      // Attempting to replay same session immediately fails with HTTP 409
      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: validSessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: validNonceHash,
        status: "CONSUMED",
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 600000),
      });

      const reqReplay = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: "bad_code_1",
      });
      const resReplay = await POST(reqReplay);
      expect(resReplay.status).toBe(409);

      // Second Attempt: Fresh session created from Admin UI succeeds
      const freshSessionId = "sess_fresh_2";
      const freshNonce = "b".repeat(64);
      const freshNonceHash = crypto.createHash("sha256").update(freshNonce).digest("hex");

      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: freshSessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: freshNonceHash,
        status: "INITIATED",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 600000),
      });
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_recovered_1",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      setMetaFetchHandler(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "fresh_token_xyz" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({ data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users") || urlStr.includes("/subscribed_apps")) {
          return new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req2 = createCompleteRequest({
        sessionId: freshSessionId,
        nonce: freshNonce,
        code: "valid_fresh_code_2",
      });

      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.connection.status).toBe("CONNECTED");
    });

    it("MODE 4 (Partial Provider Failure Recovery): assigned_users succeeds, subscribed_apps fails -> retry reconciles and skips redundant assignment", async () => {
      let assignedPostCalls = 0;
      let subscribePostCalls = 0;
      let isAssignedOnMeta = false;

      // First Attempt: assigned_users succeeds, but subscribed_apps fails on Meta
      setupValidActiveSession();
      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_attempt_1" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({ data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            return new Response(
              JSON.stringify({
                data: isAssignedOnMeta ? [{ id: "sys_user_555", tasks: ["MANAGE"] }] : [],
              }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            assignedPostCalls++;
            isAssignedOnMeta = true;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          // Meta webhook subscription fails transiently
          return new Response(
            JSON.stringify({ error: { message: "Internal Meta Webhook Error", code: 2 } }),
            { status: 500 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req1 = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: "code_attempt_1",
      });

      const res1 = await POST(req1);
      expect(res1.status).toBe(500);
      expect(assignedPostCalls).toBe(1); // Assignment succeeded on provider
      expect(prismaMock.metaConnection.upsert).not.toHaveBeenCalled(); // No connection persisted

      // Second Attempt (Retry): User restarts with fresh session
      const retrySessionId = "sess_retry_4";
      const retryNonce = "c".repeat(64);
      const retryNonceHash = crypto.createHash("sha256").update(retryNonce).digest("hex");

      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: retrySessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: retryNonceHash,
        status: "INITIATED",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 600000),
      });
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_retry_success",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_attempt_2" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({ data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            // Already assigned on Meta from attempt 1!
            return new Response(
              JSON.stringify({
                data: [{ id: "sys_user_555", tasks: ["MANAGE"] }],
              }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            assignedPostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
          if (method === "POST") {
            subscribePostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req2 = createCompleteRequest({
        sessionId: retrySessionId,
        nonce: retryNonce,
        code: "code_attempt_2",
      });

      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);

      // Proof of Reconciliation: POST /assigned_users was NOT called in retry attempt
      expect(assignedPostCalls).toBe(1); // Still 1 from attempt 1
      expect(subscribePostCalls).toBe(1);
    });

    it("MODE 5 (DB Transaction 2 Persistence Failure Recovery): all provider ops succeed but DB fails -> retry reconciles all provider assets and connects", async () => {
      let assignedPostCalls = 0;
      let subscribePostCalls = 0;

      // Attempt 1: Provider ops succeed, but DB TX 2 throws
      setupValidActiveSession();
      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_1" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({ data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
          if (method === "POST") {
            assignedPostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
          if (method === "POST") {
            subscribePostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      // Simulate DB error in TX 2
      prismaMock.metaConnection.upsert.mockRejectedValueOnce(
        new Error("Database transient deadlock in transaction 2")
      );

      const req1 = createCompleteRequest({
        sessionId: validSessionId,
        nonce: validNonce,
        code: "code_tx2_fail",
      });

      const res1 = await POST(req1);
      expect(res1.status).toBe(500);

      // Attempt 2: User restarts flow -> Provider steps see both system user and app subscription exist
      const retrySessionId = "sess_retry_tx2";
      const retryNonce = "d".repeat(64);
      const retryNonceHash = crypto.createHash("sha256").update(retryNonce).digest("hex");

      prismaMock.metaOnboardingSession.findUnique.mockResolvedValueOnce({
        id: retrySessionId,
        barbershopId,
        createdByUserId: userId,
        nonceHash: retryNonceHash,
        status: "INITIATED",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 600000),
      });
      prismaMock.metaConnection.findUnique.mockResolvedValueOnce(null);
      prismaMock.metaConnection.upsert.mockResolvedValueOnce({
        id: "conn_tx2_recovered",
        barbershopId,
        status: "CONNECTED",
      });
      prismaMock.metaConnectionEvent.createMany.mockResolvedValueOnce({ count: 5 });

      setMetaFetchHandler(async (url, init) => {
        const urlStr = String(url);
        const method = init?.method || "GET";

        if (urlStr.includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "token_2" }), { status: 200 });
        }
        if (urlStr.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "app_123456", scopes: ["whatsapp_business_management"] },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/client_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [{ id: "waba_100" }] }), { status: 200 });
        }
        if (urlStr.includes("/phone_numbers")) {
          return new Response(
            JSON.stringify({ data: [{ id: "phone_100", display_phone_number: "+55 17 99999-0000" }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/assigned_users")) {
          if (method === "GET") {
            // Already assigned on Meta
            return new Response(
              JSON.stringify({ data: [{ id: "sys_user_555", tasks: ["MANAGE"] }] }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            assignedPostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        if (urlStr.includes("/subscribed_apps")) {
          if (method === "GET") {
            // Already subscribed on Meta
            return new Response(
              JSON.stringify({ data: [{ whatsapp_business_api_data: { id: "app_123456" } }] }),
              { status: 200 }
            );
          }
          if (method === "POST") {
            subscribePostCalls++;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const req2 = createCompleteRequest({
        sessionId: retrySessionId,
        nonce: retryNonce,
        code: "code_tx2_retry",
      });

      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.connection.status).toBe("CONNECTED");

      // Both POST calls were 0 in retry (1 from initial attempt only)
      expect(assignedPostCalls).toBe(1);
      expect(subscribePostCalls).toBe(1);
    });
  });
});
