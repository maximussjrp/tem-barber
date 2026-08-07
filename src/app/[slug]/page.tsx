import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getTenantSubscription, isSubscriptionActive } from "@/lib/subscription-utils";
import { isPublicBarbershop, publicBarbershopWhere, sanitizeBarbershopSlug } from "@/lib/public-barbershops";

const DAY_NAMES = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
const PUBLIC_APP_URL = "https://app.tembarber.com.br";
const ADMIN_BIO_TERMS = [
  "financeiro",
  "financeira",
  "administrativo",
  "administrativa",
  "admin",
  "gestao",
  "gestao financeira",
  "gestao administrativa",
  "teste",
  "sistema",
  "operacional",
  "comercial",
  "faturamento",
  "backoffice",
  "suporte",
  "rh",
  "recursos humanos",
];

interface WorkingHour {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

function toCurrency(value: { toString(): string } | number | string | null | undefined): string {
  const numericValue = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value || 0);
  return numericValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function serviceMicrocopy(name: string): string {
  const normalized = name.toLowerCase();

  if (normalized.includes("corte") && normalized.includes("barba")) {
    return "Combo completo para renovar presenca e estilo.";
  }
  if (normalized.includes("corte")) {
    return "Tecnica, acabamento e estilo para o seu dia a dia.";
  }
  if (normalized.includes("barba")) {
    return "Acabamento preciso para manter o visual alinhado.";
  }
  if (normalized.includes("sobrancelha")) {
    return "Detalhe final para um visual mais limpo.";
  }

  return "Servico profissional com atendimento marcado.";
}

function removeDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function sanitizePublicBio(bio: string | null | undefined): string | null {
  if (!bio) return null;
  const trimmed = bio.trim();
  if (!trimmed) return null;

  const lowered = removeDiacritics(trimmed).toLowerCase();
  if (ADMIN_BIO_TERMS.some((term) => lowered.includes(term))) {
    return null;
  }

  return trimmed;
}

function roleLabel(role: string): string {
  if (role === "OWNER") return "Barbeiro responsável";
  if (role === "MANAGER") return "Especialista";
  return "Barbeiro";
}

function customerSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Cliente";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return `${parts[0].slice(0, 1).toUpperCase()}.`;
  return `${parts[0]} ${parts[1].slice(0, 1).toUpperCase()}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const safeSlug = sanitizeBarbershopSlug(slug);
  if (!safeSlug) return { title: "Barbearia nao encontrada" };

  const barbershop = await prisma.barbershop.findFirst({
    where: { ...publicBarbershopWhere(), slug: safeSlug },
  });

  if (!barbershop || !isPublicBarbershop(barbershop)) {
    return { title: "Barbearia nao encontrada" };
  }

  const title = `${barbershop.name} | Tem Barber`;
  const description =
    barbershop.description ||
    `Agende seu horario online na ${barbershop.name}. Atendimento com hora marcada, praticidade e cuidado nos detalhes.`;
  const imageUrl = barbershop.coverUrl || barbershop.logoUrl || undefined;

  return {
    metadataBase: new URL(PUBLIC_APP_URL),
    title,
    description,
    alternates: {
      canonical: `/${safeSlug}`,
    },
    openGraph: {
      title,
      description,
      url: `/${safeSlug}`,
      images: imageUrl ? [{ url: imageUrl }] : [],
    },
  };
}

export default async function BarbershopPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const safeSlug = sanitizeBarbershopSlug(slug);
  if (!safeSlug) notFound();

  const barbershop = await prisma.barbershop.findFirst({
    where: { ...publicBarbershopWhere(), slug: safeSlug },
    include: {
      categories: {
        include: {
          services: { where: { isActive: true }, orderBy: { name: "asc" } },
        },
        orderBy: { name: "asc" },
      },
      members: {
        where: { isActive: true, role: { in: ["BARBER", "MANAGER", "OWNER"] } },
        include: {
          user: { select: { name: true, avatarUrl: true } },
          workingHours: { where: { isActive: true } },
        },
        orderBy: { user: { name: "asc" } },
      },
    },
  });

  if (!barbershop || !isPublicBarbershop(barbershop)) notFound();

  const subscription = await getTenantSubscription(barbershop.id);
  if (!isSubscriptionActive(subscription)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-text-primary">
        <Card variant="raised" className="w-full max-w-md p-8 text-center md:p-10">
          <h1 className="heading-2 mb-3">Barbearia indisponivel</h1>
          <p className="body-small mb-6 text-text-secondary">
            Esta barbearia esta temporariamente indisponivel para agendamentos.
          </p>
          <Link href="/">
            <Button variant="secondary" className="w-full">
              Voltar ao inicio
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const ownerMember = await prisma.barbershopMember.findFirst({
    where: { barbershopId: barbershop.id, role: "OWNER" },
    include: { workingHours: { where: { isActive: true }, orderBy: { dayOfWeek: "asc" } } },
  });
  const workingHours: WorkingHour[] = ownerMember?.workingHours ?? [];

  const reviews = await prisma.review.findMany({
    where: { appointment: { barbershopId: barbershop.id } },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null;

  const hasPublicAddress = Boolean(barbershop.street || barbershop.neighborhood || barbershop.city || barbershop.state);
  const hasServices = barbershop.categories.some((category) => category.services.length > 0);
  const hasTeam = barbershop.members.length > 0;

  const numericPhone = barbershop.phone ? barbershop.phone.replace(/\D/g, "") : "";
  const whatsappUrl = numericPhone ? `https://wa.me/${numericPhone.startsWith("55") ? numericPhone : `55${numericPhone}`}` : null;

