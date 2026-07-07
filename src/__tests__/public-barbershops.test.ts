import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/public-rate-limit";
import { isPublicBarbershop } from "@/lib/public-barbershops";

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
          zipCode: { not: "00000000" },
          street: { not: "Rua Não Cadastrada" },
          city: { not: "Cidade Exemplo" },
          state: { not: "UF" },
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
            { city: { contains: "Smoke", mode: "insensitive" } },
            { name: { contains: "Placeholder", mode: "insensitive" } },
            { slug: { contains: "Placeholder", mode: "insensitive" } },
            { city: { contains: "Placeholder", mode: "insensitive" } },
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

describe("helper isPublicBarbershop", () => {
  const validBarbershop = {
    active: true,
    name: "Don Brio",
    slug: "don-brio",
    city: "São Paulo",
    zipCode: "12345-678",
    street: "Av Paulista",
    state: "SP",
    phone: "11999999999",
    subscriptions: [
      {
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60), // futuro
      }
    ]
  };

  it("permite barbearia totalmente valida", () => {
    expect(isPublicBarbershop(validBarbershop)).toBe(true);
  });

  it("permite barbearia com TRIAL ativo", () => {
    const trialShop = {
      ...validBarbershop,
      subscriptions: [
        {
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() + 1000 * 60 * 60),
        }
      ]
    };
    expect(isPublicBarbershop(trialShop)).toBe(true);
  });

  it("bloqueia barbearias inativas", () => {
    const inactiveShop = { ...validBarbershop, active: false };
    expect(isPublicBarbershop(inactiveShop)).toBe(false);
  });

  it("bloqueia barbearias com termos proibidos em tokens inteiros", () => {
    const testShop = { ...validBarbershop, name: "Barbearia de Teste" };
    expect(isPublicBarbershop(testShop)).toBe(false);
  });

  it("nao bloqueia barbearias por substrings que nao sao tokens inteiros (evitar falsos positivos)", () => {
    const contestShop = { ...validBarbershop, name: "Contest Barber" };
    const tempestadeShop = { ...validBarbershop, name: "Tempestade Barber" };
    const trialtoShop = { ...validBarbershop, name: "Trialto Coiffure" };

    expect(isPublicBarbershop(contestShop)).toBe(true);
    expect(isPublicBarbershop(tempestadeShop)).toBe(true);
    expect(isPublicBarbershop(trialtoShop)).toBe(true);
  });

  it("bloqueia barbearias com Cidade Exemplo ou outros placeholders", () => {
    const placeholderCity = { ...validBarbershop, city: "Cidade Exemplo" };
    const placeholderZip = { ...validBarbershop, zipCode: "00000000" };
    const placeholderStreet = { ...validBarbershop, street: "Rua Não Cadastrada" };
    const placeholderState = { ...validBarbershop, state: "UF" };
    const placeholderPhone = { ...validBarbershop, phone: "00000000000" };

    expect(isPublicBarbershop(placeholderCity)).toBe(false);
    expect(isPublicBarbershop(placeholderZip)).toBe(false);
    expect(isPublicBarbershop(placeholderStreet)).toBe(false);
    expect(isPublicBarbershop(placeholderState)).toBe(false);
    expect(isPublicBarbershop(placeholderPhone)).toBe(false);
  });

  it("permite barbearias com campos opcionais vazios se dados essenciais estiverem preenchidos", () => {
    const optionalEmptyShop = {
      ...validBarbershop,
      coverUrl: null,
      logoUrl: null,
      description: null,
    };
    expect(isPublicBarbershop(optionalEmptyShop)).toBe(true);
  });

  it("bloqueia barbearias com assinatura ACTIVE expirada", () => {
    const expiredActiveShop = {
      ...validBarbershop,
      subscriptions: [
        {
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() - 1000 * 60), // passado
        }
      ]
    };
    expect(isPublicBarbershop(expiredActiveShop)).toBe(false);
  });

  it("bloqueia barbearias com assinatura TRIAL expirada", () => {
    const expiredTrialShop = {
      ...validBarbershop,
      subscriptions: [
        {
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() - 1000 * 60), // passado
        }
      ]
    };
    expect(isPublicBarbershop(expiredTrialShop)).toBe(false);
  });

  it("bloqueia barbearias com assinatura PAST_DUE fora do periodo de graca", () => {
    const expiredPastDueShop = {
      ...validBarbershop,
      subscriptions: [
        {
          status: "PAST_DUE",
          gracePeriodEndsAt: new Date(Date.now() - 1000 * 60), // passado
        }
      ]
    };
    expect(isPublicBarbershop(expiredPastDueShop)).toBe(false);
  });

  it("bloqueia barbearias com assinatura em status proibido (SUSPENDED)", () => {
    const suspendedShop = {
      ...validBarbershop,
      subscriptions: [
        {
          status: "SUSPENDED",
          currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60),
        }
      ]
    };
    expect(isPublicBarbershop(suspendedShop)).toBe(false);
  });

  it("permite zovisk-cortes se regularizada (sem blacklist estatica de slug)", () => {
    const zoviskRegularized = {
      ...validBarbershop,
      slug: "zovisk-cortes",
      name: "Zovisk Cortes",
      city: "São José do Rio Preto",
      subscriptions: [
        {
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60),
        }
      ]
    };
    expect(isPublicBarbershop(zoviskRegularized)).toBe(true);
  });

  it("bloqueia zovisk-cortes se estiver com dados incompletos ou placeholders", () => {
    const zoviskIncomplete = {
      ...validBarbershop,
      slug: "zovisk-cortes",
      name: "Zovisk Cortes",
      city: "Cidade Exemplo",
      subscriptions: [
        {
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60),
        }
      ]
    };
    expect(isPublicBarbershop(zoviskIncomplete)).toBe(false);
  });
});
