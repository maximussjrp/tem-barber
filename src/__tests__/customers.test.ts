import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { normalizePhone, phoneLookupVariants, phoneSearchFragments, phonesMatch, getClientFirstName, buildClientWhatsappMessage } from "@/lib/customers";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findMany: vi.fn() },
    customerBarbershopLink: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
    customerClubSubscription: { findMany: vi.fn() },
    customerContactLog: { groupBy: vi.fn() },
    barbershopBlockedCustomer: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET as SEARCH_CLIENTS } from "@/app/api/admin/clients/search/route";

describe("normalizacao de telefone", () => {
  it("remove mascara e prefixo brasileiro quando aplicavel", () => {
    expect(normalizePhone("(17) 99999-9999")).toBe("5517999999999");
    expect(normalizePhone("+55 17 99999-9999")).toBe("5517999999999");
    expect(normalizePhone("55 17 99999-9999")).toBe("5517999999999");
  });

  it("compara telefones equivalentes", () => {
    expect(phonesMatch("+55 (17) 99999-9999", "17 99999-9999")).toBe(true);
    expect(phonesMatch("(17) 99999-9999", "(11) 99999-9999")).toBe(false);
  });

  it("gera fragmentos para buscar telefone com ou sem mascara", () => {
    expect(phoneSearchFragments("+55 17 99999-9999")).toEqual(
      expect.arrayContaining(["17999999999", "99999999", "99999"])
    );
  });

  it("gera variantes com DDI e nono digito", () => {
    expect(phoneLookupVariants("+55 (79) 88240-050")).toEqual(["5579988240050", "79988240050"]);
  });
});

describe("busca admin de clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-a", role: "OWNER", memberId: "member-a", barbershopId: "shop-a" },
    });
    prismaMock.customerBarbershopLink.findMany.mockResolvedValue([]);
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([{ customerId: "customer-a" }, { customerId: "customer-b" }])
      .mockResolvedValueOnce([
        { customerId: "customer-a", dateTime: new Date("2026-07-20T13:00:00.000Z"), status: "COMPLETED" },
        { customerId: "customer-b", dateTime: new Date("2026-07-19T13:00:00.000Z"), status: "COMPLETED" },
      ]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
    prismaMock.customerContactLog.groupBy.mockResolvedValue([]);
    prismaMock.barbershopBlockedCustomer.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "customer-a", name: "Joao Martins", phone: "+55 (17) 99999-9999", email: null, createdAt: new Date() },
      { id: "customer-b", name: "Maria Silva", phone: "11988887777", email: null, createdAt: new Date() },
    ]);
  });

  it("filtra por nome dentro da barbearia da sessao", async () => {
    const response = await SEARCH_CLIENTS(
      new NextRequest("http://localhost/api/admin/clients/search?q=joao")
    );
    const data = await response.json();

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-a",
        }),
      })
    );
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0]).toMatchObject({ id: "customer-a", name: "Joao Martins" });
  });

  it("filtra por telefone parcial normalizado", async () => {
    const response = await SEARCH_CLIENTS(
      new NextRequest("http://localhost/api/admin/clients/search?q=99999")
    );
    const data = await response.json();

    expect(data.clients).toHaveLength(1);
    expect(data.clients[0]).toMatchObject({ id: "customer-a" });
  });

  it("filtra por telefone com mascara e prefixo normalizado", async () => {
    const response = await SEARCH_CLIENTS(
      new NextRequest("http://localhost/api/admin/clients/search?q=%2B55%2017%2099999-9999")
    );
    const data = await response.json();

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: "shop-a",
        }),
      })
    );
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0]).toMatchObject({ id: "customer-a" });
  });

  it("busca vazia nao retorna lista global", async () => {
    const response = await SEARCH_CLIENTS(new NextRequest("http://localhost/api/admin/clients/search?q="));
    const data = await response.json();

    expect(data.clients).toEqual([]);
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });
});

describe("primeiro nome e templates de whatsapp", () => {
  it("extrai primeiro nome corretamente tratando sufixos e numeros", () => {
    expect(getClientFirstName("Carlos cliente")).toBe("Carlos");
    expect(getClientFirstName("Carlos cl")).toBe("Carlos");
    expect(getClientFirstName("Carlos 9190")).toBe("Carlos");
    expect(getClientFirstName("9190 Carlos")).toBe("Carlos");
    expect(getClientFirstName("Cliente Carlos")).toBe("Carlos");
    expect(getClientFirstName("João Silva")).toBe("João");
    expect(getClientFirstName("  João   Silva")).toBe("João");
    expect(getClientFirstName("junin")).toBe("junin");
    expect(getClientFirstName("")).toBe(null);
    expect(getClientFirstName(null)).toBe(null);
    expect(getClientFirstName(undefined)).toBe(null);
  });

  it("gera APPOINTMENT_DIRECT com link absoluto e primeiro nome", () => {
    const msg = buildClientWhatsappMessage({
      template: "APPOINTMENT_DIRECT",
      customerName: "Carlos cliente",
      barbershopName: "Dom Brio",
      bookingUrl: "https://app.tembarber.com.br/don-brio/agendar"
    });
    expect(msg).toContain("Oi, Carlos.");
    expect(msg).toContain("https://app.tembarber.com.br/don-brio/agendar");
    expect(msg).not.toContain("Carlos cliente");
    expect(msg).not.toContain("Agendamento: /");
  });

  it("gera template fallback sem nome quando nome e vazio/null", () => {
    const msg = buildClientWhatsappMessage({
      template: "APPOINTMENT_DIRECT",
      customerName: "",
      barbershopName: "Dom Brio",
      bookingUrl: "https://app.tembarber.com.br/don-brio/agendar"
    });
    expect(msg).toContain("Oi, tudo bem?");
    expect(msg).toContain("https://app.tembarber.com.br/don-brio/agendar");
  });

  it("preserva aliases legados invite/week/return/feedback", () => {
    const msgInvite = buildClientWhatsappMessage({
      template: "invite",
      customerName: "Carlos cliente",
      barbershopName: "Dom Brio",
      bookingUrl: "https://app.tembarber.com.br/don-brio/agendar"
    });
    expect(msgInvite).toContain("Oi, Carlos.");
    expect(msgInvite).toContain("https://app.tembarber.com.br/don-brio/agendar");

    const msgFeedback = buildClientWhatsappMessage({
      template: "feedback",
      customerName: "Adriano Guarinieri",
      barbershopName: "Dom Brio",
      bookingUrl: "https://app.tembarber.com.br/don-brio/agendar"
    });
    expect(msgFeedback).toContain("Oi, Adriano.");
    expect(msgFeedback).toContain("Passando para saber se ficou tudo certo");
  });
});
