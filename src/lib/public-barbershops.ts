import type { Prisma, SubscriptionStatus } from "@prisma/client";

const BLOCKED_PUBLIC_BARBERSHOP_TERMS = [
  "Smoke",
  "Test",
  "Temp",
  "Tempor",
  "Exemplo",
  "Temporário",
  "Temporária",
  "Placeholder",
];
const BLOCKED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "SUSPENDED",
  "CANCELED",
  "EXPIRED",
];

const LISTABLE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE"];

export function sanitizeBarbershopSlug(slug: string | null | undefined) {
  const value = slug?.trim() ?? "";
  return /^[a-z0-9-]+$/.test(value) ? value : null;
}

export function publicBarbershopWhere(): Prisma.BarbershopWhereInput {
  const now = new Date();

  return {
    active: true,
    slug: { not: "" },
    // Excluir defaults/placeholders que indicam cadastro de onboarding incompleto
    zipCode: { not: "00000000" },
    street: { not: "Rua Não Cadastrada" },
    city: { not: "Cidade Exemplo" },
    state: { not: "UF" },
    subscriptions: {
      some: {
        status: { in: LISTABLE_SUBSCRIPTION_STATUSES },
        OR: [
          {
            status: "TRIAL",
            OR: [{ trialEndsAt: null }, { trialEndsAt: { gte: now } }],
          },
          {
            status: "ACTIVE",
            currentPeriodEnd: { gte: now },
          },
          {
            status: "PAST_DUE",
            gracePeriodEndsAt: { gte: now },
          },
        ],
      },
    },
    NOT: [
      {
        subscriptions: {
          some: {
            status: { in: BLOCKED_SUBSCRIPTION_STATUSES },
          },
        },
      },
      ...BLOCKED_PUBLIC_BARBERSHOP_TERMS.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { slug: { contains: term, mode: "insensitive" as const } },
        { city: { contains: term, mode: "insensitive" as const } },
      ]),
    ],
  };
}
