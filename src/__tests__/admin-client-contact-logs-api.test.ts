import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    customerBarbershopLink: { findUnique: vi.fn() },
    appointment: { count: vi.fn() },
    comanda: { count: vi.fn() },
    customerClubSubscription: { count: vi.fn() },
    customerContactLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET, POST } from "@/app/api/admin/clients/[id]/contact-logs/route";

function req(url: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function session() {
  getAdminSessionMock.mockResolvedValue({
    error: null,
    data: { userId: "admin-1", role: "OWNER", memberId: "member-1", barbershopId: "shop-a" },
  });
}

function linkedCustomer() {
  prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce({ id: "link-1" });
  prismaMock.appointment.count.mockResolvedValueOnce(0);
  prismaMock.comanda.count.mockResolvedValueOnce(0);
  prismaMock.customerClubSubscription.count.mockResolvedValueOnce(0);
}

function unlinkedCustomer() {
  prismaMock.customerBarbershopLink.findUnique.mockResolvedValueOnce(null);
  prismaMock.appointment.count.mockResolvedValueOnce(0);
  prismaMock.comanda.count.mockResolvedValueOnce(0);
  prismaMock.customerClubSubscription.count.mockResolvedValueOnce(0);
}

function createdLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    channel: "WHATSAPP",
    templateKey: "WEEK_OPEN",
    templateLabel: "Agenda da semana aberta",
    note: "Cliente respondeu",
    contactedAt: new Date("2026-08-05T21:30:00.000Z"),
    createdAt: new Date("2026-08-05T21:31:00.000Z"),
    createdByUser: { id: "admin-1", name: "Admin" },
    createdByMember: { id: "member-1", user: { name: "Operador" } },
    ...overrides,
  };
}

describe("P1 Clientes/CRM LOTE B1 contact logs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    session();
  });

  it("migration cria tabela nova, cinco indices e nao adiciona colunas em tabelas existentes", () => {
    const sql = readFileSync("prisma/migrations/20260805213000_add_customer_contact_logs/migration.sql", "utf8");
    expect(sql).toContain('CREATE TABLE "customer_contact_logs"');
    expect((sql.match(/CREATE INDEX/g) ?? [])).toHaveLength(5);
    expect(sql).toContain('FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"');
    expect(sql).toContain('FOREIGN KEY ("customer_id") REFERENCES "users"');
    expect(sql).toContain('FOREIGN KEY ("created_by_user_id") REFERENCES "users"');
    expect(sql).toContain('FOREIGN KEY ("created_by_member_id") REFERENCES "barbershop_members"');
    expect(sql).not.toMatch(/ALTER TABLE "customer_barbershop_links" ADD COLUMN/);
  });

  it("GET exige sessao admin", async () => {
    getAdminSessionMock.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Nao autenticado." }, { status: 401 }),
      data: null,
    });

    const response = await GET(req("http://localhost/api/admin/clients/client-1/contact-logs"), {
      params: Promise.resolve({ id: "client-1" }),
    });

    expect(response.status).toBe(401);
    expect(prismaMock.customerContactLog.findMany).not.toHaveBeenCalled();
  });

  it("GET valida vinculo tenant, filtra por barbershopId e ordena desc", async () => {
    linkedCustomer();
    prismaMock.customerContactLog.findMany.mockResolvedValueOnce([
      createdLog({ id: "new", contactedAt: new Date("2026-08-06T12:00:00.000Z") }),
      createdLog({ id: "old", contactedAt: new Date("2026-08-05T12:00:00.000Z") }),
    ]);

    const response = await GET(req("http://localhost/api/admin/clients/client-1/contact-logs"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.customerContactLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barbershopId: "shop-a", customerId: "client-1" },
        orderBy: { contactedAt: "desc" },
      })
    );
    expect(data.logs.map((log: { id: string }) => log.id)).toEqual(["new", "old"]);
  });

  it("GET retorna vazio quando cliente vinculado nao tem logs", async () => {
    linkedCustomer();
    prismaMock.customerContactLog.findMany.mockResolvedValueOnce([]);

    const response = await GET(req("http://localhost/api/admin/clients/client-1/contact-logs"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.logs).toEqual([]);
  });

  it("GET e POST rejeitam cliente sem vinculo com tenant", async () => {
    unlinkedCustomer();
    const getResponse = await GET(req("http://localhost/api/admin/clients/other/contact-logs"), {
      params: Promise.resolve({ id: "other" }),
    });
    expect(getResponse.status).toBe(404);

    unlinkedCustomer();
    const postResponse = await POST(req("http://localhost/api/admin/clients/other/contact-logs", "POST", {
      channel: "WHATSAPP",
      templateKey: "WEEK_OPEN",
    }), {
      params: Promise.resolve({ id: "other" }),
    });
    expect(postResponse.status).toBe(404);
    expect(prismaMock.customerContactLog.create).not.toHaveBeenCalled();
  });

  it("POST cria log manual com barbershopId da sessao e templateLabel derivado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T21:30:00.000Z"));
    linkedCustomer();
    prismaMock.customerContactLog.create.mockResolvedValueOnce(createdLog());

    const response = await POST(req("http://localhost/api/admin/clients/client-1/contact-logs", "POST", {
      barbershopId: "evil-shop",
      channel: "WHATSAPP",
      templateKey: "WEEK_OPEN",
      templateLabel: "Label adulterado",
      note: "Cliente respondeu",
    }), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.templateLabel).toBe("Agenda da semana aberta");
    expect(prismaMock.customerContactLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barbershopId: "shop-a",
          customerId: "client-1",
          createdByUserId: "admin-1",
          createdByMemberId: "member-1",
          channel: "WHATSAPP",
          templateKey: "WEEK_OPEN",
          templateLabel: "Agenda da semana aberta",
          note: "Cliente respondeu",
        }),
      })
    );
  });

  it("POST valida note, channel, templateKey e contactedAt futuro", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T21:30:00.000Z"));

    for (const body of [
      { channel: "SMS", templateKey: "WEEK_OPEN" },
      { channel: "WHATSAPP", templateKey: "BAD" },
      { channel: "WHATSAPP", templateKey: "WEEK_OPEN", note: "x".repeat(501) },
      { channel: "WHATSAPP", templateKey: "WEEK_OPEN", contactedAt: "2026-08-05T21:36:00.000Z" },
    ]) {
      linkedCustomer();
      const response = await POST(req("http://localhost/api/admin/clients/client-1/contact-logs", "POST", body), {
        params: Promise.resolve({ id: "client-1" }),
      });
      expect(response.status).toBe(400);
    }

    expect(prismaMock.customerContactLog.create).not.toHaveBeenCalled();
  });

  it("POST aceita note opcional e contactedAt ausente usa now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T21:30:00.000Z"));
    linkedCustomer();
    prismaMock.customerContactLog.create.mockResolvedValueOnce(createdLog({ note: null }));

    const response = await POST(req("http://localhost/api/admin/clients/client-1/contact-logs", "POST", {
      channel: "PHONE",
      templateKey: "CUSTOM",
    }), {
      params: Promise.resolve({ id: "client-1" }),
    });

    expect(response.status).toBe(201);
    expect(prismaMock.customerContactLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactedAt: new Date("2026-08-05T21:30:00.000Z"),
          note: null,
        }),
      })
    );
  });
});
