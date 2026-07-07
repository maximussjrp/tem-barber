import type { Prisma, SubscriptionStatus } from "@prisma/client";

// Termos totalmente bloqueados como tokens inteiros
const BLOCKED_TOKENS = new Set([
  "smoke",
  "test",
  "teste",
  "temp",
  "tempor",
  "temporario",
  "temporaria",
  "placeholder",
  "fake",
  "demo",
  "trial",
  "modelo",
  "exemplo"
]);

// Termos seguros para pré-filtragem por substring no banco (não causam falsos positivos)
const SAFE_DB_BLOCKED_SUBSTRINGS = ["Smoke", "Placeholder"];

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

export function isBlockedText(text: string | null | undefined): boolean {
  if (!text) return false;

  // Normalizar removendo acentos e convertendo para minúsculas
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Dividir o texto por caracteres não-alfanuméricos
  const tokens = normalized.split(/[^a-z0-9]+/);

  // Se algum token coincidir exatamente com os termos bloqueados
  return tokens.some(token => BLOCKED_TOKENS.has(token));
}

export function isPublicBarbershop(barbershop: any): boolean {
  if (!barbershop) return false;

  // 1. Ativa (se definido)
  if (barbershop.active !== undefined && !barbershop.active) return false;

  // 2. Nome válido (se definido)
  if (barbershop.name !== undefined) {
    if (!barbershop.name || !barbershop.name.trim() || isBlockedText(barbershop.name)) {
      return false;
    }
  }

  // 3. Slug válido (se definido)
  if (barbershop.slug !== undefined) {
    const safeSlug = sanitizeBarbershopSlug(barbershop.slug);
    if (!safeSlug || isBlockedText(safeSlug)) return false;
  }

  // 4. Cidade válida (se definido)
  if (barbershop.city !== undefined) {
    const city = barbershop.city?.trim() ?? "";
    if (!city || city === "Cidade Exemplo" || isBlockedText(city)) return false;
  }

  // 5. Excluir placeholders específicos (apenas se forem exatamente os placeholders e estiverem definidos)
  if (barbershop.zipCode !== undefined && barbershop.zipCode === "00000000") return false;
  if (barbershop.street !== undefined && barbershop.street === "Rua Não Cadastrada") return false;
  if (barbershop.state !== undefined && barbershop.state === "UF") return false;
  if (barbershop.phone !== undefined) {
    const phone = barbershop.phone?.trim() ?? "";
    if (phone === "00000000000" || phone === "0000000000" || phone === "00000000") return false;
  }

  // 6. Validar assinaturas (se definido)
  if (barbershop.subscriptions !== undefined) {
    const subscriptions = barbershop.subscriptions ?? [];
    const hasBlockedSub = subscriptions.some((sub: any) =>
      BLOCKED_SUBSCRIPTION_STATUSES.includes(sub.status)
    );
    if (hasBlockedSub) return false;

    const now = new Date();
    const hasValidSub = subscriptions.some((sub: any) => {
      if (!LISTABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) return false;

      const trialEnds = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
      const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
      const gracePeriodEnds = sub.gracePeriodEndsAt ? new Date(sub.gracePeriodEndsAt) : null;

      if (sub.status === "TRIAL") {
        return !trialEnds || trialEnds >= now;
      }
      if (sub.status === "ACTIVE") {
        return !periodEnd || periodEnd >= now;
      }
      if (sub.status === "PAST_DUE") {
        return !!gracePeriodEnds && gracePeriodEnds >= now;
      }
      return false;
    });

    if (!hasValidSub) return false;
  }

  return true;
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
      ...SAFE_DB_BLOCKED_SUBSTRINGS.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { slug: { contains: term, mode: "insensitive" as const } },
        { city: { contains: term, mode: "insensitive" as const } },
      ]),
    ],
  };
}
