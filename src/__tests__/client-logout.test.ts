import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSessionMock, cookiesMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { POST as logoutClient } from "@/app/api/client/logout/route";

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({
    getAll: () => [
      { name: "next-auth.session-token", value: "session-value" },
      { name: "next-auth.session-token.0", value: "chunk-value" },
    ],
  });
});

describe("POST /api/client/logout", () => {
  it("limpa cookies de sessao para cliente phone_lookup sem expor token", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-a", authLevel: "phone_lookup" },
    });

    const response = await logoutClient();
    const data = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(data).toEqual({ ok: true });
    expect(JSON.stringify(data)).not.toContain("session-value");
    expect(setCookie).toContain("next-auth.session-token=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("next-auth.session-token.0=");
  });

  it("nao limpa sessao administrativa", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-a", authLevel: "admin" },
    });

    const response = await logoutClient();
    const data = await response.json();

    expect(data).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
