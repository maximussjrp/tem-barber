import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { normalizePhone, phoneSearchFragments, phonesMatch } from "@/lib/customers";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findMany: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { GET as SEARCH_CLIENTS } from "@/app/api/admin/clients/search/route";

describe("normalizacao de telefone", () => {
  it("remove mascara e prefixo brasileiro quando aplicavel", () => {
    expect(normalizePhone("(17) 99999-9999")).toBe("17999999999");
    expect(normalizePhone("+55 17 99999-9999")).toBe("17999999999");
    expect(normalizePhone("55 17 99999-9999")).toBe("17999999999");
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
});

describe("busca admin de clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-a", role: "OWNER", memberId: "member-a", barbershopId: "shop-a" },
    });
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        customerId: "customer-a",
        dateTime: new Date("2026-07-20T13:00:00.000Z"),
        customer: { id: "customer-a", name: "Joao Martins", phone: "+55 (17) 99999-9999" },
      },
      {
        customerId: "customer-b",
        dateTime: new Date("2026-07-19T13:00:00.000Z"),
        customer: { id: "customer-b", name: "Maria Silva", phone: "11988887777" },
      },
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
          OR: expect.arrayContaining([
            { customer: { name: { contains: "joao", mode: "insensitive" } } },
          ]),
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
          OR: expect.arrayContaining([
            { customer: { phone: { contains: "17999999999" } } },
            { customer: { phone: { contains: "99999999" } } },
            { customer: { phone: { contains: "99999" } } },
          ]),
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