  const fullAddress = [
    [barbershop.street, barbershop.number].filter(Boolean).join(", "),
    barbershop.complement,
    [barbershop.neighborhood, [barbershop.city, barbershop.state].filter(Boolean).join(" - ")].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-zinc-100">
      <div className="fixed inset-0 -z-20 bg-[radial-gradient(circle_at_15%_20%,rgba(201,168,76,0.18),transparent_38%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.08),transparent_26%),linear-gradient(180deg,#0b0b0d_0%,#09090b_48%,#080809_100%)]" />
      <div className="fixed inset-0 -z-10 opacity-[0.08] [background-size:16px_16px] [background-image:linear-gradient(to_right,rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.15)_1px,transparent_1px)]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href={`/${safeSlug}`} className="flex items-center gap-3" aria-label={`Inicio da vitrine ${barbershop.name}`}>
            <div className="h-9 w-9 overflow-hidden rounded-full border border-[#c9a84c]/60 bg-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,.08)]">
              {barbershop.logoUrl ? (
                <img src={barbershop.logoUrl} alt={`Logo de ${barbershop.name}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#c9a84c]">
                  {barbershop.name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="leading-tight">
              <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-400">Tem Barber</p>
              <p className="text-sm font-semibold text-zinc-100">{barbershop.name}</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-zinc-300 md:flex">
            <a href="#servicos" className="transition hover:text-[#c9a84c]">Servicos</a>
            <a href="#ambiente" className="transition hover:text-[#c9a84c]">Ambiente</a>
            <a href="#equipe" className="transition hover:text-[#c9a84c]">Equipe</a>
            <a href="#avaliacoes" className="transition hover:text-[#c9a84c]">Avaliacoes</a>
            <a href="#contato" className="transition hover:text-[#c9a84c]">Contato</a>
          </nav>

          <Link href={`/${safeSlug}/agendar`}>
            <Button className="h-10 rounded-full bg-[#c9a84c] px-5 text-xs font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760] sm:text-sm" data-testid="header-booking-cta">
              Agendar horario
            </Button>
          </Link>
        </div>
      </header>

      <main className="pb-28 md:pb-16">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-20">
            {barbershop.coverUrl ? (
              <img src={barbershop.coverUrl} alt={`Capa de ${barbershop.name}`} className="h-full w-full object-cover" />
            ) : (
              <div
                className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(201,168,76,.35),transparent_28%),radial-gradient(circle_at_80%_15%,rgba(255,255,255,.12),transparent_24%),linear-gradient(135deg,#1d1e24_0%,#131419_42%,#060607_100%)]"
                data-testid="hero-fallback"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(201,168,76,.16),transparent_36%)]" />
                <div className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,.04)_100%)]" />
              </div>
            )}
          </div>
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(5,5,7,0.45)_0%,rgba(8,8,10,0.72)_32%,rgba(8,8,10,0.92)_68%,#0b0b0d_100%)]" />

          <div className="mx-auto grid min-h-[86svh] w-full max-w-7xl grid-cols-1 items-end gap-10 px-4 pb-12 pt-20 sm:px-6 lg:grid-cols-[1.2fr_.8fr] lg:px-8">
            <div className="space-y-8">
              <p className="inline-flex items-center rounded-full border border-white/20 bg-black/35 px-4 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-200">
                Barbearia premium
              </p>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] text-zinc-50 sm:text-5xl lg:text-6xl" data-testid="editorial-hero-title">
                  Seu estilo.
                  <br />
                  Sua presenca.
                  <br />
                  Nossa arte.
                </h1>
                <p className="max-w-2xl text-base leading-relaxed text-zinc-200/90 sm:text-lg">
                  Mais que um corte, uma experiencia completa de cuidado, confianca e presenca.
                </p>
                <p className="text-sm font-medium text-zinc-300">
                  {barbershop.name}
                  {hasPublicAddress ? ` · ${barbershop.neighborhood}, ${barbershop.city}` : ""}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href={`/${safeSlug}/agendar`}>
                  <Button className="h-12 rounded-full bg-[#c9a84c] px-8 text-sm font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760]" data-testid="hero-booking-cta">
                    Agendar horario online
                  </Button>
                </Link>
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" className="h-12 rounded-full border-white/40 bg-black/30 px-8 text-sm font-semibold uppercase tracking-[0.12em] text-white hover:border-[#c9a84c] hover:text-[#f8e4a5]" data-testid="hero-whatsapp-cta">
                      Falar no WhatsApp
                    </Button>
                  </a>
                )}
              </div>

              <ul className="grid gap-2 text-sm text-zinc-200 sm:grid-cols-2">
                <li className="rounded-xl border border-white/15 bg-black/25 px-3 py-2">Atendimento com hora marcada</li>
                <li className="rounded-xl border border-white/15 bg-black/25 px-3 py-2">Agendamento online</li>
                <li className="rounded-xl border border-white/15 bg-black/25 px-3 py-2">Servicos com preco visivel</li>
                <li className="rounded-xl border border-white/15 bg-black/25 px-3 py-2">Profissionais especializados</li>
              </ul>
            </div>

            <div className="hidden rounded-3xl border border-white/15 bg-black/40 p-6 shadow-2xl backdrop-blur-sm lg:block">
              <p className="mb-2 text-xs uppercase tracking-[0.26em] text-zinc-400">Assinatura da marca</p>
              <h2 className="text-2xl font-semibold text-zinc-50">{barbershop.name}</h2>
              <p className="mt-3 text-sm text-zinc-300">
                {barbershop.description || "Atendimento premium para quem busca presenca, cuidado e estilo em cada detalhe."}
              </p>
              {avgRating !== null && (
                <p className="mt-6 text-sm text-zinc-200">
                  <span className="text-[#c9a84c]">★ {avgRating.toFixed(1)}</span> em {reviews.length} avaliacoes verificadas
                </p>
              )}
            </div>
          </div>
        </section>

        <section id="servicos" className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[#c9a84c]">Servicos</p>
              <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Ofertas para o seu estilo</h2>
            </div>
            <Link href={`/${safeSlug}/agendar`} className="hidden md:block">
              <Button variant="outline" className="rounded-full border-white/20 bg-transparent text-zinc-200 hover:border-[#c9a84c] hover:text-[#f8e4a5]">
                Ver horarios
              </Button>
            </Link>
          </div>

          {hasServices ? (
            <div className="space-y-10" data-testid="services-offers-section">
              {barbershop.categories
                .filter((category) => category.services.length > 0)
                .map((category) => (
                  <div key={category.id} className="space-y-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">{category.name}</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {category.services.map((service) => {
                        const safeDescription = service.description?.trim() || serviceMicrocopy(service.name);
                        return (
                          <article key={service.id} className="group rounded-2xl border border-white/10 bg-[#121317] p-5 transition hover:-translate-y-1 hover:border-[#c9a84c]/60 hover:bg-[#15161d]">
                            <p className="text-lg font-semibold text-zinc-100">{service.name}</p>
                            <p className="mt-2 min-h-[44px] text-sm leading-relaxed text-zinc-300">{safeDescription}</p>
                            <div className="mt-5 flex items-end justify-between gap-4">
                              <div>
                                <p className="text-xl font-semibold text-[#f2d78d]">{toCurrency(service.price)}</p>
                                <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">{service.durationMin} min</p>
                              </div>
                              <Link href={`/${safeSlug}/agendar`}>
                                <Button size="sm" className="rounded-full bg-[#c9a84c] px-4 text-xs font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760]">
                                  Agendar
                                </Button>
                              </Link>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <Card className="rounded-2xl border border-white/10 bg-[#111217] p-8 text-center text-zinc-300">
              Estamos atualizando nosso cardapio de servicos. Volte em instantes para conferir todas as opcoes.
            </Card>
          )}
        </section>

        <section id="ambiente" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="environment-gallery-section">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.24em] text-[#c9a84c]">Ambiente</p>
            <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Um espaco feito para voce</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-300">
              Atendimento com hora marcada, ambiente profissional e cuidado nos detalhes. Nossa vitrine ja esta pronta para receber galerias reais da experiencia.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="relative min-h-[220px] overflow-hidden rounded-3xl border border-white/10 bg-[#121319] p-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(201,168,76,.22),transparent_34%),linear-gradient(145deg,rgba(255,255,255,.05),transparent_50%)]" />
              <div className="relative">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Ambiente</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-100">Conforto e presença</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                  Um espaço pensado para receber com atenção, cuidado e uma experiência elegante do início ao fim.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { title: "Atendimento", body: "Reserva de horário com comodidade e organização." },
                { title: "Detalhes", body: "Cuidado nas finas etapas que fazem diferença no resultado." },
                { title: "Marca", body: "Identidade visual forte e uma experiência memorável." },
                { title: "Experiência", body: "Cada visita preparada para deixar uma boa impressão." },
              ].map((item) => (
                <div key={item.title} className="min-h-[120px] rounded-2xl border border-white/10 bg-[#111217] p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">{item.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="equipe" className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.24em] text-[#c9a84c]">Equipe</p>
            <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Especialistas em presenca</h2>
          </div>

          {hasTeam ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {barbershop.members.map((member) => {
                const safeBio = sanitizePublicBio(member.bio);
                return (
                  <article key={member.id} className="rounded-2xl border border-white/10 bg-[#121317] p-5">
                    <div className="mb-4 flex items-center gap-4">
                      <Avatar src={member.user.avatarUrl} alt={member.user.name} size="lg" fallbackText={member.user.name} />
                      <div>
                        <p className="text-base font-semibold text-zinc-100">{member.user.name}</p>
                        <p className="text-xs uppercase tracking-[0.12em] text-[#c9a84c]">{roleLabel(member.role)}</p>
                      </div>
                    </div>
                    <p className="min-h-[44px] text-sm leading-relaxed text-zinc-300">
                      {safeBio || "Especialista em atendimento masculino, corte e acabamento."}
                    </p>
                    <div className="mt-5">
                      <Link href={`/${safeSlug}/agendar`}>
                        <Button variant="outline" className="w-full rounded-full border-white/20 text-zinc-100 hover:border-[#c9a84c] hover:text-[#f8e4a5]">
                          Agendar com profissional
                        </Button>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Card className="rounded-2xl border border-white/10 bg-[#111217] p-8 text-center text-zinc-300">
              Nossa equipe esta sendo atualizada para voce conhecer todos os profissionais.
            </Card>
          )}
        </section>

        {reviews.length > 0 ? (
          <section id="avaliacoes" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8" data-testid="reviews-section">
            <div className="mb-8">
              <p className="text-xs uppercase tracking-[0.24em] text-[#c9a84c]">Avaliacoes</p>
              <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Quem passa por aqui recomenda</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {reviews.slice(0, 6).map((review) => (
                <article key={review.id} className="rounded-2xl border border-white/10 bg-[#121317] p-5">
                  <p className="text-sm text-[#f2d78d]">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</p>
                  {review.comment && <p className="mt-3 text-sm leading-relaxed text-zinc-200">{review.comment}</p>}
                  <div className="mt-4 border-t border-white/10 pt-3 text-xs text-zinc-400">
                    <p>{customerSafeName(review.customer.name)}</p>
                    <p>{new Date(review.createdAt).toLocaleDateString("pt-BR")}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section id="avaliacoes" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#121317] p-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "Atendimento com hora marcada",
                "Servicos com preco visivel",
                "Agendamento online rapido",
                "Localizacao clara para chegar facil",
              ].map((item) => (
                <p key={item} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">{item}</p>
              ))}
            </div>
          </section>
        )}

        <section id="contato" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_.9fr]">
            <div className="rounded-3xl border border-white/10 bg-[#121317] p-7">
              <p className="text-xs uppercase tracking-[0.24em] text-[#c9a84c]">Contato</p>
              <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Encontre a barbearia</h2>
              <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                {hasPublicAddress
                  ? fullAddress
                  : "Endereço em atualização. Nossa equipe pode te orientar com mais detalhes sobre a localização e o atendimento."}
              </p>
              {barbershop.phone && <p className="mt-2 text-sm text-zinc-200">Telefone / WhatsApp: {barbershop.phone}</p>}

              {workingHours.length > 0 && (
                <div className="mt-6 space-y-2" data-testid="working-hours-section">
                  {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                    const item = workingHours.find((hour) => hour.dayOfWeek === day);
                    return (
                      <div key={day} className="flex items-center justify-between text-sm text-zinc-300">
                        <span>{DAY_NAMES[day]}</span>
                        <span>{item ? `${item.startTime} - ${item.endTime}` : "Fechado"}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href={`/${safeSlug}/agendar`}>
                  <Button className="h-11 rounded-full bg-[#c9a84c] px-6 text-sm font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760]">
                    Agendar horario
                  </Button>
                </Link>
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" className="h-11 rounded-full border-white/20 bg-transparent px-6 text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100 hover:border-[#c9a84c] hover:text-[#f8e4a5]">
                      WhatsApp
                    </Button>
                  </a>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#111217] p-7">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-400">Localização</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">Fachada, endereço e atendimento</h3>
              <div className="mt-5 h-56 rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(201,168,76,.18),transparent_35%),linear-gradient(160deg,#1b1c22_0%,#101116_100%)] p-4">
                <p className="text-sm leading-relaxed text-zinc-300">
                  A experiência começa no caminho até a barbearia, com uma chegada acolhedora e um atendimento preparado para impressionar.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-20 pt-10 text-center sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-[#c9a84c]/35 bg-[linear-gradient(145deg,rgba(201,168,76,.12),rgba(201,168,76,.02)_45%,rgba(8,8,10,.95))] px-6 py-10">
            <h3 className="text-3xl font-semibold text-zinc-50">Pronto para transformar seu visual?</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-300">
              Reserve seu próximo atendimento com praticidade e deixe a sua presença sempre impecável.
            </p>
            <div className="mt-6 flex justify-center">
              <Link href={`/${safeSlug}/agendar`}>
                <Button className="h-12 rounded-full bg-[#c9a84c] px-10 text-sm font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760]" data-testid="final-booking-cta">
                  Agendar horario
                </Button>
              </Link>
            </div>
            <p className="mt-8 text-xs uppercase tracking-[0.18em] text-zinc-500">Powered by Tem Barber</p>
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/15 bg-black/80 p-3 backdrop-blur-md md:hidden" data-testid="mobile-sticky-cta">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Link href={`/${safeSlug}/agendar`} className="flex-1">
            <Button className="h-11 w-full rounded-full bg-[#c9a84c] text-xs font-semibold uppercase tracking-[0.12em] text-black hover:bg-[#d8b760]">
              Agendar horario
            </Button>
          </Link>
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="outline" className="h-11 w-full rounded-full border-white/30 bg-transparent text-xs font-semibold uppercase tracking-[0.12em] text-zinc-100 hover:border-[#c9a84c]">
                WhatsApp
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="h-16 md:hidden" aria-hidden="true" />
    </div>
  );
}
