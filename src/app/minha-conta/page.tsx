"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type AppStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

interface AppointmentItem {
  id: string;
  dateTime: string;
  totalPrice: string;
  durationMin: number;
  status: AppStatus;
  notes: string | null;
  barbershop: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    city: string;
    state: string;
  };
  barber: { user: { name: string; avatarUrl: string | null } };
  services: { service: { name: string; durationMin: number } }[];
  review: { id: string; rating: number; comment: string | null } | null;
}

const STATUS_LABEL: Record<AppStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

const STATUS_CLASS: Record<AppStatus, string> = {
  PENDING:   "badge badge-pending",
  CONFIRMED: "badge badge-confirmed",
  COMPLETED: "badge badge-completed",
  CANCELLED: "badge badge-cancelled",
  NO_SHOW:   "badge badge-noshow",
};

function isFuture(dateTime: string) {
  return new Date(dateTime).getTime() > Date.now() + 60_000;
}

export default function MinhaContaPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?next=/minha-conta");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/client/appointments")
        .then((r) => r.json())
        .then(setAppointments)
        .finally(() => setLoading(false));
    }
  }, [status]);

  const handleCancel = async (id: string) => {
    setCancelling(id);
    setCancelError("");
    try {
      const res = await fetch("/api/client/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Erro ao cancelar.");
      }
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "CANCELLED" as AppStatus } : a))
      );
    } catch (e: any) {
      setCancelError(e.message);
    } finally {
      setCancelling(null);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6 max-w-xl mx-auto">
        <div className="h-8 w-44 rounded-xl bg-[var(--surface-2)] animate-pulse mb-8" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-[var(--surface-1)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const upcoming = appointments.filter(
    (a) => isFuture(a.dateTime) && ["PENDING", "CONFIRMED"].includes(a.status)
  );
  const past = appointments.filter(
    (a) => !isFuture(a.dateTime) || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)
  );

  const renderCard = (a: AppointmentItem) => {
    const dt = new Date(a.dateTime);
    const price = parseFloat(a.totalPrice).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const serviceNames = a.services.map((s) => s.service.name).join(", ");
    const future = isFuture(a.dateTime) && ["PENDING", "CONFIRMED"].includes(a.status);

    return (
      <div
        key={a.id}
        className={`border rounded-2xl p-4 space-y-4 transition-all ${
          future
            ? "border-[var(--gold-border)] bg-[var(--surface-1)] glow-gold-sm"
            : "border-[var(--border-subtle)] bg-[var(--surface-1)] opacity-60"
        }`}
      >
        {/* Barbershop header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--gold-surface)] border border-[var(--gold-border)] overflow-hidden flex items-center justify-center shrink-0">
              {a.barbershop.logoUrl ? (
                <img src={a.barbershop.logoUrl} alt={a.barbershop.name} className="w-full h-full object-cover" />
              ) : (
                <span className="font-serif font-bold text-[var(--gold)] text-sm">{a.barbershop.name.charAt(0)}</span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{a.barbershop.name}</p>
              <p className="text-xs text-[var(--text-muted)]">{a.barbershop.city}, {a.barbershop.state}</p>
            </div>
          </div>
          <span className={STATUS_CLASS[a.status]}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {STATUS_LABEL[a.status]}
          </span>
        </div>

        <div className="divider-gold" />

        {/* Date + service */}
        <div className="flex items-center gap-4">
          <div className="bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-center min-w-[56px] shrink-0">
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] tabular-nums leading-none">
              {dt.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: "UTC" })}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-0.5">
              {dt.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{serviceNames}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} · com {a.barber.user.name} · {a.durationMin}min
            </p>
          </div>
          <p className="font-serif font-bold text-[var(--gold)] shrink-0">{price}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {future && (
            <button
              onClick={() => handleCancel(a.id)}
              disabled={cancelling === a.id}
              className="flex-1 sm:flex-none text-sm font-bold px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {cancelling === a.id ? "Cancelando..." : "Cancelar"}
            </button>
          )}
          {a.status === "COMPLETED" && !a.review && (
            <Link
              href={`/avaliar/${a.id}`}
              className="flex-1 sm:flex-none text-center btn-outline-gold min-h-[44px] text-sm"
            >
              ★ Avaliar
            </Link>
          )}
          {a.status === "COMPLETED" && (
            <Link
              href={`/${a.barbershop.slug}/agendar`}
              className="flex-1 sm:flex-none text-center text-sm font-semibold px-4 py-2.5 rounded-xl bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors min-h-[44px] flex items-center justify-center"
            >
              Repetir
            </Link>
          )}
        </div>

        {cancelError && cancelling === null && (
          <p className="text-xs text-red-400">{cancelError}</p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--bg)]/95 backdrop-blur border-b border-[var(--border-subtle)]">
        <div className="px-4 py-4 max-w-xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Voltar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <div>
            <h1 className="font-serif text-lg font-bold text-[var(--text-primary)]">Meus agendamentos</h1>
            <p className="text-xs text-[var(--text-muted)]">{session?.user?.name}</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-8">
        {appointments.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto mb-5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <p className="text-[var(--text-secondary)] font-semibold">Nenhum agendamento ainda</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Encontre uma barbearia e agende seu horário</p>
            <Link
              href="/"
              className="mt-5 inline-block btn-gold px-6 py-2.5 text-sm"
            >
              Explorar barbearias
            </Link>
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-bold text-[var(--gold)] uppercase tracking-widest">Próximos</span>
              <span className="w-5 h-5 rounded-full bg-[var(--gold-surface)] border border-[var(--gold-border)] text-[10px] font-bold text-[var(--gold)] flex items-center justify-center">{upcoming.length}</span>
            </div>
            <div className="space-y-3">{upcoming.map(renderCard)}</div>
          </section>
        )}

        {past.length > 0 && (
          <section>
            <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Histórico</p>
            <div className="space-y-3">{past.map(renderCard)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
