import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findFirst: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    review: { findMany: vi.fn() },
    tenantSubscription: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import BarbershopPublicPage, { generateMetadata } from "@/app/[slug]/page";

const activeSubscription = {
  id: "sub-1",
  status: "ACTIVE",
  currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
  plan: { id: "plan-1", name: "Premium" },
};

const baseMember = {
  id: "m-1",
  role: "BARBER",
  bio: "Especialista em corte clássico e acabamento de barba.",
  ratingAvg: 4.8,
  user: {
    name: "Carlos Barber",
    avatarUrl: "http://avatar.com/carlos.png",
  },
  workingHours: [
    {
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
      isActive: true,
    },
  ],
};

const baseBarbershop = {
  id: "shop-1",
  name: "Don Brio Barbearia",
  slug: "don-brio",
  description: "Cortes de cabelo premium e barba clássica",
  phone: "17991089190" as string | null,
  logoUrl: "http://logo.com/image.png" as string | null,
  coverUrl: "http://cover.com/cover.png" as string | null,
  street: "Avenida da Barbearia",
  number: "1000",
  complement: "Loja A",
  neighborhood: "Centro",
  city: "São José do Rio Preto",
  state: "SP",
  active: true,
  categories: [
    {
      id: "cat-1",
      name: "Cabelo & Barba",
      services: [
        {
          id: "svc-1",
          name: "Corte Masculino Tradicional",
          description: "",
          price: 60.0,
          durationMin: 30,
          isActive: true,
        },
      ],
    },
  ],
  members: [baseMember],
};

