import type { Prisma, SubscriptionStatus } from "@prisma/client";

const BLOCKED_PUBLIC_BARBERSHOP_TERMS = ["Smoke", "Test", "Temp", "Tempor"];
const BLOCKED_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "SUSPENDED",
  "CANCELED",
  "EXPIRED",
];

export function sanitizeBarbershopSlug(slug: string | null | undefined) {
  const value = slug?.trim() ?? "";
  return /^[a-z0-9-]+$/.test(value) ? value : null;
}

export function publicBarbershopWhere(): Prisma.BarbershopWhereInput {
  return {
    active: true,
    slug: { not: "" },
    subscriptions: {
      none: {
        status: { in: BLOCKED_SUBSCRIPTION_STATUSES },
      },
    },
    NOT: BLOCKED_PUBLIC_BARBERSHOP_TERMS.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } },
      { slug: { contains: term, mode: "insensitive" as const } },
    ]),
  };
}
