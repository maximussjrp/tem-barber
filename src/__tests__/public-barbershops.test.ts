import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/public-rate-limit";

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

function getListRequest() {
  return new NextRequest("http://localhost/api/public/barbershops", { method: "GET" });
}

function postLookup(phone: string) {
  return new NextRequest("http://localhost/api/public/client-lookup", {
    method: "POST",
    body: JSON.stringify({ name: "Cliente", phone }),
  });
}

describe("barbearias publicas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    prismaMock.barbershop.findMany.mockResolvedValue([]);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
  });

  it("filtra barbearias inativas, temporarias e tenants suspensos na listagem publica", async () => {
    await listPublicBarbershops(getListRequest());

    expect(prismaMock.barbershop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          slug: { not: "" },
          subscriptions: expect.objectContaining({
            some: expect.objectContaining({
              status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] },
              OR: expect.arrayContaining([
                expect.objectContaining({
                  status: "TRIAL",
                }),
                expect.objectContaining({
                  status: "ACTIVE",
                }),
                expect.objectContaining({
                  status: "PAST_DUE",
                  gracePeriodEndsAt: expect.objectContaining({ gte: expect.any(Date) }),
                }),
              ]),
            }),
          }),
          NOT: expect.arrayContaining([
            expect.objectContaining({
              subscriptions: expect.objectContaining({
                some: expect.objectContaining({
                  status: { in: ["SUSPENDED", "CANCELED", "EXPIRED"] },
                }),
              }),
            }),
            { name: { contains: "Smoke", mode: "insensitive" } },
            { slug: { contains: "Smoke", mode: "insensitive" } },
            { name: { contains: "Test", mode: "insensitive" } },
            { slug: { contains: "Temp", mode: "insensitive" } },
          ]),
        }),
      })
    );
  });

  it("aplica regra temporal para PAST_DUE com grace period no filtro publico", async () => {
    await listPublicBarbershops(getListRequest());

    const where = prismaMock.barbershop.findMany.mock.calls[0][0].where;
    const subscriptionBranches = where.subscriptions.some.OR;

    expect(subscriptionBranches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "PAST_DUE",
          gracePeriodEndsAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      ])
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

  it("aplica rate limit basico no client lookup", async () => {
    let lastResponse = await clientLookup(postLookup("(11) 99999-9999"));

    for (let i = 0; i < 20; i += 1) {
      lastResponse = await clientLookup(postLookup("(11) 99999-9999"));
    }

    expect(lastResponse.status).toBe(429);
  });
});
