import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopMember: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    careerLevel: { findFirst: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { PATCH, PUT } from "@/app/api/admin/team/[id]/route";

const owner = {
  id: "owner-member",
  barbershopId: "shop-a",
  userId: "owner-user",
  role: "OWNER" as const,
  bio: null,
  careerLevelId: null,
  isActive: true,
};

const manager = {
  ...owner,
  id: "manager-member",
  userId: "manager-user",
  role: "MANAGER" as const,
};

const barber = {
  ...owner,
  id: "barber-member",
  userId: "barber-user",
  role: "BARBER" as const,
};

function session(role: "OWNER" | "MANAGER", memberId: string) {
  return {
    error: null,
    data: { userId: `${memberId}-user`, role, memberId, barbershopId: "shop-a" },
  };
}

function request(method: "PUT" | "PATCH", body: unknown) {
  return new Request("http://localhost/api/admin/team/target", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.barbershopMember.update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...barber, ...data })
  );
});

describe("team member structural safety", () => {
  it("blocks MANAGER self-promotion to OWNER", async () => {
    getAdminSessionMock.mockResolvedValue(session("MANAGER", manager.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(manager);

    const response = await PUT(request("PUT", { role: "OWNER" }), context(manager.id));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "ROLE_ESCALATION_FORBIDDEN" });
    expect(prismaMock.barbershopMember.update).not.toHaveBeenCalled();
  });

  it("blocks MANAGER promoting another member to OWNER", async () => {
    getAdminSessionMock.mockResolvedValue(session("MANAGER", manager.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(barber);

    const response = await PUT(request("PUT", { role: "OWNER" }), context(barber.id));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "ROLE_ESCALATION_FORBIDDEN" });
  });

  it("blocks MANAGER demoting OWNER", async () => {
    getAdminSessionMock.mockResolvedValue(session("MANAGER", manager.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(owner);

    const response = await PUT(request("PUT", { role: "BARBER" }), context(owner.id));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "OWNER_PROTECTED" });
  });

  it("blocks MANAGER deactivating OWNER", async () => {
    getAdminSessionMock.mockResolvedValue(session("MANAGER", manager.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(owner);

    const response = await PATCH(request("PATCH", { isActive: false }), context(owner.id));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "OWNER_PROTECTED" });
  });

  it("allows OWNER promoting BARBER to MANAGER", async () => {
    getAdminSessionMock.mockResolvedValue(session("OWNER", owner.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(barber);

    const response = await PUT(request("PUT", { role: "MANAGER" }), context(barber.id));

    expect(response.status).toBe(200);
    expect(prismaMock.barbershopMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "MANAGER" }) })
    );
  });

  it("allows OWNER demoting MANAGER to BARBER", async () => {
    getAdminSessionMock.mockResolvedValue(session("OWNER", owner.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue(manager);

    const response = await PUT(request("PUT", { role: "BARBER" }), context(manager.id));

    expect(response.status).toBe(200);
    expect(prismaMock.barbershopMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "BARBER" }) })
    );
  });

  it("returns a safe 404 for a cross-tenant target", async () => {
    getAdminSessionMock.mockResolvedValue(session("OWNER", owner.id));
    prismaMock.barbershopMember.findUnique.mockResolvedValue({ ...barber, barbershopId: "shop-b" });

    const response = await PUT(request("PUT", { role: "MANAGER" }), context(barber.id));

    expect(response.status).toBe(404);
    expect(prismaMock.barbershopMember.update).not.toHaveBeenCalled();
  });
});
