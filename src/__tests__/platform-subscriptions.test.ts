import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn(), findFirst: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn() },
    tenantSubscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { PUT as updateSubscriptionApi } from "@/app/api/admin/platform-subscriptions/route";

describe("Domain C — Platform Subscriptions API (/api/admin/platform-subscriptions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_ADMIN_EMAILS = "max.guarinieri@gmail.com";
  });

  it("1. SUPER_ADMIN acessa e edita assinatura com sucesso", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({ id: "sub-1" });
    prismaMock.tenantSubscription.update.mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      updatedBy: "admin@platform.com",
    });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({
        barbershopId: "shop-1",
        status: "ACTIVE",
        currentPeriodStart: "2026-07-01",
        currentPeriodEnd: "2026-08-30",
      }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.updatedBy).toBe("admin@platform.com");
  });

  it("2. Platform Admin email acessa e edita assinatura", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "user-1", email: "max.guarinieri@gmail.com", role: "OWNER" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({ id: "sub-1" });
    prismaMock.tenantSubscription.update.mockResolvedValue({
      id: "sub-1",
      status: "TRIAL",
      updatedBy: "max.guarinieri@gmail.com",
    });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({
        barbershopId: "shop-1",
        status: "TRIAL",
        trialEndsAt: "2026-08-15",
      }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(200);
  });

  it("3. Usuário comum (não-platform e não-SUPER_ADMIN) recebe 403", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "user-normal", email: "barber@tembarber.com", role: "OWNER" },
    });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({ barbershopId: "shop-1", status: "ACTIVE" }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(403);
  });

  it("4. Edição status TRIAL sem trialEndsAt retorna 400", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({ barbershopId: "shop-1", status: "TRIAL", trialEndsAt: null }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("trialEndsAt é obrigatório");
  });

  it("5. Edição status ACTIVE sem datas retorna 400", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({ barbershopId: "shop-1", status: "ACTIVE" }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("currentPeriodStart e currentPeriodEnd são obrigatórios");
  });

  it("6. Edição status ACTIVE com fim anterior ao início retorna 400", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "super-id", email: "admin@platform.com", role: "SUPER_ADMIN" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({
        barbershopId: "shop-1",
        status: "ACTIVE",
        currentPeriodStart: "2026-08-30",
        currentPeriodEnd: "2026-08-01",
      }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("posterior a currentPeriodStart");
  });
});
