import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getServerSessionMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findFirst: vi.fn(), findUnique: vi.fn() },
    tenantSubscription: { findFirst: vi.fn(), findUnique: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    appointment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    appointmentService: { create: vi.fn() },
    comanda: { findMany: vi.fn() },
    appointmentWhatsappConfirmation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    customerBarbershopLink: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    service: { findFirst: vi.fn(), findMany: vi.fn() },
    barberService: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  getServerSessionMock: vi.fn(),
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { POST as publicBook } from "@/app/api/public/barbershop/[slug]/book/route";
import { GET as getLinkedBarbershops } from "@/app/api/client/linked-barbershops/route";
import { GET as getClientAppointments } from "@/app/api/client/appointments/route";
import { POST as adminConfirmWhatsapp } from "@/app/api/admin/appointments/[id]/confirm-whatsapp/route";
import {
  buildWhatsappConfirmationLink,
  buildWhatsappConfirmationMessage,
  hashWhatsappConfirmationToken,
} from "@/lib/appointments/whatsapp-confirmation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));

  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
  prismaMock.idempotencyKey.create.mockResolvedValue({ id: "key-1" });
  prismaMock.idempotencyKey.update.mockResolvedValue({ id: "key-1" });
  prismaMock.appointmentWhatsappConfirmation.create.mockResolvedValue({
    id: "conf-new",
    appointmentId: "app-1",
    barbershopId: "shop-dom-brio",
    status: "PENDING",
    tokenHash: "hash",
    tokenHint: "TB-****56",
    expiresAt: new Date(Date.now() + 86400000),
  });

  prismaMock.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return cb(prismaMock);
    if (Array.isArray(cb)) return Promise.all(cb);
    return cb;
  });

  prismaMock.barbershop.findFirst.mockResolvedValue({
    id: "shop-dom-brio",
    name: "Dom Brio Barbearia",
    slug: "dom-brio",
    phone: "(17) 98127-5471",
    active: true,
  });

  prismaMock.tenantSubscription.findFirst.mockResolvedValue({
    id: "sub-1",
    barbershopId: "shop-dom-brio",
    status: "ACTIVE",
    trialEndsAt: null,
    currentPeriodEnd: new Date(Date.now() + 864000000),
  });
  prismaMock.tenantSubscription.findUnique.mockImplementation(
    prismaMock.tenantSubscription.findFirst
  );

  prismaMock.barbershopMember.findFirst.mockResolvedValue({
    id: "barber-1",
    barbershopId: "shop-dom-brio",
    isActive: true,
    user: { name: "Barbeiro João" },
    workingHours: [
      { startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null },
    ],
  });

  prismaMock.barberService.findMany.mockResolvedValue([
    { barberId: "barber-1", serviceId: "service-corte" },
  ]);

  prismaMock.service.findMany.mockResolvedValue([
    { id: "service-corte", name: "Corte", price: "50.00", durationMin: 30, isActive: true },
  ]);

  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({
    id: "user-rafael",
    name: "Rafael",
    phone: "5517999998888",
    role: "USER",
  });
  prismaMock.user.create.mockResolvedValue({
    id: "user-rafael",
    name: "Rafael",
    phone: "5517999998888",
    role: "USER",
  });

  prismaMock.appointment.create.mockResolvedValue({
    id: "app-1",
    barbershopId: "shop-dom-brio",
    memberId: "barber-1",
    customerId: "user-rafael",
    dateTime: new Date("2026-08-10T14:00:00.000Z"),
    totalPrice: "50.00",
    durationMin: 30,
    status: "CONFIRMED",
    barber: { user: { name: "Barbeiro João" } },
    customer: { id: "user-rafael", name: "Rafael", phone: "5517999998888" },
    services: [{ service: { name: "Corte" } }],
  });

  prismaMock.appointment.findFirst.mockResolvedValue(null);
  prismaMock.appointment.findMany.mockResolvedValue([]);
  prismaMock.appointment.count.mockResolvedValue(0);
  prismaMock.comanda.findMany.mockResolvedValue([]);

  prismaMock.customerBarbershopLink.findUnique.mockResolvedValue(null);
  prismaMock.customerBarbershopLink.findMany.mockResolvedValue([]);
  prismaMock.customerBarbershopLink.create.mockResolvedValue({
    id: "link-1",
    barbershopId: "shop-dom-brio",
    customerId: "user-rafael",
    whatsappVerifiedAt: null,
  });
  prismaMock.customerBarbershopLink.upsert.mockResolvedValue({
    id: "link-1",
    barbershopId: "shop-dom-brio",
    customerId: "user-rafael",
    whatsappVerifiedAt: new Date(),
  });

  prismaMock.appointmentWhatsappConfirmation.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HOTFIX — Cliente vinculado + Verificação WhatsApp única", () => {
  // ─── 1. Vínculo ─────────────────────────────────────────────────────────────
  describe("Vínculo Cliente-Barbearia", () => {
    it("1. após booking público, linkedBarbershops retorna a barbearia do slug", async () => {
      getServerSessionMock.mockResolvedValue({
        user: { id: "user-rafael", role: "USER", authLevel: "verified_link" },
      });

      prismaMock.customerBarbershopLink.findMany.mockResolvedValue([
        { barbershopId: "shop-dom-brio" },
      ]);

      const res = await getLinkedBarbershops();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.linkedBarbershopIds).toContain("shop-dom-brio");
    });

    it("2. /minha-conta bloqueia appointments para sessao phone_lookup", async () => {
      getServerSessionMock.mockResolvedValue({
        user: { id: "user-rafael", role: "USER", authLevel: "phone_lookup" },
      });

      prismaMock.appointment.findMany.mockResolvedValue([
        {
          id: "app-1",
          barbershopId: "shop-dom-brio",
          barbershop: { id: "shop-dom-brio", name: "Dom Brio", slug: "dom-brio" },
        },
      ]);

      const req = new Request("http://localhost/api/client/appointments");
      const res = await getClientAppointments(req as unknown as NextRequest);
      expect(res.status).toBe(403);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });

    it("3. tenant isolation: cliente de uma barbearia não vê outra", async () => {
      getServerSessionMock.mockResolvedValue({
        user: { id: "user-rafael", role: "USER", authLevel: "verified_link" },
      });

      prismaMock.customerBarbershopLink.findMany.mockResolvedValue([
        { barbershopId: "shop-dom-brio" },
      ]);
      prismaMock.appointment.findMany.mockResolvedValue([]);
      prismaMock.comanda.findMany.mockResolvedValue([]);

      const res = await getLinkedBarbershops();
      const data = await res.json();

      expect(data.linkedBarbershopIds).toEqual(["shop-dom-brio"]);
      expect(data.linkedBarbershopIds).not.toContain("other-shop");
    });

    it("4. telefone canônico e legado funcionam na busca de agendamentos", async () => {
      getServerSessionMock.mockResolvedValue({
        user: { id: "user-rafael", role: "USER", authLevel: "verified_link" },
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-rafael",
        phone: "5517999998888",
      });

      const req = new Request("http://localhost/api/client/appointments");
      await getClientAppointments(req as unknown as NextRequest);

      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { customerId: "user-rafael" },
              { customer: { phone: { in: expect.any(Array) } } },
            ]),
          }),
        })
      );
    });
  });

  // ─── 2. Mensagem WhatsApp ──────────────────────────────────────────────────
  describe("Mensagem WhatsApp", () => {
    it("5. wa.me message começa com 'Olá, sou Rafael.'", () => {
      const msg = buildWhatsappConfirmationMessage({
        barbershopName: "Dom Brio Barbearia",
        customerName: "Rafael",
        services: ["Corte"],
        dateTime: new Date("2026-08-10T14:00:00.000Z"),
        token: "TB-123456",
      });

      expect(msg.startsWith("Olá, sou Rafael.")).toBe(true);
    });

    it("6. mensagem contém 'Meu código de verificação do WhatsApp é: TB-...'", () => {
      const msg = buildWhatsappConfirmationMessage({
        barbershopName: "Dom Brio Barbearia",
        customerName: "Rafael",
        services: ["Corte"],
        dateTime: new Date("2026-08-10T14:00:00.000Z"),
        token: "TB-123456",
      });

      expect(msg).toContain("Meu código de verificação do WhatsApp é: TB-123456");
    });

    it("7. mensagem não contém frase errada 'Para confirmar seu agendamento, envie esse código' no tom da barbearia", () => {
      const msg = buildWhatsappConfirmationMessage({
        barbershopName: "Dom Brio Barbearia",
        customerName: "Rafael",
        services: ["Corte"],
        dateTime: new Date("2026-08-10T14:00:00.000Z"),
        token: "TB-123456",
      });

      expect(msg).not.toContain("Para confirmar seu agendamento");
    });

    it("8. wa.me segue URL encoded", () => {
      const linkObj = buildWhatsappConfirmationLink({
        barbershopPhone: "(17) 98127-5471",
        barbershopName: "Dom Brio Barbearia",
        customerName: "Rafael",
        services: ["Corte"],
        dateTime: new Date("2026-08-10T14:00:00.000Z"),
        token: "TB-123456",
      });

      expect(linkObj?.link).toContain(encodeURIComponent("Olá, sou Rafael."));
    });

    it("9. telefone destino é o WhatsApp da barbearia", () => {
      const linkObj = buildWhatsappConfirmationLink({
        barbershopPhone: "(17) 98127-5471",
        barbershopName: "Dom Brio Barbearia",
        customerName: "Rafael",
        services: ["Corte"],
        dateTime: new Date("2026-08-10T14:00:00.000Z"),
        token: "TB-123456",
      });

      expect(linkObj?.phone).toBe("5517981275471");
    });
  });

  // ─── 3. Verificação Única ──────────────────────────────────────────────────
  describe("Verificação WhatsApp Única", () => {
    it("10. primeiro agendamento de cliente não verificado cria confirmação pendente", async () => {
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValue(null);

      const req = new Request("http://localhost/api/public/barbershop/dom-brio/book", {
        method: "POST",
        headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
        body: JSON.stringify({
          memberId: "barber-1",
          serviceIds: ["service-corte"],
          dateTime: "2026-08-10T14:00:00Z",
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
        }),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const res = await publicBook(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.whatsappConfirmation).toBeDefined();
      expect(data.whatsappConfirmation.token).toMatch(/^TB-\d{6}$/);
    });

    it("11. confirmação com token marca cliente/vínculo como verificado", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "admin-1", barbershopId: "shop-dom-brio", role: "OWNER" },
      });

      prismaMock.appointment.findFirst.mockResolvedValue({
        id: "app-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappConfirmation: {
          id: "conf-1",
          appointmentId: "app-1",
          barbershopId: "shop-dom-brio",
          status: "PENDING",
          tokenHash: hashWhatsappConfirmationToken("TB-123456"),
          tokenHint: "TB-****56",
          expiresAt: new Date(Date.now() + 86400000),
          confirmedAt: null,
          confirmedById: null,
          confirmationMethod: null,
          manualConfirmationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      prismaMock.appointmentWhatsappConfirmation.update.mockResolvedValue({
        id: "conf-1",
        appointmentId: "app-1",
        barbershopId: "shop-dom-brio",
        status: "CONFIRMED",
        tokenHint: "TB-****56",
        expiresAt: new Date(),
        confirmedAt: new Date(),
        confirmedById: "admin-1",
        confirmationMethod: "TOKEN",
        manualConfirmationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/admin/appointments/app-1/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "TOKEN", token: "TB-123456" }),
      });

      const params = Promise.resolve({ id: "app-1" });
      await adminConfirmWhatsapp(req as unknown as NextRequest, { params });

      expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            barbershopId_customerId: {
              barbershopId: "shop-dom-brio",
              customerId: "user-rafael",
            },
          },
          create: expect.objectContaining({
            whatsappVerifiedById: "admin-1",
            whatsappVerificationMethod: "TOKEN",
          }),
        })
      );
    });

    it("12. confirmação sem código marca cliente/vínculo como verificado", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "admin-1", barbershopId: "shop-dom-brio", role: "MANAGER" },
      });

      prismaMock.appointment.findFirst.mockResolvedValue({
        id: "app-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappConfirmation: {
          id: "conf-1",
          appointmentId: "app-1",
          barbershopId: "shop-dom-brio",
          status: "PENDING",
          tokenHash: "hash",
          tokenHint: "TB-****56",
          expiresAt: new Date(Date.now() + 86400000),
          confirmedAt: null,
          confirmedById: null,
          confirmationMethod: null,
          manualConfirmationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      prismaMock.appointmentWhatsappConfirmation.update.mockResolvedValue({
        id: "conf-1",
        appointmentId: "app-1",
        barbershopId: "shop-dom-brio",
        status: "CONFIRMED",
        tokenHint: "TB-****56",
        expiresAt: new Date(),
        confirmedAt: new Date(),
        confirmedById: "admin-1",
        confirmationMethod: "MANUAL_OVERRIDE",
        manualConfirmationReason: "Cliente presencial",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/admin/appointments/app-1/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "MANUAL_OVERRIDE", reason: "Cliente presencial" }),
      });

      const params = Promise.resolve({ id: "app-1" });
      await adminConfirmWhatsapp(req as unknown as NextRequest, { params });

      expect(prismaMock.customerBarbershopLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            whatsappVerificationMethod: "MANUAL_OVERRIDE",
          }),
        })
      );
    });

    it("13. segundo agendamento do mesmo cliente/barbearia não cria nova confirmação pendente", async () => {
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValue({
        id: "link-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappVerifiedAt: new Date("2026-07-01T10:00:00Z"),
      });

      const req = new Request("http://localhost/api/public/barbershop/dom-brio/book", {
        method: "POST",
        headers: { "Idempotency-Key": "22222222-2222-4222-8222-222222222222" },
        body: JSON.stringify({
          memberId: "barber-1",
          serviceIds: ["service-corte"],
          dateTime: "2026-08-15T14:00:00Z",
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
        }),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const res = await publicBook(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.whatsappConfirmation).toBeUndefined();
      expect(prismaMock.appointmentWhatsappConfirmation.create).not.toHaveBeenCalled();
    });

    it("14. segundo agendamento não mostra token", async () => {
      prismaMock.customerBarbershopLink.findUnique.mockResolvedValue({
        id: "link-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappVerifiedAt: new Date(),
      });

      const req = new Request("http://localhost/api/public/barbershop/dom-brio/book", {
        method: "POST",
        headers: { "Idempotency-Key": "33333333-3333-4333-8333-333333333333" },
        body: JSON.stringify({
          memberId: "barber-1",
          serviceIds: ["service-corte"],
          dateTime: "2026-08-15T14:00:00Z",
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
        }),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const res = await publicBook(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(data.whatsappConfirmation).toBeUndefined();
    });

    it("15. appointment antigo com confirmation ainda funciona ao confirmar no admin", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "admin-1", barbershopId: "shop-dom-brio", role: "OWNER" },
      });

      prismaMock.appointment.findFirst.mockResolvedValue({
        id: "old-app",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappConfirmation: {
          id: "conf-old",
          appointmentId: "old-app",
          barbershopId: "shop-dom-brio",
          status: "CONFIRMED",
          tokenHint: "TB-****56",
          expiresAt: new Date(),
          confirmedAt: new Date(),
          confirmedById: "admin-1",
          confirmationMethod: "TOKEN",
          manualConfirmationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const req = new Request("http://localhost/api/admin/appointments/old-app/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "TOKEN", token: "TB-123456" }),
      });

      const params = Promise.resolve({ id: "old-app" });
      const res = await adminConfirmWhatsapp(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.whatsappConfirmation.status).toBe("CONFIRMED");
    });

    it("16. tokenHash não aparece em response", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "admin-1", barbershopId: "shop-dom-brio", role: "OWNER" },
      });

      prismaMock.appointment.findFirst.mockResolvedValue({
        id: "app-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappConfirmation: {
          id: "conf-1",
          appointmentId: "app-1",
          barbershopId: "shop-dom-brio",
          status: "CONFIRMED",
          tokenHash: "super-secret-hash",
          tokenHint: "TB-****56",
          expiresAt: new Date(),
          confirmedAt: new Date(),
          confirmedById: "admin-1",
          confirmationMethod: "TOKEN",
          manualConfirmationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const req = new Request("http://localhost/api/admin/appointments/app-1/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "TOKEN", token: "TB-123456" }),
      });

      const params = Promise.resolve({ id: "app-1" });
      const res = await adminConfirmWhatsapp(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(JSON.stringify(data)).not.toContain("tokenHash");
      expect(JSON.stringify(data)).not.toContain("super-secret-hash");
    });

    it("17. BARBER no endpoint admin continua bloqueado", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "barber-1", barbershopId: "shop-dom-brio", role: "BARBER" },
      });

      const req = new Request("http://localhost/api/admin/appointments/app-1/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "TOKEN", token: "TB-123456" }),
      });

      const params = Promise.resolve({ id: "app-1" });
      const res = await adminConfirmWhatsapp(req as unknown as NextRequest, { params });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("FORBIDDEN");
    });
  });

  // ─── 4. Regressão ─────────────────────────────────────────────────────────
  describe("Regressão", () => {
    it("18. booking público continua funcionando", async () => {
      const req = new Request("http://localhost/api/public/barbershop/dom-brio/book", {
        method: "POST",
        headers: { "Idempotency-Key": "44444444-4444-4444-8444-444444444444" },
        body: JSON.stringify({
          memberId: "barber-1",
          serviceIds: ["service-corte"],
          dateTime: "2026-08-10T14:00:00Z",
          customerName: "Rafael",
          customerPhone: "(17) 99888-7766",
        }),
      });

      const params = Promise.resolve({ slug: "dom-brio" });
      const res = await publicBook(req as unknown as NextRequest, { params });
      expect(res.status).toBe(201);
    });

    it("19. WhatsApp confirmation admin continua funcionando", async () => {
      getAdminSessionMock.mockResolvedValue({
        data: { userId: "admin-1", barbershopId: "shop-dom-brio", role: "OWNER" },
      });

      prismaMock.appointment.findFirst.mockResolvedValue({
        id: "app-1",
        barbershopId: "shop-dom-brio",
        customerId: "user-rafael",
        whatsappConfirmation: {
          id: "conf-1",
          appointmentId: "app-1",
          barbershopId: "shop-dom-brio",
          status: "PENDING",
          tokenHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          tokenHint: "TB-****56",
          expiresAt: new Date(Date.now() + 86400000),
          confirmedAt: null,
          confirmedById: null,
          confirmationMethod: null,
          manualConfirmationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      prismaMock.appointmentWhatsappConfirmation.update.mockResolvedValue({
        id: "conf-1",
        appointmentId: "app-1",
        barbershopId: "shop-dom-brio",
        status: "CONFIRMED",
        tokenHint: "TB-****56",
        expiresAt: new Date(),
        confirmedAt: new Date(),
        confirmedById: "admin-1",
        confirmationMethod: "MANUAL_OVERRIDE",
        manualConfirmationReason: "OK",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/admin/appointments/app-1/confirm-whatsapp", {
        method: "POST",
        body: JSON.stringify({ mode: "MANUAL_OVERRIDE", reason: "OK" }),
      });

      const params = Promise.resolve({ id: "app-1" });
      const res = await adminConfirmWhatsapp(req as unknown as NextRequest, { params });
      expect(res.status).toBe(200);
    });

    it("20. /api/client/appointments continua respeitando privacidade", async () => {
      getServerSessionMock.mockResolvedValue({
        user: { id: "user-rafael", role: "USER", authLevel: "phone_lookup" },
      });

      prismaMock.appointment.findMany.mockResolvedValue([]);

      const req = new Request("http://localhost/api/client/appointments");
      await getClientAppointments(req as unknown as NextRequest);

      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });
  });
});
