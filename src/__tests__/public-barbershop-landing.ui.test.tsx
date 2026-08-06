import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

// Setup hoisting mocks for prisma
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findFirst: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    review: { findMany: vi.fn() },
    tenantSubscription: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

// Import component and metadata generator
import BarbershopPublicPage, { generateMetadata } from "@/app/[slug]/page";

const mockBarbershop = {
  id: "shop-1",
  name: "Don Brio Barbearia",
  slug: "don-brio",
  description: "Cortes de cabelo premium e barba clássica",
  phone: "17991089190",
  logoUrl: "http://logo.com/image.png",
  coverUrl: "http://cover.com/cover.png",
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
      name: "Cabelo",
      services: [
        {
          id: "svc-1",
          name: "Corte Moderno",
          description: "Corte na tesoura e máquina com finalização",
          price: 60.0,
          durationMin: 30,
          isActive: true,
        },
      ],
    },
  ],
  members: [
    {
      id: "m-1",
      bio: "Profissional especializado em cortes de cabelo masculino",
      ratingAvg: 4.9,
      role: "BARBER",
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
    },
  ],
};

const mockSubscription = {
  id: "sub-1",
  status: "ACTIVE",
  currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
  plan: { id: "plan-1", name: "Premium" },
};

describe("P1 Vitrine Pública das Barbearias LOTE A2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1 & T9 — /[slug] renderiza nome da barbearia, endereço e telefone", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    expect(screen.getByText("Don Brio Barbearia")).toBeInTheDocument();
    expect(screen.getByText(/Avenida da Barbearia, 1000/)).toBeInTheDocument();
    expect(screen.getByText(/Loja A/)).toBeInTheDocument();
    expect(screen.getAllByText(/Centro, São José do Rio Preto/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("17991089190")).toBeInTheDocument();
  });

  it("T2 — CTA principal 'Agendar horário' aponta para /<slug>/agendar", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    const bookingLinks = screen.getAllByRole("link", { name: /Agendar/i });
    expect(bookingLinks.length).toBeGreaterThanOrEqual(1);
    expect(bookingLinks[0]).toHaveAttribute("href", "/don-brio/agendar");
  });

  it("T3 — WhatsApp aparece quando telefone público existe", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    const whatsappLink = screen.getByRole("link", { name: /Falar no WhatsApp/i });
    expect(whatsappLink).toHaveAttribute("href", "https://wa.me/5517991089190");
  });

  it("T4 — serviços ativos aparecem agrupados na vitrine", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    expect(screen.getByText("Cabelo")).toBeInTheDocument();
    expect(screen.getByText("Corte Moderno")).toBeInTheDocument();
    expect(screen.getByText("Corte na tesoura e máquina com finalização")).toBeInTheDocument();
    expect(screen.getByText("R$ 60,00")).toBeInTheDocument();
    expect(screen.getByText(/30 min/)).toBeInTheDocument();
  });

  it("T5 — profissionais ativos aparecem na vitrine", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    expect(screen.getByText("Carlos Barber")).toBeInTheDocument();
    expect(screen.getByText(/Profissional especializado/)).toBeInTheDocument();
  });

  it("T6 — página não quebra sem cover/logo", async () => {
    const withoutImages = {
      ...mockBarbershop,
      logoUrl: null,
      coverUrl: null,
    };
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(withoutImages);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]);

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    expect(screen.getByText("Don Brio Barbearia")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument(); // Logo initial fallback
  });

  it("T7 & T8 — página não quebra sem avaliações e não mostra bloco vazio feio", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);
    prismaMock.tenantSubscription.findFirst.mockResolvedValueOnce(mockSubscription);
    prismaMock.barbershopMember.findFirst.mockResolvedValueOnce(mockBarbershop.members[0]);
    prismaMock.review.findMany.mockResolvedValueOnce([]); // Empty reviews

    const Page = await BarbershopPublicPage({ params: Promise.resolve({ slug: "don-brio" }) });
    render(Page);

    expect(screen.queryByText("O que dizem nossos clientes")).not.toBeInTheDocument();
  });

  it("T10 — metadata title/description geram as tags corretas", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(mockBarbershop);

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "don-brio" }) });

    expect(metadata.title).toBe("Don Brio Barbearia | Tem Barber");
    expect(metadata.description).toBe("Cortes de cabelo premium e barba clássica");
    expect(metadata.openGraph?.title).toBe("Don Brio Barbearia | Tem Barber");
    expect(metadata.openGraph?.images?.[0]?.url).toBe("http://cover.com/cover.png");
  });

  it("T11 — barbearia inexistente retorna estado seguro notFound", async () => {
    prismaMock.barbershop.findFirst.mockResolvedValueOnce(null);

    // Assert that calling BarbershopPublicPage throws or triggers notFound
    // Next.js notFound throws an internal digest error
    await expect(
      BarbershopPublicPage({ params: Promise.resolve({ slug: "inexistente" }) })
    ).rejects.toThrow();
  });
});
