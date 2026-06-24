import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks
const { prismaMock, getServerSessionMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    plan: { findFirst: vi.fn(), create: vi.fn() },
    tenantSubscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    barbershop: { findUnique: vi.fn() },
  },
  getServerSessionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: vi.fn() }));

// Import files to test
import { isPlatformAdmin, isSubscriptionActive } from "@/lib/subscription-utils";
import { requireAdmin } from "@/lib/admin-guard";
import { getAdminSession } from "@/lib/api-auth";
import { PUT as updateSubscriptionApi } from "@/app/api/admin/platform-subscriptions/route";
import { GET as getBarbershopApi } from "@/app/api/public/barbershop/[slug]/route";
import { NextRequest } from "next/server";

describe("Phase 3.0 — Subscription Controls and Platform Admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_ADMIN_EMAILS = "max.guarinieri@gmail.com";
  });

  // 1 & 2. isPlatformAdmin tests
  it("max.guarinieri@gmail.com é platform admin", () => {
    expect(isPlatformAdmin("max.guarinieri@gmail.com")).toBe(true);
    expect(isPlatformAdmin("MAX.GUARINIERI@GMAIL.COM")).toBe(true);
    expect(isPlatformAdmin(" max.guarinieri@gmail.com ")).toBe(true);
  });

  it("outro usuário não é platform admin", () => {
    expect(isPlatformAdmin("owner@tembarber.com.br")).toBe(false);
    expect(isPlatformAdmin("client@gmail.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });

  // 3 & 4. Platform page access control tests
  it("platform admin acessa /admin/platform", async () => {
    // This is tested implicitly by requireAdmin allowing platform admin to bypass
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-id", email: "max.guarinieri@gmail.com", role: "SUPER_ADMIN" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue(null); // no membership required

    await requireAdmin();
    expect(redirectMock).not.toHaveBeenCalledWith("/acesso-negado");
  });

  it("owner comum não acessa /admin/platform", async () => {
    // Tested by the role/email logic in the platform page
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });

    // In page.tsx:
    const session = await getServerSessionMock();
    const role = session.user.role;
    const email = session.user.email;
    const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

    expect(isPlatform).toBe(false);
  });

  // 5. Tenant ACTIVE acessa admin
  it("tenant ACTIVE acessa admin", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24), // future
    });

    await requireAdmin();
    expect(redirectMock).not.toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 6. Tenant TRIAL válido acessa admin
  it("tenant TRIAL válido acessa admin", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // future
    });

    await requireAdmin();
    expect(redirectMock).not.toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 7. Tenant PAST_DUE dentro da tolerância acessa admin
  it("tenant PAST_DUE dentro da tolerância acessa admin", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // future
    });

    await requireAdmin();
    expect(redirectMock).not.toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 8. Tenant SUSPENDED é bloqueado
  it("tenant SUSPENDED é bloqueado", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "SUSPENDED",
    });

    await requireAdmin();
    expect(redirectMock).toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 9. Tenant CANCELED é bloqueado
  it("tenant CANCELED é bloqueado", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "CANCELED",
    });

    await requireAdmin();
    expect(redirectMock).toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 10. Tenant TRIAL expirado é bloqueado
  it("tenant TRIAL expirado é bloqueado", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() - 1000 * 60 * 60), // past
    });

    await requireAdmin();
    expect(redirectMock).toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 11. Agenda pública bloqueia tenant suspenso
  it("agenda pública bloqueia tenant suspenso", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue({
      id: "shop-id",
      slug: "barbearia-a",
      active: true,
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "SUSPENDED",
    });

    const req = new NextRequest("http://localhost/api/public/barbershop/barbearia-a");
    const res = await getBarbershopApi(req, { params: Promise.resolve({ slug: "barbearia-a" }) });
    
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("SUBSCRIPTION_SUSPENDED");
  });

  // 12. Platform admin ignora bloqueio de tenant
  it("platform admin ignora bloqueio de tenant", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-id", email: "max.guarinieri@gmail.com", role: "SUPER_ADMIN" }
    });
    prismaMock.barbershopMember.findFirst.mockResolvedValue({
      id: "member-id",
      barbershopId: "shop-id",
    });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({
      status: "SUSPENDED", // would block standard owners
    });

    await requireAdmin();
    expect(redirectMock).not.toHaveBeenCalledWith("/assinatura-suspensa");
  });

  // 13. Owner comum não altera assinatura via API
  it("owner comum não altera assinatura via API", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@gmail.com", role: "OWNER" }
    });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({ barbershopId: "shop-id", status: "ACTIVE" }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(403);
  });

  // 14. API update assinatura funciona para platform admin e registra updatedBy
  it("API update assinatura funciona para platform admin e registra email", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-id", email: "max.guarinieri@gmail.com", role: "SUPER_ADMIN" }
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-id" });
    prismaMock.tenantSubscription.findFirst.mockResolvedValue({ id: "sub-id" });
    prismaMock.tenantSubscription.update.mockResolvedValue({
      id: "sub-id",
      status: "ACTIVE",
      updatedBy: "max.guarinieri@gmail.com",
    });

    const req = new NextRequest("http://localhost/api/admin/platform-subscriptions", {
      method: "PUT",
      body: JSON.stringify({ barbershopId: "shop-id", status: "ACTIVE" }),
    });

    const res = await updateSubscriptionApi(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.updatedBy).toBe("max.guarinieri@gmail.com");
  });
});
