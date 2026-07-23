import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findFirst: vi.fn() },
    service: { findFirst: vi.fn(), findMany: vi.fn() },
    barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    customerBarbershopLink: { upsert: vi.fn() },
    onlineWaitlistSession: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    onlineWaitlistEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    onlineWaitlistMemberConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET as getAdminWaitlist } from "@/app/api/admin/waitlist/route";
import { POST as openAdminWaitlist } from "@/app/api/admin/waitlist/open/route";
import { POST as pauseAdminWaitlist } from "@/app/api/admin/waitlist/pause/route";
import { POST as closeAdminWaitlist } from "@/app/api/admin/waitlist/close/route";
import { GET as getPublicWaitlist } from "@/app/api/public/barbershop/[slug]/waitlist/route";
import { POST as joinPublicWaitlist } from "@/app/api/public/barbershop/[slug]/waitlist/join/route";
import { GET as trackPublicWaitlist } from "@/app/api/public/barbershop/[slug]/waitlist/[entryId]/route";
import { POST as leavePublicWaitlist } from "@/app/api/public/barbershop/[slug]/waitlist/[entryId]/leave/route";
import {
  generateWaitlistPublicToken,
  hashWaitlistPublicToken,
  verifyWaitlistPublicToken,
} from "@/lib/waitlist/token";
import { calculateEntryPosition } from "@/lib/waitlist/positions";

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return cb(prismaMock);
    if (Array.isArray(cb)) return Promise.all(cb);
    return cb;
  });

  prismaMock.barbershop.findFirst.mockResolvedValue({
    id: "shop-1",
    name: "Dom Brio",
    slug: "dom-brio",
    phone: "(17) 98127-5471",
    active: true,
  });

  prismaMock.service.findFirst.mockResolvedValue({
    id: "service-corte",
    barbershopId: "shop-1",
    name: "Corte",
    price: "50.00",
    durationMin: 30,
    isActive: true,
  });

  prismaMock.service.findMany.mockResolvedValue([
    { id: "service-corte", name: "Corte", price: "50.00", durationMin: 30, isActive: true },
  ]);

  prismaMock.barbershopMember.findFirst.mockResolvedValue({
    id: "member-1",
    barbershopId: "shop-1",
    isActive: true,
    user: { name: "Barbeiro João" },
  });

  prismaMock.barbershopMember.findMany.mockResolvedValue([
    { id: "member-1", user: { id: "u-member-1", name: "Barbeiro João", avatarUrl: null } },
  ]);

  prismaMock.user.findFirst.mockResolvedValue({
    id: "customer-1",
    name: "Rafael",
    phone: "5517998887766",
  });

  prismaMock.customerBarbershopLink.upsert.mockResolvedValue({
    id: "link-1",
    barbershopId: "shop-1",
    customerId: "customer-1",
  });

  prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue(null);
  prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue(null);
  prismaMock.onlineWaitlistEntry.count.mockResolvedValue(0);
});

