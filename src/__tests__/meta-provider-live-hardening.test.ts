import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMetaFetchHandler } from "@/lib/meta/client";
import {
  assignSystemUserToWaba,
  subscribeAppToWaba,
} from "@/lib/meta/whatsapp/adapters";

describe("Meta provider live pre-activation hardening", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_APP_ID: "app_target_123",
      META_APP_SECRET: "app_secret_test",
      META_SYSTEM_USER_ACCESS_TOKEN: "system_user_token_test",
      META_ADMIN_SYSTEM_USER_ACCESS_TOKEN: "admin_system_user_token_test",
      META_GRAPH_API_VERSION: "v23.0",
    };
  });

  afterEach(() => {
    setMetaFetchHandler(null);
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("ASSIGNED_USERS_POST_USES_ADMIN_TOKEN", async () => {
    const authorities: Record<string, string | undefined> = {};

    setMetaFetchHandler(async (url, init) => {
      const method = init?.method || "GET";
      const headers = init?.headers as Record<string, string> | undefined;
      authorities[method] = headers?.Authorization;

      if (String(url).includes("/assigned_users") && method === "GET") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (String(url).includes("/assigned_users") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error("Unexpected mocked provider request");
    });

    await expect(
      assignSystemUserToWaba("waba_123", "system_user_123", "MANAGE")
    ).resolves.toEqual({ assigned: true, alreadyExisted: false });

    expect(authorities.GET).toBe("Bearer system_user_token_test");
    expect(authorities.POST).toBe("Bearer admin_system_user_token_test");
    expect(authorities.POST).not.toBe("Bearer system_user_token_test");
  });

  it("ASSIGNED_USERS_GET_500 prevents POST", async () => {
    let postCount = 0;

    setMetaFetchHandler(async (url, init) => {
      const method = init?.method || "GET";
      if (String(url).includes("/assigned_users") && method === "POST") {
        postCount++;
      }
      return new Response(
        JSON.stringify({ error: { message: "simulated reconciliation failure" } }),
        { status: 500 }
      );
    });

    await expect(
      assignSystemUserToWaba("waba_123", "system_user_123", "MANAGE")
    ).rejects.toThrow("simulated reconciliation failure");
    expect(postCount).toBe(0);
  });

  it("ASSIGNED_USERS_GET_NETWORK_FAILURE prevents POST", async () => {
    let postCount = 0;

    setMetaFetchHandler(async (_url, init) => {
      if ((init?.method || "GET") === "POST") {
        postCount++;
      }
      throw new Error("simulated assignment reconciliation network failure");
    });

    await expect(
      assignSystemUserToWaba("waba_123", "system_user_123", "MANAGE")
    ).rejects.toThrow("simulated assignment reconciliation network failure");
    expect(postCount).toBe(0);
  });

  it("SUBSCRIPTIONS_GET_500 prevents POST", async () => {
    let postCount = 0;

    setMetaFetchHandler(async (url, init) => {
      const method = init?.method || "GET";
      if (String(url).includes("/subscribed_apps") && method === "POST") {
        postCount++;
      }
      return new Response(
        JSON.stringify({ error: { message: "simulated subscription reconciliation failure" } }),
        { status: 500 }
      );
    });

    await expect(subscribeAppToWaba("waba_123")).rejects.toThrow(
      "simulated subscription reconciliation failure"
    );
    expect(postCount).toBe(0);
  });

  it("SUBSCRIPTIONS_GET_NETWORK_FAILURE prevents POST", async () => {
    let postCount = 0;

    setMetaFetchHandler(async (_url, init) => {
      if ((init?.method || "GET") === "POST") {
        postCount++;
      }
      throw new Error("simulated subscription reconciliation network failure");
    });

    await expect(subscribeAppToWaba("waba_123")).rejects.toThrow(
      "simulated subscription reconciliation network failure"
    );
    expect(postCount).toBe(0);
  });

  it.each([
    {
      label: "SUBSCRIPTION_WITHOUT_APP_ID != OUR_APP",
      entries: [{ whatsapp_business_api_data: { name: "unknown" } }],
      expectedPostCount: 1,
    },
    {
      label: "DIFFERENT_APP_ID != OUR_APP",
      entries: [{ whatsapp_business_api_data: { id: "different_app" } }],
      expectedPostCount: 1,
    },
    {
      label: "EXACT_APP_ID = OUR_APP",
      entries: [{ whatsapp_business_api_data: { id: "app_target_123" } }],
      expectedPostCount: 0,
    },
  ])("$label", async ({ entries, expectedPostCount }) => {
    let postCount = 0;

    setMetaFetchHandler(async (url, init) => {
      const method = init?.method || "GET";
      if (String(url).includes("/subscribed_apps") && method === "GET") {
        return new Response(JSON.stringify({ data: entries }), { status: 200 });
      }
      if (String(url).includes("/subscribed_apps") && method === "POST") {
        postCount++;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error("Unexpected mocked provider request");
    });

    const result = await subscribeAppToWaba("waba_123");

    expect(postCount).toBe(expectedPostCount);
    expect(result.alreadyExisted).toBe(expectedPostCount === 0);
  });

  it("TARGET_APP_ON_PAGE_2 is found and a missing ID does not short-circuit pagination", async () => {
    let getCount = 0;
    let postCount = 0;

    setMetaFetchHandler(async (url, init) => {
      const urlString = String(url);
      const method = init?.method || "GET";

      if (urlString.includes("/subscribed_apps") && method === "GET") {
        getCount++;
        if (!urlString.includes("after=")) {
          return new Response(
            JSON.stringify({
              data: [{ whatsapp_business_api_data: { name: "unknown" } }],
              paging: {
                next:
                  "https://graph.facebook.com/v23.0/waba_123/subscribed_apps?after=page_2",
              },
            }),
            { status: 200 }
          );
        }

        return new Response(
          JSON.stringify({
            data: [
              { whatsapp_business_api_data: { id: "app_target_123" } },
            ],
          }),
          { status: 200 }
        );
      }

      if (urlString.includes("/subscribed_apps") && method === "POST") {
        postCount++;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      throw new Error("Unexpected mocked provider request");
    });

    await expect(subscribeAppToWaba("waba_123")).resolves.toEqual({
      subscribed: true,
      alreadyExisted: true,
    });
    expect(getCount).toBe(2);
    expect(postCount).toBe(0);
  });
});
