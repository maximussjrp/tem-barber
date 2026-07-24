import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPublicAppUrl, getWaitlistPublicUrl, isLocalhost } from "@/lib/public-url";
import { GET as getAdminWaitlist } from "@/app/api/admin/waitlist/route";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findFirst: vi.fn() },
    onlineWaitlistSession: { findFirst: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

describe("public-url helper & waitlist public URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("identifica localhost corretamente", () => {
    expect(isLocalhost("http://localhost:3000")).toBe(true);
    expect(isLocalhost("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalhost("https://app.tembarber.com.br")).toBe(false);
  });

  it("prioriza NEXT_PUBLIC_APP_URL se configurada", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://custom.tembarber.com.br/");
    expect(getPublicAppUrl()).toBe("https://custom.tembarber.com.br");
  });

  it("prioriza NEXTAUTH_URL se NEXT_PUBLIC_APP_URL não estiver presente", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.tembarber.com.br/");
    expect(getPublicAppUrl()).toBe("https://app.tembarber.com.br");
  });

  it("bloqueia localhost em produção mesmo se NEXTAUTH_URL ou request contiver localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const req = new NextRequest("http://localhost:3000/api/admin/waitlist");
    expect(getPublicAppUrl(req)).toBe("https://app.tembarber.com.br");
    expect(getWaitlistPublicUrl("don-brio", req)).toBe("https://app.tembarber.com.br/don-brio/fila");
  });

  it("GET /api/admin/waitlist retorna publicUrl correto sem localhost em produção", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
    });

    prismaMock.barbershop.findFirst.mockResolvedValue({
      id: "shop-1",
      name: "Dom Brio",
      slug: "don-brio",
    });

    prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/admin/waitlist");
    const res = await getAdminWaitlist(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.publicUrl).toBe("https://app.tembarber.com.br/don-brio/fila");
    expect(data.publicUrl).not.toContain("localhost");
  });
});
