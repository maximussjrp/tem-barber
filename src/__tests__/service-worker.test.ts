import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";

describe("P0.1B Service Worker Invariants & Behavior", () => {
  const swPath = path.join(process.cwd(), "public", "sw.js");

  it("proves public/sw.js file exists", () => {
    expect(fs.existsSync(swPath)).toBe(true);
  });

  it("contains push and notificationclick listeners using event.waitUntil", () => {
    const swContent = fs.readFileSync(swPath, "utf-8");

    expect(swContent).toMatch(/addEventListener\(\s*["']push["']/);
    expect(swContent).toMatch(/addEventListener\(\s*["']notificationclick["']/);
    expect(swContent).toContain("event.waitUntil");
  });

  it("does NOT contain any fetch listener or offline cache logic", () => {
    const swContent = fs.readFileSync(swPath, "utf-8");

    expect(swContent).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(swContent).not.toContain("caches.open");
    expect(swContent).not.toContain("cache.addAll");
    expect(swContent).not.toContain("CacheStorage");
  });

  it("proves public/manifest.json contains id and scope properties", () => {
    const manifestPath = path.join(process.cwd(), "public", "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifestContent.id).toBe("/");
    expect(manifestContent.scope).toBe("/");
    expect(manifestContent.display).toBe("standalone");
  });

  describe("Real SW Behavior Execution via VM Harness", () => {
    function createSWHarness() {
      const listeners: Record<string, Function> = {};

      const showNotificationMock = vi.fn().mockResolvedValue(undefined);
      const matchAllMock = vi.fn().mockResolvedValue([]);
      const openWindowMock = vi.fn().mockResolvedValue({ focus: vi.fn() });

      const fakeSelf = {
        location: { origin: "https://app.tembarber.com.br" },
        skipWaiting: vi.fn(),
        addEventListener: (event: string, fn: Function) => {
          listeners[event] = fn;
        },
        registration: {
          showNotification: showNotificationMock,
        },
        clients: {
          claim: vi.fn().mockResolvedValue(undefined),
          matchAll: matchAllMock,
          openWindow: openWindowMock,
        },
      };

      const code = fs.readFileSync(swPath, "utf-8");
      const sandbox = {
        self: fakeSelf,
        URL: URL,
        Object: Object,
        JSON: JSON,
      };

      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);

      return {
        listeners,
        showNotificationMock,
        matchAllMock,
        openWindowMock,
        fakeSelf,
      };
    }

    it("handles valid PUSH payload and shows notification with correct targetKey", async () => {
      const { listeners, showNotificationMock } = createSWHarness();
      expect(listeners.push).toBeDefined();

      let waitUntilPromise: Promise<void> | null = null;
      const fakeEvent = {
        data: {
          json: () => ({
            v: 1,
            title: "  Novo Agendamento  ",
            body: "  Cliente João agendou para 14:00  ",
            tag: "  appointment-123  ",
            target: "MEMBER_AGENDA",
          }),
        },
        waitUntil: (p: Promise<void>) => {
          waitUntilPromise = p;
        },
      };

      listeners.push(fakeEvent);
      await waitUntilPromise;

      expect(showNotificationMock).toHaveBeenCalledWith(
        "Novo Agendamento",
        expect.objectContaining({
          body: "Cliente João agendou para 14:00",
          tag: "appointment-123",
          data: { targetKey: "MEMBER_AGENDA" },
        })
      );
    });

    it("falls back to full generic payload if ANY field is invalid in PUSH payload", async () => {
      const { listeners, showNotificationMock } = createSWHarness();

      const testCases = [
        { v: 2, title: "T", body: "B", tag: "tg", target: "MEMBER_AGENDA" },
        { v: 1, title: "", body: "B", tag: "tg", target: "MEMBER_AGENDA" },
        { v: 1, title: "T", body: "  ", tag: "tg", target: "MEMBER_AGENDA" },
        { v: 1, title: "T", body: "B", tag: "", target: "MEMBER_AGENDA" },
        { v: 1, title: "T", body: "B", tag: "tg", target: "INVALID_TARGET" },
        { v: 1, title: "a".repeat(81), body: "B", tag: "tg", target: "MEMBER_AGENDA" },
      ];

      for (const payload of testCases) {
        showNotificationMock.mockClear();
        let waitUntilPromise: Promise<void> | null = null;
        const fakeEvent = {
          data: { json: () => payload },
          waitUntil: (p: Promise<void>) => {
            waitUntilPromise = p;
          },
        };

        listeners.push(fakeEvent);
        await waitUntilPromise;

        expect(showNotificationMock).toHaveBeenCalledWith(
          "Tem Barber",
          expect.objectContaining({
            body: "Você tem uma nova atualização.",
            tag: "tem-barber-notification",
            data: { targetKey: "ROOT" },
          })
        );
      }
    });

    it("handles NOTIFICATIONCLICK and resolves targetKey safely through allowlist", async () => {
      const { listeners, matchAllMock, openWindowMock } = createSWHarness();
      expect(listeners.notificationclick).toBeDefined();

      let waitUntilPromise: Promise<void> | null = null;
      const fakeNotificationEvent = {
        notification: {
          close: vi.fn(),
          data: { targetKey: "MEMBER_AGENDA" },
        },
        waitUntil: (p: Promise<void>) => {
          waitUntilPromise = p;
        },
      };

      listeners.notificationclick(fakeNotificationEvent);
      await waitUntilPromise;

      expect(fakeNotificationEvent.notification.close).toHaveBeenCalled();
      expect(matchAllMock).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
      expect(openWindowMock).toHaveBeenCalledWith("https://app.tembarber.com.br/member/agenda");
    });

    it("sanitizes malicious target in notification data and falls back to safe origin ROOT", async () => {
      const { listeners, openWindowMock } = createSWHarness();

      const maliciousKeys = [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://evil-attacker.com",
        "//evil.com",
        "../../etc/passwd",
        "<script>alert(1)</script>",
      ];

      for (const badKey of maliciousKeys) {
        openWindowMock.mockClear();
        let waitUntilPromise: Promise<void> | null = null;
        const fakeEvent = {
          notification: {
            close: vi.fn(),
            data: { targetKey: badKey },
          },
          waitUntil: (p: Promise<void>) => {
            waitUntilPromise = p;
          },
        };

        listeners.notificationclick(fakeEvent);
        await waitUntilPromise;

        expect(openWindowMock).toHaveBeenCalledWith("https://app.tembarber.com.br/");
      }
    });
  });
});
