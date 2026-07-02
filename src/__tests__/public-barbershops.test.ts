import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { GET as listPublicBarbershops } from "@/app/api/public/barbershops/route";
import { POST as clientLookup } from "@/app/api/public/client-lookup/route";

function postLookup(phone: string) {
  return new NextRequest("http://localhost/api/public/client-lookup", {
    method: "POST",
    body: JSON.stringify({ name: "Cliente", phone }),
  });
}

describe("barbearias publicas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.barbershop.findMany.mockResolvedValue([]);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
  });

  it("filtra barbearias inativas, temporarias e tenants suspensos na listagem publica", async () => {
    await listPublicBarbershops();

    expect(prismaMock.barbershop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          slug: { not: "" },
          subscriptions: expect.objectContaining({
            none: expect.objectContaining({
              status: { in: ["SUSPENDED", "CANCELED", "EXPIRED"] },
            }),
          }),
          NOT: expect.arrayContaining([
            { name: { contains: "Smoke", mode: "insensitive" } },
            { slug: { contains: "Smoke", mode: "insensitive" } },
            { name: { contains: "Test", mode: "insensitive" } },
            { slug: { contains: "Temp", mode: "insensitive" } },
          ]),
        }),
      })
    );
  });

  it("client lookup busca por variantes normalizadas do telefone", async () => {
    await clientLookup(postLookup("+55 (79) 88240-050"));

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        phone: {
          in: expect.arrayContaining(["7988240050", "557988240050", "79988240050"]),
        },
      },
    });
  });

  it("client lookup retorna somente barbearias publicaveis vinculadas", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-a" });
    prismaMock.appointment.findMany.mockResolvedValue([
      { barbershop: { id: "shop-a", name: "Don Brio", slug: "don-brio" } },
    ]);

    const response = await clientLookup(postLookup("(11) 99999-9999"));
    const data = await response.json();

    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: "user-a",
          barbershop: expect.objectContaining({ active: true }),
        }),
      })
    );
    expect(data.linkedBarbershops).toEqual([
      { id: "shop-a", name: "Don Brio", slug: "don-brio" },
    ]);
  });

  it("client lookup sem vinculo nao retorna lista global", async () => {
    const response = await clientLookup(postLookup("(79) 88240-050"));
    const data = await response.json();

    expect(data.linkedBarbershops).toEqual([]);
    expect(prismaMock.barbershop.findMany).not.toHaveBeenCalled();
  });
});
