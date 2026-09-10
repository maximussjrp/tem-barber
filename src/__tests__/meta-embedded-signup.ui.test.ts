// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadFacebookSdk } from "@/lib/meta/whatsapp/embedded-signup";

describe("Meta Embedded Signup SDK pre-activation hardening", () => {
  afterEach(() => {
    delete window.FB;
    delete window.fbAsyncInit;
    document.getElementById("facebook-jssdk")?.remove();
  });

  it("SDK_GRAPH_VERSION_COMES_FROM_SERVER_CONFIG", async () => {
    const init = vi.fn();
    const loadPromise = loadFacebookSdk("app_123", "v23.0");

    expect(document.getElementById("facebook-jssdk")).not.toBeNull();

    window.FB = {
      init,
      login: vi.fn(),
    };
    window.fbAsyncInit?.();

    await expect(loadPromise).resolves.toBeUndefined();
    expect(init).toHaveBeenCalledWith({
      appId: "app_123",
      autoLogAppEvents: true,
      xfbml: true,
      version: "v23.0",
    });
  });

  it("MISSING_GRAPH_VERSION = SAFE_FAILURE", async () => {
    await expect(
      loadFacebookSdk("app_123", undefined as unknown as string)
    ).rejects.toThrow("Graph API version is required");

    expect(document.getElementById("facebook-jssdk")).toBeNull();
    expect(window.fbAsyncInit).toBeUndefined();
  });

  it("SDK_V21_HARDCODE = NONE", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/lib/meta/whatsapp/embedded-signup.ts"
      ),
      "utf8"
    );

    expect(source).not.toContain('version: "v21.0"');
  });
});
