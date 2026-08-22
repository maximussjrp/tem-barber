"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  formatBrazilianMobilePhone,
  validateBrazilianMobilePhone,
} from "@/lib/phone/br-phone";

interface PublicBarbershopInfo {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
}

interface PublicService {
  id: string;
  name: string;
  durationMin: number;
  price: string;
  description?: string | null;
}

interface PublicMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface WaitlistSessionInfo {
  id: string;
  status: "OPEN" | "PAUSED" | "CLOSED";
  title?: string | null;
  notes?: string | null;
  defaultLockBeforeAppointmentMinutes: number;
  openedAt: string;
}

interface PublicWaitlistStatusResponse {
  barbershop: PublicBarbershopInfo;
  isOpen: boolean;
  session: WaitlistSessionInfo | null;
  services: PublicService[];
  members: PublicMember[];
  waitingCount: number;
  error?: string;
  message?: string;
}

interface WaitlistEntryTracking {
  entryId: string;
  queueNumber: number;
  currentPosition: number;
  status: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName?: string;
  preferredMemberId?: string | null;
  preferredMemberName?: string | null;
  skipCount: number;
  noShowCount: number;
  createdAt: string;
}

interface JoinWaitlistResponse {
  entryId?: string;
  queueNumber?: number;
  position?: number;
  publicToken?: string;
  status?: string;
  trackingUrl?: string;
  error?: string;
  message?: string;
}

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "SKIPPED",
  "NO_SHOW",
  "CANCELED_BY_CUSTOMER",
  "CANCELED_BY_SHOP",
  "EXPIRED",
]);

const STATUS_LABELS: Record<string, string> = {
  WAITING: "Aguardando",
  CALLED: "Você foi chamado",
  FIT_IN_CREATED: "Encaixe criado",
  IN_SERVICE: "Em atendimento",
  COMPLETED: "Finalizado",
  SKIPPED: "Passou a vez",
  NO_SHOW: "Não apareceu",
  MOVED_TO_END: "Movido para o fim da fila",
  CANCELED_BY_CUSTOMER: "Você saiu da fila",
  CANCELED_BY_SHOP: "Removido pela barbearia",
  EXPIRED: "Fila encerrada",
};

function getStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function getStatusClasses(status: string) {
  if (status === "CALLED") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  }

  if (status === "WAITING") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }

  if (status === "CANCELED_BY_CUSTOMER" || status === "CANCELED_BY_SHOP" || status === "NO_SHOW") {
    return "border-red-500/25 bg-red-500/10 text-red-300";
  }

  return "border-stone-700 bg-stone-800/60 text-stone-300";
}

function formatPosition(position: number | null | undefined) {
  if (!position || position <= 0) {
    return "-";
  }

  return `${position}º`;
}

function getFriendlyJoinError(status: number, data: JoinWaitlistResponse) {
  if (data.error === "INVALID_PHONE") {
    return "Informe um número de WhatsApp válido com DDD.";
  }

  if (data.error === "WAITLIST_CLOSED" || status === 400) {
    return data.message || "A fila fechou antes de você entrar. Tente novamente mais tarde.";
  }

  return data.message || "Não foi possível entrar na fila agora.";
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0d0d0e] px-4 py-6 text-stone-100 sm:px-6 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-lg items-center justify-center">
        {children}
      </div>
    </main>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <PageShell>
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p className="text-sm text-stone-400">{label}</p>
      </div>
    </PageShell>
  );
}

function PublicWaitlistContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const slug = (params?.slug as string) || "";
  const queryEntryId = searchParams.get("entryId");
  const queryToken = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [waitlistData, setWaitlistData] = useState<PublicWaitlistStatusResponse | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [preferredMemberId, setPreferredMemberId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeEntryId, setActiveEntryId] = useState<string | null>(queryEntryId);
  const [activeToken, setActiveToken] = useState<string | null>(queryToken);
  const [trackingEntry, setTrackingEntry] = useState<WaitlistEntryTracking | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const services = useMemo(() => waitlistData?.services ?? [], [waitlistData?.services]);
  const members = useMemo(() => waitlistData?.members ?? [], [waitlistData?.members]);
  const barbershop = waitlistData?.barbershop;
  const waitingCount = waitlistData?.waitingCount ?? 0;
  const isOpen = waitlistData?.isOpen ?? false;
  const hasActiveTracking = Boolean(activeEntryId && activeToken && trackingEntry);

  const selectedService = useMemo(
    () => services.find((service) => service.id === serviceId),
    [serviceId, services]
  );

  const fetchStatus = useCallback(async () => {
    if (!slug) return;

    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/public/barbershop/${slug}/waitlist`);

      if (response.status === 404) {
        setNotFound(true);
        return;
      }

      if (!response.ok) {
        throw new Error("Não foi possível carregar a fila agora.");
      }

      const data: PublicWaitlistStatusResponse = await response.json();
      setWaitlistData(data);
      setServiceId((current) => current || data.services[0]?.id || "");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Não foi possível carregar a fila agora.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const fetchTracking = useCallback(
    async (entryId: string, token: string) => {
      if (!slug || !entryId || !token) return;

      setTrackingLoading(true);
      setTrackingError(null);

      try {
        const response = await fetch(
          `/api/public/barbershop/${slug}/waitlist/${entryId}?token=${encodeURIComponent(token)}`
        );

        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setTrackingError("Não foi possível localizar este acompanhamento.");
          return;
        }

        if (!response.ok) {
          throw new Error("Não foi possível atualizar sua posição agora.");
        }

        const data: { entry?: WaitlistEntryTracking } = await response.json();
        if (data.entry) {
          setTrackingEntry(data.entry);
          setLastUpdated(new Date());
        }
      } catch (fetchError) {
        setTrackingError(
          fetchError instanceof Error ? fetchError.message : "Não foi possível atualizar sua posição agora."
        );
      } finally {
        setTrackingLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchStatus();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [fetchStatus]);

  useEffect(() => {
    if (!queryEntryId || !queryToken) return;

    const timeout = window.setTimeout(() => {
      setActiveEntryId(queryEntryId);
      setActiveToken(queryToken);
      fetchTracking(queryEntryId, queryToken);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [queryEntryId, queryToken, fetchTracking]);

  useEffect(() => {
    if (
      !activeEntryId ||
      !activeToken ||
      (trackingEntry?.status && TERMINAL_STATUSES.has(trackingEntry.status))
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      fetchTracking(activeEntryId, activeToken);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [activeEntryId, activeToken, fetchTracking, trackingEntry?.status]);

  function handlePhoneChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCustomerPhone(formatBrazilianMobilePhone(event.target.value));
  }

  async function handleJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!customerName.trim()) {
      setFormError("Informe o seu nome para entrar na fila.");
      return;
    }

    if (!customerPhone.trim() || !validateBrazilianMobilePhone(customerPhone)) {
      setFormError("Informe um número de WhatsApp válido com DDD.");
      return;
    }

    if (!serviceId) {
      setFormError("Selecione um serviço desejado.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/public/barbershop/${slug}/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          serviceId,
          preferredMemberId: preferredMemberId || null,
        }),
      });

      const data: JoinWaitlistResponse = await response.json();

      if (!response.ok) {
        setFormError(getFriendlyJoinError(response.status, data));
        return;
      }

      if (!data.entryId || !data.publicToken) {
        setFormError("Não foi possível abrir o acompanhamento da fila.");
        return;
      }

      setActiveEntryId(data.entryId);
      setActiveToken(data.publicToken);

      const trackingUrl =
        data.trackingUrl || `/${slug}/fila?entryId=${data.entryId}&token=${encodeURIComponent(data.publicToken)}`;
      window.history.replaceState(null, "", trackingUrl);

      await fetchTracking(data.entryId, data.publicToken);
      fetchStatus();
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "Erro ao se conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLeave() {
    if (!activeEntryId || !activeToken) return;

    setIsLeaving(true);

    try {
      const response = await fetch(`/api/public/barbershop/${slug}/waitlist/${activeEntryId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: activeToken }),
      });

      if (!response.ok) {
        const data: { message?: string } = await response.json().catch(() => ({}));
        setTrackingError(data.message || "Não foi possível sair da fila.");
        return;
      }

      setShowLeaveConfirm(false);
      await fetchTracking(activeEntryId, activeToken);
      fetchStatus();
    } catch {
      setTrackingError("Erro de conexão ao sair da fila.");
    } finally {
      setIsLeaving(false);
    }
  }

  if (loading) {
    return <Spinner label="Carregando fila de espera..." />;
  }

  if (notFound) {
    return (
      <PageShell>
        <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-xl text-red-300">
            x
          </div>
          <h1 className="mb-2 text-xl font-bold text-stone-100">Barbearia não encontrada</h1>
          <p className="mb-6 text-sm leading-relaxed text-stone-400">
            A barbearia solicitada não existe ou não está pública no momento.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 transition hover:bg-stone-700"
          >
            Ir para página inicial
          </button>
        </section>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-xl text-amber-300">
            !
          </div>
          <h1 className="mb-2 text-xl font-bold text-stone-100">Não foi possível carregar a fila agora.</h1>
          <p className="mb-6 text-sm leading-relaxed text-stone-400">
            Tente novamente em alguns instantes.
          </p>
          <button
            type="button"
            onClick={fetchStatus}
            className="rounded-md bg-amber-500 px-6 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-400"
          >
            Tentar novamente
          </button>
        </section>
      </PageShell>
    );
  }

  if (hasActiveTracking && trackingEntry) {
    const statusLabel = getStatusLabel(trackingEntry.status);
    const isWaiting = trackingEntry.status === "WAITING";
    const isCalled = trackingEntry.status === "CALLED";
    const isNoShow = trackingEntry.status === "NO_SHOW";
    const canLeave = isWaiting || isCalled;

    return (
      <PageShell>
        <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-5 shadow-2xl sm:p-6">
          <div className="border-b border-stone-800 pb-4 text-center">
            <p className="text-xs font-semibold uppercase text-amber-400">{barbershop?.name || "Barbearia"}</p>
            <h1 className="mt-1 text-2xl font-extrabold text-stone-100">Você entrou na fila!</h1>
            <p className="mt-1 text-sm text-stone-400">Deixe esta tela aberta para acompanhar sua posição.</p>
          </div>

          <div className={`mt-5 rounded-lg border p-4 text-center ${getStatusClasses(trackingEntry.status)}`}>
            <p className="text-xs font-semibold uppercase opacity-80">Status atual</p>
            <p className="mt-1 text-base font-bold">{statusLabel}</p>
          </div>

          {isCalled ? (
            <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
              <h2 className="text-xl font-bold text-emerald-300">Você foi chamado!</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-300">
                Procure a equipe da barbearia.
              </p>
              <p className="mt-3 inline-flex rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-xs text-emerald-200">
                Número da fila: {trackingEntry.queueNumber}
              </p>
            </div>
          ) : isNoShow ? (
            <div className="mt-5 rounded-lg border border-red-500/25 bg-red-500/10 p-5 text-center">
              <h2 className="text-xl font-bold text-red-300">Você foi marcado como não compareceu.</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-300">
                Esta entrada foi removida da fila.
              </p>
            </div>
          ) : isWaiting ? (
            <div className="mt-5 rounded-lg border border-stone-800 bg-[#1c1c1f] p-5 text-center">
              <p className="text-xs font-semibold uppercase text-stone-400">Posição atual</p>
              <p className="mt-2 text-5xl font-black text-amber-400">
                {formatPosition(trackingEntry.currentPosition)}
              </p>
              <p className="mt-2 text-sm font-medium text-stone-300">
                Você está em {formatPosition(trackingEntry.currentPosition)} na fila
              </p>
              <p className="mt-3 inline-flex rounded-full bg-stone-800 px-3 py-1 font-mono text-xs text-stone-300">
                Número da fila: {trackingEntry.queueNumber}
              </p>
            </div>
          ) : null}

          <div className="mt-5 space-y-3 rounded-lg border border-stone-800 bg-[#1a1a1d] p-4 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-stone-800/70 pb-3">
              <span className="text-stone-400">Serviço</span>
              <span className="text-right font-medium text-amber-300">
                {trackingEntry.serviceName || selectedService?.name || "Serviço selecionado"}
              </span>
            </div>
            {trackingEntry.preferredMemberName && (
              <div className="flex items-center justify-between gap-4 border-b border-stone-800/70 pb-3">
                <span className="text-stone-400">Profissional de preferência</span>
                <span className="text-right font-medium text-stone-200">{trackingEntry.preferredMemberName}</span>
              </div>
            )}
            {lastUpdated && (
              <div className="flex items-center justify-between gap-4 text-xs text-stone-500">
                <span>Última atualização</span>
                <span>{lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </div>

          {trackingError && (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {trackingError}
            </p>
          )}

          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={() => activeEntryId && activeToken && fetchTracking(activeEntryId, activeToken)}
              disabled={trackingLoading}
              className="flex w-full items-center justify-center rounded-md bg-stone-800 px-4 py-3 text-sm font-medium text-stone-200 transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {trackingLoading ? "Atualizando..." : "Atualizar agora"}
            </button>

            {canLeave && (
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(true)}
                className="w-full rounded-md border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 transition hover:bg-red-500/20"
              >
                Sair da fila
              </button>
            )}

            {TERMINAL_STATUSES.has(trackingEntry.status) && (
              <button
                type="button"
                onClick={() => {
                  setActiveEntryId(null);
                  setActiveToken(null);
                  setTrackingEntry(null);
                  setTrackingError(null);
                  window.history.replaceState(null, "", `/${slug}/fila`);
                  fetchStatus();
                }}
                className="w-full rounded-md bg-amber-500 px-4 py-3 text-sm font-bold text-stone-950 transition hover:bg-amber-400"
              >
                Entrar novamente na fila
              </button>
            )}
          </div>

          {showLeaveConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
              <div className="w-full max-w-sm rounded-lg border border-stone-800 bg-[#161618] p-6 shadow-2xl">
                <h3 className="text-center text-lg font-bold text-stone-100">Sair da fila</h3>
                <p className="mt-3 text-center text-sm leading-relaxed text-stone-300">
                  Tem certeza que deseja sair da fila? Você perderá sua posição.
                </p>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowLeaveConfirm(false)}
                    disabled={isLeaving}
                    className="flex-1 rounded-md bg-stone-800 px-4 py-2.5 text-sm font-medium text-stone-300 transition hover:bg-stone-700 disabled:opacity-70"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleLeave}
                    disabled={isLeaving}
                    className="flex-1 rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 disabled:opacity-70"
                  >
                    {isLeaving ? "Saindo..." : "Sim, sair"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </PageShell>
    );
  }

  if (activeEntryId && activeToken && !trackingEntry) {
    return (
      <PageShell>
        <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-6 text-center shadow-xl">
          <h1 className="text-xl font-bold text-stone-100">Acompanhamento da fila</h1>
          <p className="mt-2 text-sm text-stone-400">
            {trackingError || "Carregando sua posição na fila..."}
          </p>
          {trackingError && (
            <button
              type="button"
              onClick={() => fetchTracking(activeEntryId, activeToken)}
              className="mt-5 rounded-md bg-amber-500 px-6 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-400"
            >
              Tentar novamente
            </button>
          )}
        </section>
      </PageShell>
    );
  }

  if (!isOpen) {
    return (
      <PageShell>
        <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-6 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase text-amber-400">{barbershop?.name}</p>
          <h1 className="mt-2 text-xl font-bold text-stone-100">Fila indisponível no momento</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-400">
            A fila está fechada no momento. Você pode tentar novamente mais tarde ou agendar um horário.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/${slug}/agendar`)}
            className="mt-6 w-full rounded-md bg-amber-500 px-4 py-3 text-sm font-bold text-stone-950 transition hover:bg-amber-400"
          >
            Agendar um horário
          </button>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="w-full rounded-lg border border-stone-800 bg-[#161618] p-5 shadow-2xl sm:p-6">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-amber-400">{barbershop?.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-stone-100">Fila de espera online</h1>
          <p className="mt-1 text-sm text-stone-400">
            Entre na fila e acompanhe sua posição em tempo real.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-semibold text-emerald-300">Fila aberta agora</span>
          </div>
          <span className="font-medium text-stone-300">{waitingCount} aguardando</span>
        </div>

        {formError && (
          <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            {formError}
          </p>
        )}

        <form onSubmit={handleJoin} className="mt-5 space-y-4" noValidate>
          <div>
            <label htmlFor="waitlist-customer-name" className="mb-1 block text-xs font-medium text-stone-300">
              Nome
            </label>
            <input
              id="waitlist-customer-name"
              type="text"
              placeholder="Digite seu nome completo"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              className="w-full rounded-md border border-stone-800 bg-[#1c1c1f] px-3 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label htmlFor="waitlist-customer-phone" className="mb-1 block text-xs font-medium text-stone-300">
              WhatsApp
            </label>
            <input
              id="waitlist-customer-phone"
              type="tel"
              placeholder="(00) 00000-0000"
              value={customerPhone}
              onChange={handlePhoneChange}
              className="w-full rounded-md border border-stone-800 bg-[#1c1c1f] px-3 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label htmlFor="waitlist-service" className="mb-1 block text-xs font-medium text-stone-300">
              Serviço desejado
            </label>
            <select
              id="waitlist-service"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              className="w-full rounded-md border border-stone-800 bg-[#1c1c1f] px-3 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-500"
              required
            >
              {services.length === 0 ? (
                <option value="">Nenhum serviço disponível</option>
              ) : (
                services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.durationMin} min) - R$ {service.price}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="waitlist-member" className="mb-1 block text-xs font-medium text-stone-300">
              Profissional de preferência <span className="text-stone-500">(opcional)</span>
            </label>
            <select
              id="waitlist-member"
              value={preferredMemberId}
              onChange={(event) => setPreferredMemberId(event.target.value)}
              className="w-full rounded-md border border-stone-800 bg-[#1c1c1f] px-3 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-500"
            >
              <option value="">Qualquer profissional disponível</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || services.length === 0}
            className="w-full rounded-md bg-amber-500 px-4 py-3.5 text-sm font-bold text-stone-950 shadow-lg shadow-amber-500/10 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Entrando na fila..." : "Entrar na fila"}
          </button>
        </form>
      </section>
    </PageShell>
  );
}

export default function PublicWaitlistPage() {
  return (
    <Suspense fallback={<Spinner label="Carregando..." />}>
      <PublicWaitlistContent />
    </Suspense>
  );
}