describe("PR #19 — Fila de Espera Online (Schema & APIs)", () => {
  // ─── Admin APIs ─────────────────────────────────────────────────────────────
  describe("APIs Admin", () => {
    it("1. abre fila para tenant", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.onlineWaitlistSession.create.mockResolvedValue({
        id: "session-1",
        barbershopId: "shop-1",
        status: "OPEN",
        openedAt: new Date(),
        createdById: "admin-1",
      });

      const req = new NextRequest("http://localhost/api/admin/waitlist/open", {
        method: "POST",
        body: JSON.stringify({ title: "Fila de Sexta" }),
      });

      const res = await openAdminWaitlist(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.session.status).toBe("OPEN");
      expect(prismaMock.onlineWaitlistSession.create).toHaveBeenCalled();
    });

    it("2. não permite duas filas OPEN para mesma barbearia", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "existing-session",
        barbershopId: "shop-1",
        status: "OPEN",
      });

      const req = new NextRequest("http://localhost/api/admin/waitlist/open", {
        method: "POST",
      });

      const res = await openAdminWaitlist(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("ALREADY_OPEN");
    });

    it("3. lista fila sem vazar outro tenant", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        barbershopId: "shop-1",
        status: "OPEN",
        entries: [
          {
            id: "entry-1",
            sessionId: "session-1",
            barbershopId: "shop-1",
            customerName: "Rafael",
            customerPhone: "5517998887766",
            status: "WAITING",
            publicTokenHash: "secret-hash",
          },
        ],
      });

      const req = new NextRequest("http://localhost/api/admin/waitlist");
      const res = await getAdminWaitlist(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.session.barbershopId).toBe("shop-1");
      expect(data.session.entries[0].publicTokenHash).toBeUndefined();
    });

    it("17. BARBER não acessa API admin de abrir/fechar fila", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "barber-1", barbershopId: "shop-1", role: "BARBER" },
      });

      const req = new NextRequest("http://localhost/api/admin/waitlist/open", {
        method: "POST",
      });

      const res = await openAdminWaitlist(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("FORBIDDEN");
    });

    it("18. fechar fila expira pendentes", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "MANAGER" },
      });

      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        barbershopId: "shop-1",
        status: "OPEN",
      });

      prismaMock.onlineWaitlistSession.update.mockResolvedValue({
        id: "session-1",
        barbershopId: "shop-1",
        status: "CLOSED",
      });

      const req = new NextRequest("http://localhost/api/admin/waitlist/close", {
        method: "POST",
      });

      const res = await closeAdminWaitlist(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.session.status).toBe("CLOSED");
      expect(prismaMock.onlineWaitlistEntry.updateMany).toHaveBeenCalledWith({
        where: {
          sessionId: "session-1",
          status: { in: ["WAITING", "CALLED"] },
        },
        data: { status: "EXPIRED" },
      });
    });
  });

  // ─── Public APIs ────────────────────────────────────────────────────────────
  describe("APIs Públicas", () => {
    it("4. público vê fila aberta e serviços", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
        title: "Fila Geral",
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist");
      const res = await getPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.isOpen).toBe(true);
      expect(data.services.length).toBe(1);
      expect(data.members.length).toBe(1);
    });

    it("5. público não vê nomes/telefones de outros clientes ao consultar status da fila", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist");
      const res = await getPublicWaitlist(req, { params });
      const data = await res.json();

      expect(data.entries).toBeUndefined();
      expect(data.waitingCount).toBeDefined();
    });

    it("6. cliente entra na fila com serviço válido", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        barbershopId: "shop-1",
        status: "OPEN",
      });

      prismaMock.onlineWaitlistEntry.create.mockResolvedValue({
        id: "entry-1",
        sessionId: "session-1",
        barbershopId: "shop-1",
        customerName: "Rafael",
        customerPhone: "5517998887766",
        serviceId: "service-corte",
        queueNumber: 1,
        positionWeight: 10,
        status: "WAITING",
        createdAt: new Date(),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
          serviceId: "service-corte",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.queueNumber).toBe(1);
      expect(data.publicToken).toMatch(/^OWL-[a-f0-9]+$/);
      expect(data.status).toBe("WAITING");
    });

    it("7. serviceId de outro tenant rejeita", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });
      prismaMock.service.findFirst.mockResolvedValue(null);

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
          serviceId: "service-outro-tenant",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_SERVICE");
    });

    it("8. preferredMemberId de outro tenant rejeita", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });
      prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
          serviceId: "service-corte",
          preferredMemberId: "member-outro-tenant",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_MEMBER");
    });

    it("9. telefone inválido rejeita", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "12345",
          serviceId: "service-corte",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_PHONE");
    });

    it("10. cria queueNumber sequencial", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });

      prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
        queueNumber: 4,
      });

      prismaMock.onlineWaitlistEntry.create.mockResolvedValue({
        id: "entry-5",
        sessionId: "session-1",
        queueNumber: 5,
        positionWeight: 50,
        status: "WAITING",
        createdAt: new Date(),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
          serviceId: "service-corte",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(data.queueNumber).toBe(5);
    });

    it("11. retorna publicToken só no join", async () => {
      prismaMock.onlineWaitlistSession.findFirst.mockResolvedValue({
        id: "session-1",
        status: "OPEN",
      });

      prismaMock.onlineWaitlistEntry.create.mockResolvedValue({
        id: "entry-1",
        queueNumber: 1,
        positionWeight: 10,
        status: "WAITING",
        createdAt: new Date(),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/join", {
        method: "POST",
        body: JSON.stringify({
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
          serviceId: "service-corte",
        }),
      });

      const res = await joinPublicWaitlist(req, { params });
      const data = await res.json();

      expect(data.publicToken).toBeDefined();
    });

    it("12. tracking com token válido funciona", async () => {
      const token = generateWaitlistPublicToken();
      const tokenHash = hashWaitlistPublicToken(token);

      prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
        id: "entry-1",
        sessionId: "session-1",
        queueNumber: 3,
        positionWeight: 30,
        status: "WAITING",
        customerName: "Rafael",
        customerPhone: "5517998887766",
        serviceId: "service-corte",
        publicTokenHash: tokenHash,
        createdAt: new Date(),
        service: { name: "Corte" },
      });

      const params = Promise.resolve({ slug: "dom-brio", entryId: "entry-1" });
      const req = new NextRequest(`http://localhost/api/public/barbershop/dom-brio/waitlist/entry-1?token=${token}`);
      const res = await trackPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.entry.queueNumber).toBe(3);
      expect(data.entry.serviceName).toBe("Corte");
    });

    it("13. tracking com token inválido retorna 403", async () => {
      const tokenHash = hashWaitlistPublicToken("OWL-correct-token");

      prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
        id: "entry-1",
        publicTokenHash: tokenHash,
      });

      const params = Promise.resolve({ slug: "dom-brio", entryId: "entry-1" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/entry-1?token=OWL-wrong-token");
      const res = await trackPublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("INVALID_TOKEN");
    });

    it("14. leave com token marca CANCELED_BY_CUSTOMER", async () => {
      const token = generateWaitlistPublicToken();
      const tokenHash = hashWaitlistPublicToken(token);

      prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
        id: "entry-1",
        status: "WAITING",
        publicTokenHash: tokenHash,
      });

      prismaMock.onlineWaitlistEntry.update.mockResolvedValue({
        id: "entry-1",
        status: "CANCELED_BY_CUSTOMER",
        canceledAt: new Date(),
      });

      const params = Promise.resolve({ slug: "dom-brio", entryId: "entry-1" });
      const req = new NextRequest("http://localhost/api/public/barbershop/dom-brio/waitlist/entry-1/leave", {
        method: "POST",
        body: JSON.stringify({ token }),
      });

      const res = await leavePublicWaitlist(req, { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("CANCELED_BY_CUSTOMER");
    });

    it("15. posição considera apenas WAITING", async () => {
      prismaMock.onlineWaitlistEntry.count.mockResolvedValue(2);

      const pos = await calculateEntryPosition(prismaMock as any, "session-1", 30, new Date());
      expect(pos).toBe(3);
      expect(prismaMock.onlineWaitlistEntry.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionId: "session-1",
            status: "WAITING",
          }),
        })
      );
    });

    it("16. tokenHash não aparece em responses/log", async () => {
      const token = generateWaitlistPublicToken();
      const tokenHash = hashWaitlistPublicToken(token);

      prismaMock.onlineWaitlistEntry.findFirst.mockResolvedValue({
        id: "entry-1",
        sessionId: "session-1",
        queueNumber: 1,
        positionWeight: 10,
        status: "WAITING",
        publicTokenHash: tokenHash,
        createdAt: new Date(),
      });

      const params = Promise.resolve({ slug: "dom-brio", entryId: "entry-1" });
      const req = new NextRequest(`http://localhost/api/public/barbershop/dom-brio/waitlist/entry-1?token=${token}`);
      const res = await trackPublicWaitlist(req, { params });
      const data = await res.json();

      expect(JSON.stringify(data)).not.toContain("publicTokenHash");
      expect(JSON.stringify(data)).not.toContain(tokenHash);
    });
  });
});
