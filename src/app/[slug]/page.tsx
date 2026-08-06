import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { getTenantSubscription, isSubscriptionActive } from "@/lib/subscription-utils";
import { publicBarbershopWhere, sanitizeBarbershopSlug, isPublicBarbershop } from "@/lib/public-barbershops";

const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

interface WorkingHour {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const safeSlug = sanitizeBarbershopSlug(slug);
  if (!safeSlug) return { title: "Barbearia não encontrada" };

  const barbershop = await prisma.barbershop.findFirst({
    where: { ...publicBarbershopWhere(), slug: safeSlug },
  });

  if (!barbershop || !isPublicBarbershop(barbershop)) {
    return { title: "Barbearia não encontrada" };
  }

  const title = `${barbershop.name} | Tem Barber`;
  const description =
    barbershop.description ||
    `Agende seu horário online na ${barbershop.name}. Atendimento com hora marcada, praticidade e cuidado nos detalhes.`;
  const imageUrl = barbershop.coverUrl || barbershop.logoUrl || undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
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

  // Fetch full profile via direct Prisma (SSR — no auth needed)
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

  // Verificar status de assinatura do tenant
  const subscription = await getTenantSubscription(barbershop.id);
  if (!isSubscriptionActive(subscription)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-text-primary px-4">
        <Card variant="raised" className="max-w-md w-full p-8 md:p-10 text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-warning-subtle border border-warning/30 text-warning mx-auto mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h1 className="heading-2 mb-3">Barbearia Indisponível</h1>
          <p className="body-small text-text-secondary leading-relaxed mb-6">
            Esta barbearia está temporariamente indisponível para agendamentos.
          </p>
          <Button variant="secondary" className="w-full">
            <Link href="/" className="w-full">
              Voltar ao início
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  // Working hours from first OWNER member
  const ownerMember = await prisma.barbershopMember.findFirst({
    where: { barbershopId: barbershop.id, role: "OWNER" },
    include: { workingHours: { where: { isActive: true }, orderBy: { dayOfWeek: "asc" } } },
  });
  const workingHours: WorkingHour[] = ownerMember?.workingHours ?? [];

  // Reviews
  const reviews = await prisma.review.findMany({
    where: { appointment: { barbershopId: barbershop.id } },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : null;

  // Clean and normalize phone number for WhatsApp Link
  const numericPhone = barbershop.phone ? barbershop.phone.replace(/\D/g, "") : "";
  const whatsappUrl = numericPhone
    ? `https://wa.me/${numericPhone.startsWith("55") ? numericPhone : `55${numericPhone}`}`
    : null;

  return (
    <div className="min-h-screen bg-background text-text-primary">
      {/* Cover / Hero Header */}
      <div className="relative h-64 md:h-96 w-full bg-surface-raised overflow-hidden">
        {barbershop.coverUrl ? (
          <img
            src={barbershop.coverUrl}
            alt={`Capa de ${barbershop.name}`}
            className="w-full h-full object-cover opacity-50"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-stone-900 via-stone-950 to-stone-900 opacity-80" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-black/40 to-transparent" />
      </div>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Profile Card Overlay */}
        <div className="relative -mt-24 md:-mt-32 mb-10 z-10">
          <div className="flex flex-col md:flex-row md:items-end gap-6 pb-6">
            <div className="shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-surface border-4 border-background overflow-hidden flex items-center justify-center shadow-2xl">
              {barbershop.logoUrl ? (
                <img
                  src={barbershop.logoUrl}
                  alt={`Logo de ${barbershop.name}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-surface-raised flex items-center justify-center text-4xl font-serif text-brand">
                  {barbershop.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="flex-1 pb-2">
              <h1 className="heading-1 font-serif text-3xl md:text-5xl font-bold leading-tight mb-2">
                {barbershop.name}
              </h1>

              <div className="flex items-center gap-2 flex-wrap text-sm text-text-secondary">
                <span>
                  {barbershop.neighborhood}, {barbershop.city} – {barbershop.state}
                </span>
                {avgRating !== null && (
                  <>
                    <span className="text-text-muted">•</span>
                    <Badge variant="brand" className="font-bold">
                      ★ {avgRating.toFixed(1)}
                    </Badge>
                    <span className="text-text-muted">
                      ({reviews.length} {reviews.length === 1 ? "avaliação" : "avaliações"})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <Divider className="my-2" />
        </div>

        {/* Pitch & Conversion Block */}
        <section className="mb-12">
          <Card variant="raised" className="p-8 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand/20 via-brand to-brand/20" />
            <h2 className="heading-2 font-serif text-2xl md:text-3xl mb-3">
              Seu próximo corte começa aqui.
            </h2>
            <p className="body text-text-secondary max-w-2xl mx-auto mb-8">
              Escolha o serviço, veja os horários e agende em poucos segundos. Atendimento com hora marcada, praticidade e cuidado nos detalhes.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={`/${slug}/agendar`} className="w-full sm:w-auto">
                <Button variant="primary" size="lg" className="w-full px-8 font-bold">
                  Agendar horário online
                </Button>
              </Link>
              {whatsappUrl && (
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                  <Button variant="outline" size="lg" className="w-full px-8">
                    Falar no WhatsApp
                  </Button>
                </a>
              )}
            </div>
          </Card>
        </section>

        {/* Two-Column Grid: Services on Left, Shop Info on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16">

          {/* Services Column (Left 2 Columns) */}
          <div className="lg:col-span-2 space-y-10">
            <div>
              <h2 className="heading-2 mb-1">Nossos Serviços</h2>
              <p className="body-small text-text-secondary">Selecione o serviço ideal para o seu estilo.</p>
            </div>

            {barbershop.categories.filter((c) => c.services.length > 0).length > 0 ? (
              <div className="space-y-8">
                {barbershop.categories
                  .filter((c) => c.services.length > 0)
                  .map((cat) => (
                    <div key={cat.id} className="space-y-3">
                      <h3 className="label text-brand font-bold uppercase tracking-wider">
                        {cat.name}
                      </h3>
                      <div className="space-y-3">
                        {cat.services.map((svc) => (
                          <Card key={svc.id} variant="default" className="hover:border-border-strong transition-all duration-200">
                            <CardContent className="p-5 flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <p className="body font-semibold text-text-primary">{svc.name}</p>
                                {svc.description && (
                                  <p className="body-small text-text-secondary leading-relaxed max-w-lg">
                                    {svc.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  <span className="text-xs text-text-muted flex items-center gap-1">
                                    🕒 {svc.durationMin} min
                                  </span>
                                </div>
                              </div>

                              <div className="text-right shrink-0 flex flex-col items-end justify-between h-full gap-3">
                                <p className="body-large font-bold text-brand">
                                  {Number(svc.price).toLocaleString("pt-BR", {
                                    style: "currency",
                                    currency: "BRL",
                                  })}
                                </p>
                                <Link href={`/${slug}/agendar`}>
                                  <Button variant="secondary" size="sm" className="font-semibold text-xs h-8 px-3">
                                    Agendar
                                  </Button>
                                </Link>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <Card className="p-8 text-center text-text-muted">
                Nenhum serviço disponível no momento.
              </Card>
            )}
          </div>

          {/* Info & Opening Hours Column (Right 1 Column) */}
          <div className="space-y-8">
            {/* Info Card */}
            <div>
              <h2 className="heading-3 text-text-primary mb-4">Informações de Contato</h2>
              <Card variant="raised" className="p-6 space-y-4">
                <div>
                  <p className="label text-text-muted mb-1">Endereço</p>
                  <p className="body-small font-medium text-text-primary">
                    {barbershop.street}, {barbershop.number}
                    {barbershop.complement ? ` – ${barbershop.complement}` : ""}
                  </p>
                  <p className="body-small text-text-secondary">
                    {barbershop.neighborhood}, {barbershop.city} – {barbershop.state}
                  </p>
                </div>

                {barbershop.phone && (
                  <div>
                    <p className="label text-text-muted mb-1">Telefone / WhatsApp</p>
                    <p className="body-small font-medium text-text-primary">
                      {barbershop.phone}
                    </p>
                  </div>
                )}
              </Card>
            </div>

            {/* Opening Hours */}
            {workingHours.length > 0 && (
              <div>
                <h2 className="heading-3 text-text-primary mb-4">Horários</h2>
                <Card variant="raised" className="p-6">
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const wh = workingHours.find((w) => w.dayOfWeek === d);
                      const isToday = new Date().getDay() === d;
                      return (
                        <div key={d} className={`flex items-center justify-between text-sm py-0.5 ${isToday ? "font-bold text-brand" : "text-text-secondary"}`}>
                          <span className="capitalize">
                            {DAY_NAMES[d].split("-")[0]}
                          </span>
                          <span className={wh ? "text-text-primary font-medium" : "text-text-muted"}>
                            {wh ? `${wh.startTime} – ${wh.endTime}` : "Fechado"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* Team Section */}
        {barbershop.members.length > 0 && (
          <section className="mb-16">
            <div className="text-center mb-10">
              <h2 className="heading-2 mb-1">Nossa Equipe</h2>
              <p className="body-small text-text-secondary">Conheça nossos especialistas prontos para lhe atender.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {barbershop.members.map((m) => (
                <Card key={m.id} variant="raised" className="p-6 text-center hover:border-border-strong transition-all duration-200">
                  <div className="w-20 h-20 rounded-full border-2 border-brand/20 mx-auto mb-4 overflow-hidden flex items-center justify-center relative">
                    <Avatar src={m.user.avatarUrl} alt={m.user.name} size="lg" fallbackText={m.user.name} />
                  </div>

                  <p className="body font-bold text-text-primary">{m.user.name}</p>

                  {m.ratingAvg > 0 ? (
                    <div className="flex items-center justify-center gap-1 mt-1 text-amber-400 text-xs">
                      <span>★ {m.ratingAvg.toFixed(1)}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted mt-1">Especialista</p>
                  )}

                  {m.bio && (
                    <p className="body-small text-text-secondary mt-3 line-clamp-2 italic">
                      "{m.bio}"
                    </p>
                  )}

                  <Divider className="my-4" />

                  <Link href={`/${slug}/agendar`}>
                    <Button variant="secondary" size="sm" className="w-full text-xs">
                      Agendar com profissional
                    </Button>
                  </Link>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Reviews Section */}
        {reviews.length > 0 && (
          <section className="mb-16">
            <div className="text-center mb-10">
              <h2 className="heading-2 mb-1">O que dizem nossos clientes</h2>
              <p className="body-small text-text-secondary">Opiniões de quem já passou pelo nosso atendimento.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {reviews.map((r) => (
                <Card key={r.id} variant="default" className="p-5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="body font-semibold text-text-primary">{r.customer.name}</p>
                      <span className="text-amber-400 text-sm">
                        {"★".repeat(r.rating)}
                        {"☆".repeat(5 - r.rating)}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="body-small text-text-secondary leading-relaxed">
                        {r.comment}
                      </p>
                    )}
                  </div>

                  <div className="pt-4 flex items-center justify-between text-xs text-text-muted border-t border-border-subtle mt-4">
                    <span>Atendimento verificado</span>
                    <span>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Footer CTA */}
        <section className="pb-20 text-center">
          <Card variant="raised" className="p-8 inline-flex flex-col items-center max-w-xl mx-auto border border-brand/30">
            <h3 className="heading-3 mb-2">Pronto para agendar?</h3>
            <p className="body-small text-text-secondary mb-6">Agende online de forma rápida e prática no conforto de seu celular.</p>
            <Link href={`/${slug}/agendar`}>
              <Button variant="primary" size="lg" className="px-10 font-bold">
                Agendar horário
              </Button>
            </Link>
            <p className="text-[10px] text-text-muted mt-6">
              Powered by Tem Barber
            </p>
          </Card>
        </section>

      </div>
    </div>
  );
}
