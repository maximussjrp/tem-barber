import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { Avatar } from "@/components/ui/Avatar";
const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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
  const barbershop = await prisma.barbershop.findUnique({ where: { slug } });
  if (!barbershop) return { title: "Barbearia não encontrada" };
  return {
    title: `${barbershop.name} | Tem Barber`,
    description: barbershop.description ?? `Agende agora na ${barbershop.name}`,
  };
}

export default async function BarbershopPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Fetch full profile via direct Prisma (SSR — no auth needed)
  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
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

  if (!barbershop) notFound();

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

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Cover */}
      <div className="relative h-52 md:h-72 bg-stone-900 overflow-hidden">
        {barbershop.coverUrl ? (
          <img
            src={barbershop.coverUrl}
            alt="Capa"
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-stone-900 to-stone-800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-transparent to-transparent" />
      </div>

      {/* Header info */}
      <div className="max-w-3xl mx-auto px-4">
        <div className="relative -mt-12 flex items-end gap-5 mb-6">
          {/* Logo */}
          <div className="shrink-0 w-24 h-24 rounded-2xl bg-stone-800 border-4 border-stone-950 overflow-hidden flex items-center justify-center shadow-xl">
            {barbershop.logoUrl ? (
              <img src={barbershop.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl">✂️</span>
            )}
          </div>
          <div className="pb-1">
            <h1 className="text-2xl font-serif font-bold text-stone-100 leading-tight">
              {barbershop.name}
            </h1>
            <p className="text-sm text-stone-400 mt-0.5">
              {barbershop.neighborhood}, {barbershop.city} – {barbershop.state}
            </p>
            {avgRating !== null && (
              <p className="text-sm text-amber-400 mt-1 font-semibold">
                ★ {avgRating.toFixed(1)}{" "}
                <span className="text-stone-500 font-normal">({reviews.length} avaliações)</span>
              </p>
            )}
          </div>
        </div>

        {/* Book CTA */}
        <Link
          href={`/${slug}/agendar`}
          className="block w-full text-center bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold py-4 rounded-xl transition-colors text-base mb-8"
        >
          Agendar agora
        </Link>

        {/* Description */}
        {barbershop.description && (
          <section className="mb-8">
            <p className="text-stone-400 text-sm leading-relaxed">{barbershop.description}</p>
          </section>
        )}

        {/* Info bar */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider font-semibold">Endereço</p>
            <p className="text-sm text-stone-300">
              {barbershop.street}, {barbershop.number}
              {barbershop.complement ? ` – ${barbershop.complement}` : ""}
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              {barbershop.neighborhood}, {barbershop.city}
            </p>
          </div>
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
            <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider font-semibold">Telefone</p>
            <p className="text-sm text-stone-300">{barbershop.phone}</p>
          </div>
        </div>

        {/* Working hours */}
        {workingHours.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
              Horários de funcionamento
            </h2>
            <div className="bg-stone-900 border border-stone-800 rounded-xl divide-y divide-stone-800">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const wh = workingHours.find((w) => w.dayOfWeek === d);
                return (
                  <div key={d} className="flex items-center justify-between px-4 py-2.5">
                    <span
                      className={`text-sm ${wh ? "text-stone-300" : "text-stone-600"}`}
                    >
                      {DAY_NAMES[d]}
                    </span>
                    <span className={`text-sm ${wh ? "text-stone-400" : "text-stone-700"}`}>
                      {wh ? `${wh.startTime} – ${wh.endTime}` : "Fechado"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Services */}
        {barbershop.categories.filter((c) => c.services.length > 0).length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
              Serviços
            </h2>
            <div className="space-y-4">
              {barbershop.categories
                .filter((c) => c.services.length > 0)
                .map((cat) => (
                  <div key={cat.id}>
                    <p className="text-xs text-amber-500/80 font-semibold uppercase tracking-wider mb-2">
                      {cat.name}
                    </p>
                    <div className="bg-stone-900 border border-stone-800 rounded-xl divide-y divide-stone-800">
                      {cat.services.map((svc) => (
                        <div
                          key={svc.id}
                          className="flex items-center justify-between px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-stone-200">{svc.name}</p>
                            {svc.description && (
                              <p className="text-xs text-stone-500 mt-0.5">{svc.description}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <p className="text-sm font-bold text-amber-400">
                              {Number(svc.price).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </p>
                            <p className="text-xs text-stone-600">{svc.durationMin}min</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Team */}
        {barbershop.members.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
              Nossa equipe
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {barbershop.members.map((m) => (
                <div
                  key={m.id}
                  className="bg-stone-900 border border-stone-800 rounded-xl p-4 text-center"
                >
                  <div className="w-14 h-14 rounded-full border border-stone-800 mx-auto mb-3 overflow-hidden flex items-center justify-center relative">
                    <Avatar src={m.user.avatarUrl} alt={m.user.name} size="lg" fallbackText={m.user.name} />
                  </div>
                  <p className="text-sm font-semibold text-stone-200">{m.user.name}</p>
                  {m.ratingAvg > 0 && (
                    <p className="text-xs text-amber-400 mt-0.5">★ {m.ratingAvg.toFixed(1)}</p>
                  )}
                  {m.bio && (
                    <p className="text-xs text-stone-500 mt-1 line-clamp-2">{m.bio}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-3">
              Avaliações
            </h2>
            <div className="space-y-3">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-stone-200">{r.customer.name}</p>
                    <span className="text-amber-400 text-sm">
                      {"★".repeat(r.rating)}
                      {"☆".repeat(5 - r.rating)}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-sm text-stone-400">{r.comment}</p>
                  )}
                  <p className="text-xs text-stone-600 mt-1">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer CTA */}
        <div className="pb-10 text-center">
          <Link
            href={`/${slug}/agendar`}
            className="inline-block bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold py-4 px-8 rounded-xl transition-colors text-base"
          >
            Agendar agora
          </Link>
        </div>
      </div>
    </div>
  );
}