describe("P1 Vitrine Pública LOTE A3 — Redesign Editorial Premium", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderPage(overrides?: {
    barbershop?: Partial<typeof baseBarbershop>;
    subscription?: unknown;
    ownerWorkingHours?: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      isActive: boolean;
    }>;
    reviews?: Array<{
      id: string;
      rating: number;
      comment: string | null;
      createdAt: Date;
      customer: { name: string };
    }>;
  }) {
    const barbershop = {
      ...baseBarbershop,
      ...overrides?.barbershop,
      categories: overrides?.barbershop?.categories ?? baseBarbershop.categories,
      members: overrides?.barbershop?.members ?? baseBarbershop.members,
    };

    prismaMock.barbershop.findFirst.mockResolvedValueOnce(barbershop);
    prismaMock.tenantSubscription.findUnique.mockResolvedValueOnce(overrides?.subscription ?? activeSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce({
      workingHours: overrides?.ownerWorkingHours ?? baseMember.workingHours,
    });
    prismaMock.review.findMany.mockResolvedValueOnce(overrides?.reviews ?? []);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);
  }

  it("T1/T2/T3 — renderiza hero editorial e CTA principal para /<slug>/agendar", async () => {
    await renderPage();

    expect(screen.getByTestId("editorial-hero-title")).toHaveTextContent("Seu estilo.");
    expect(screen.getByRole("heading", { name: "Don Brio Barbearia" })).toBeInTheDocument();
    expect(screen.getByTestId("hero-booking-cta").closest("a")).toHaveAttribute("href", "/don-brio/agendar");
    expect(screen.getByTestId("mobile-sticky-cta")).toBeInTheDocument();
  });

  it("T1/T2/T3/T7/T8 — remove placeholders técnicos e usa copy comercial", async () => {
    await renderPage();

    expect(screen.queryByText(/Slot visual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Slot preparado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Espaço reservado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/próximos lotes/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Atendimento com hora marcada/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Atendimento com hora marcada, ambiente profissional e cuidado nos detalhes/i)).toBeInTheDocument();
  });

  it("T4/T5 — WhatsApp aparece quando telefone existe e não aparece sem telefone", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /Falar no WhatsApp/i })).toHaveAttribute("href", "https://wa.me/5517991089190");

    cleanup();
    await renderPage({ barbershop: { phone: null } });
    expect(screen.queryByRole("link", { name: /Falar no WhatsApp/i })).not.toBeInTheDocument();
  });

  it("T6/T7 — serviços aparecem como ofertas com fallback de microcopy", async () => {
    await renderPage({
      barbershop: {
        categories: [
          {
            id: "cat-a",
            name: "Cabelo & Barba",
            services: [
              {
                id: "svc-a",
                name: "Corte Masculino Tradicional",
                description: "",
                price: 35,
                durationMin: 30,
                isActive: true,
              },
            ],
          },
        ],
      },
    });

    expect(screen.getByTestId("services-offers-section")).toBeInTheDocument();
    expect(screen.getByText("Corte Masculino Tradicional")).toBeInTheDocument();
    expect(screen.getByText("Tecnica, acabamento e estilo para o seu dia a dia.")).toBeInTheDocument();
  });

  it("T8/T9/T10 — equipe mostra nome/função e filtra bio administrativa ruim", async () => {
    await renderPage({
      barbershop: {
        members: [
          {
            ...baseMember,
            role: "OWNER",
            bio: "Gestão Financeira",
          },
        ],
      },
    });

    expect(screen.getByText("Carlos Barber")).toBeInTheDocument();
    expect(screen.getByText("Barbeiro responsável")).toBeInTheDocument();
    expect(screen.queryByText(/Gestão Financeira/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gestao Financeira/i)).not.toBeInTheDocument();
    expect(screen.getByText("Especialista em atendimento masculino, corte e acabamento.")).toBeInTheDocument();
  });

  it("T11/T12 — avaliações aparecem quando existem e seção é omitida quando não existem", async () => {
    await renderPage({
      reviews: [
        {
          id: "r1",
          rating: 5,
          comment: "Excelente experiência",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          customer: { name: "João da Silva" },
        },
      ],
    });

    expect(screen.getByTestId("reviews-section")).toBeInTheDocument();
    expect(screen.getByText("Excelente experiência")).toBeInTheDocument();

    cleanup();
    await renderPage({ reviews: [] });
    expect(screen.queryByTestId("reviews-section")).not.toBeInTheDocument();
  });

  it("T13/T14/T18 — ambiente e horários aparecem; página não quebra sem telefone", async () => {
    await renderPage({ barbershop: { phone: null } });

    expect(screen.getByTestId("environment-gallery-section")).toBeInTheDocument();
    expect(screen.getByTestId("working-hours-section")).toBeInTheDocument();
    expect(screen.getByText(/Avenida da Barbearia, 1000/i)).toBeInTheDocument();
  });

  it("T15/T16/T17 — página não quebra sem cover/logo, sem serviços e sem profissionais", async () => {
    await renderPage({
      barbershop: {
        coverUrl: null,
        logoUrl: null,
        categories: [],
        members: [],
      },
    });

    expect(screen.getByTestId("hero-fallback")).toBeInTheDocument();
    expect(screen.getByText(/Estamos atualizando nosso cardapio de servicos/i)).toBeInTheDocument();
    expect(screen.getByText(/Nossa equipe esta sendo atualizada/i)).toBeInTheDocument();
  });

  it("T19 — barbearia inexistente retorna estado seguro via notFound", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(null);

    await expect(
      BarbershopPublicPage({ params: Promise.resolve({ slug: "inexistente" }) })
    ).rejects.toThrow();
  });

  it("T20 — barbearia indisponível renderiza estado seguro", async () => {
    await renderPage({
      subscription: {
        id: "sub-disabled",
        status: "CANCELED",
        currentPeriodEnd: new Date("2020-01-01T00:00:00.000Z"),
        plan: { id: "plan-x", name: "Legacy" },
      },
    });

    expect(screen.getByRole("heading", { name: /Barbearia indisponivel/i })).toBeInTheDocument();
  });

  it("T23/T24 — metadata inclui title/description/openGraph/canonical/metadataBase", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(baseBarbershop);

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "don-brio" }) });

    expect(metadata.title).toBe("Don Brio Barbearia | Tem Barber");
    expect(metadata.description).toBe("Cortes de cabelo premium e barba clássica");
    expect(metadata.openGraph?.title).toBe("Don Brio Barbearia | Tem Barber");
    expect(metadata.openGraph?.images?.[0]?.url).toBe("http://cover.com/cover.png");
    expect(metadata.alternates?.canonical).toBe("/don-brio");
    expect(metadata.metadataBase?.toString()).toBe("https://app.tembarber.com.br/");
  });
});
