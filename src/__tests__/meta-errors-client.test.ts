import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MetaApiError, redactSensitiveString } from "@/lib/meta/errors";
import { metaGraphFetch, setMetaFetchHandler } from "@/lib/meta/client";

describe("Meta Errors & Client Module", () => {
  describe("Redaction Functionality", () => {
    it("redacts access tokens from query parameters", () => {
      const input = "https://graph.facebook.com/v21.0/me?access_token=EAAB123456789xyz&other=1";
      const sanitized = redactSensitiveString(input);
      expect(sanitized).toBe("https://graph.facebook.com/v21.0/me?access_token=[REDACTED]&other=1");
    });

    it("redacts appsecret_proof from query parameters", () => {
      const input = "https://graph.facebook.com/v21.0/me?appsecret_proof=abcdef0123456789&foo=bar";
      const sanitized = redactSensitiveString(input);
      expect(sanitized).toBe("https://graph.facebook.com/v21.0/me?appsecret_proof=[REDACTED]&foo=bar");
    });

    it("redacts Bearer tokens in headers or strings", () => {
      const input = "Failed with authorization: Bearer EAABcd123456.something";
      const sanitized = redactSensitiveString(input);
      expect(sanitized).toBe("Failed with authorization: Bearer [REDACTED]");
    });

    it("redacts PIN in json-like logs", () => {
      const input = '{"pin":"123456","other":"ok"}';
      const sanitized = redactSensitiveString(input);
      expect(sanitized).toBe('{"pin":"[REDACTED]","other":"ok"}');
    });
  });

  describe("MetaApiError Class", () => {
    it("sanitizes error message automatically", () => {
      const error = new MetaApiError(
        "Invalid token access_token=EAAB999 for query",
        { code: 190, subcode: 463, httpStatus: 400 }
      );

      expect(error.message).toBe("Invalid token access_token=[REDACTED] for query");
      expect(error.code).toBe(190);
      expect(error.subcode).toBe(463);
      expect(error.httpStatus).toBe(400);
      expect(error.isTransient).toBe(false);
    });

    it("identifies transient / retryable error codes", () => {
      const transientError = new MetaApiError("Rate limit reached", {
        code: 17,
        httpStatus: 429,
      });
      expect(transientError.isTransient).toBe(true);

      const serverError = new MetaApiError("Internal Server Error", {
        code: 2,
        httpStatus: 500,
      });
      expect(serverError.isTransient).toBe(true);
    });
  });

  describe("Meta Graph Fetch Client", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        META_GRAPH_API_VERSION: "v21.0",
        META_APP_SECRET: "test_secret_123",
        META_SYSTEM_USER_ACCESS_TOKEN: "EAA_test_system_token",
      };
    });

    afterEach(() => {
      setMetaFetchHandler(null);
      process.env = originalEnv;
    });

    it("executes mock fetch with proper URL, headers, and appsecret_proof", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      setMetaFetchHandler(async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ data: [{ id: "123" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await metaGraphFetch({
        endpoint: "/123456789/phone_numbers",
        params: { fields: "display_phone_number,verified_name" },
      });

      expect(result).toEqual({ data: [{ id: "123" }] });
      expect(capturedUrl).toContain("https://graph.facebook.com/v21.0/123456789/phone_numbers");
      expect(capturedUrl).toContain("fields=display_phone_number%2Cverified_name");
      expect(capturedUrl).toContain("appsecret_proof=");

      expect(capturedInit?.headers).toHaveProperty(
        "Authorization",
        "Bearer EAA_test_system_token"
      );
    });

    it("wraps API errors into MetaApiError with redacted tokens", async () => {
      setMetaFetchHandler(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "Error validating access token: Session has expired (access_token=EAAB123).",
              type: "OAuthException",
              code: 190,
              error_subcode: 463,
              fbtrace_id: "trace_xyz_999",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      });

      await expect(
        metaGraphFetch({
          endpoint: "/me",
        })
      ).rejects.toThrowError(MetaApiError);

      try {
        await metaGraphFetch({ endpoint: "/me" });
      } catch (err: unknown) {
        const metaErr = err as MetaApiError;
        expect(metaErr.message).toContain("access_token=[REDACTED]");
        expect(metaErr.code).toBe(190);
        expect(metaErr.subcode).toBe(463);
        expect(metaErr.fbtrace_id).toBe("trace_xyz_999");
      }
    });
  });
});
