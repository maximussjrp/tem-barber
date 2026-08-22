"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type WaitlistStatus =
  | "OPEN"
  | "PAUSED"
  | "CLOSED";

type EntryStatus =
  | "WAITING"
  | "CALLED"
  | "FIT_IN_CREATED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "SKIPPED"
  | "NO_SHOW"
  | "MOVED_TO_END"
  | "CANCELED_BY_CUSTOMER"
  | "CANCELED_BY_SHOP"
  | "EXPIRED";

interface WaitlistEntry {
  id: string;
  customerName: string;
  maskedPhone: string;
  serviceName: string | null;
  preferredMemberName: string | null;
  queueNumber: number;
  currentPosition: number | null;
  status: EntryStatus;
  joinedAt: string;
  skipCount: number;
  noShowCount: number;
  calledByMemberId: string | null;
  calledByMemberName: string | null;
}

interface WaitlistSession {
  id: string;
  status: WaitlistStatus;
  openedAt: string;
  closedAt: string | null;
  title: string | null;
  entries: WaitlistEntry[];
}

interface WaitlistSummary {
  total: number;
  waiting: number;
  called: number;
  inService: number;
  completed: number;
  canceled: number;
  expired: number;
}

interface WaitlistMember {
  id: string;
  name: string;
}

interface WaitlistResponse {
  barbershop: { id: string; name: string; slug: string } | null;
  publicUrl: string | null;
  members?: WaitlistMember[];
  session: WaitlistSession | null;
  summary: WaitlistSummary;
}

const initialSummary: WaitlistSummary = {
  total: 0,
  waiting: 0,
  called: 0,
  inService: 0,
  completed: 0,
  canceled: 0,
  expired: 0,
};

const statusLabels: Record<EntryStatus, string> = {
  WAITING: "Aguardando",
  CALLED: "Chamado",
  FIT_IN_CREATED: "Encaixe criado",
  IN_SERVICE: "Em atendimento",
  COMPLETED: "Finalizado",
  SKIPPED: "Passou a vez",
  NO_SHOW: "Não apareceu",
  MOVED_TO_END: "Movido para o fim",
  CANCELED_BY_CUSTOMER: "Saiu da fila",
  CANCELED_BY_SHOP: "Removido",
  EXPIRED: "Expirado",
};

const sessionLabels: Record<WaitlistStatus, string> = {
  OPEN: "Aberta",
  PAUSED: "Pausada",
  CLOSED: "Fechada",
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as { error?: unknown; message?: unknown };
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  return fallback;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildEmptyResponse(): WaitlistResponse {
  return {
    barbershop: null,
    publicUrl: null,
    members: [],
    session: null,
    summary: initialSummary,
  };
}

export default function AdminWaitlistPage() {
  const [data, setData] = useState<WaitlistResponse>(buildEmptyResponse);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callNextSuccess, setCallNextSuccess] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [mismatchModal, setMismatchModal] = useState<{
    memberId: string;
    preferredMemberName: string;
  } | null>(null);

  const loadWaitlist = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/waitlist", { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (response.status === 403) {
        setError(null);
        setAccessDenied(true);
        setData(buildEmptyResponse());
        return;
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Não foi possível carregar a fila."));
      }

      setError(null);
      setAccessDenied(false);
      const resData = payload as WaitlistResponse;
      setData(resData);

      if (resData.members && resData.members.length > 0) {
        setSelectedMemberId((prev) => (prev ? prev : resData.members![0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a fila.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadWaitlist());
    const interval = window.setInterval(() => {
      void loadWaitlist();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [loadWaitlist]);

  async function runAction(action: "open" | "pause" | "close") {
    if (action === "close" && !window.confirm("Fechar a fila online agora? Clientes pendentes serão expirados.")) {
      return;
    }

    const endpoint = `/api/admin/waitlist/${action}`;
    setActionLoading(action);
    setError(null);
    setCallNextSuccess(null);

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Não foi possível atualizar a fila."));
      }

      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a fila.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCallNext(memberIdToCall: string, confirmPreferredMismatch = false) {
    if (!memberIdToCall) {
      setError("Selecione um profissional para chamar o próximo cliente.");
      return;
    }

    setActionLoading("call-next");
    setError(null);
    setCallNextSuccess(null);

    try {
      const response = await fetch("/api/admin/waitlist/call-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: memberIdToCall,
          confirmPreferredMismatch,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 409 && payload?.error === "PREFERRED_MEMBER_MISMATCH") {
        setMismatchModal({
          memberId: memberIdToCall,
          preferredMemberName: payload.preferredMember?.name ?? "outro profissional",
        });
        return;
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Não foi possível chamar o próximo cliente."));
      }

      setMismatchModal(null);
      setCallNextSuccess("Cliente chamado. Confirme a presença antes de iniciar o atendimento.");
      window.setTimeout(() => setCallNextSuccess(null), 5000);
      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível chamar o próximo cliente.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleEntryAction(entryId: string, memberId: string, action: "start-service" | "pass-turn" | "no-show") {
    if (action === "no-show" && !window.confirm("Marcar este cliente como não compareceu e removê-lo da fila?")) {
      return;
    }
    setActionLoading(`${action}:${entryId}`);
    setError(null);
    try {
      const response = await fetch(`/api/admin/waitlist/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "no-show" ? { entryId } : { entryId, memberId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Não foi possível atualizar a entrada."));
      setCallNextSuccess(
        action === "start-service"
          ? "Atendimento criado na sua agenda com sucesso."
          : action === "no-show"
            ? "Cliente marcado como não compareceu."
            : "Cliente passou a vez."
      );
      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a entrada.");
    } finally {
      setActionLoading(null);
    }
  }

  const publicUrl = useMemo(() => {
    if (data.publicUrl) return data.publicUrl;
    if (data.barbershop?.slug) {
      return `https://app.tembarber.com.br/${data.barbershop.slug}/fila`;
    }
    return null;
  }, [data.publicUrl, data.barbershop?.slug]);

  async function copyPublicUrl() {
    if (!publicUrl) return;

    try {
      await navigator.clipboard?.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Não foi possível copiar o link automaticamente.");
    }
  }

  const entries = useMemo(() => data.session?.entries ?? [], [data.session?.entries]);
  const waitingEntries = useMemo(
    () => entries.filter((entry) => entry.status === "WAITING"),
    [entries]
  );
  const isOpen = data.session?.status === "OPEN";
  const isPaused = data.session?.status === "PAUSED";

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-stone-800" />
          <div className="h-40 animate-pulse rounded-lg bg-stone-900 ring-1 ring-stone-800" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-24 animate-pulse rounded-lg bg-stone-900 ring-1 ring-stone-800" />
            <div className="h-24 animate-pulse rounded-lg bg-stone-900 ring-1 ring-stone-800" />
            <div className="h-24 animate-pulse rounded-lg bg-stone-900 ring-1 ring-stone-800" />
          </div>
        </div>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-900/60 bg-red-950/30 p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-red-200">Acesso negado</p>
          <h1 className="mt-2 text-2xl font-semibold">Fila Online</h1>
          <p className="mt-3 text-sm text-red-100">
            Apenas OWNER e MANAGER podem operar a fila online neste painel.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-stone-800 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Fila Online</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Painel da fila</h1>
            <p className="mt-2 text-sm text-stone-400">
              Acompanhe a fila pública e controle se clientes podem entrar pelo link.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!data.session || data.session.status === "CLOSED" ? (
              <button
                type="button"
                onClick={() => void runAction("open")}
                disabled={actionLoading !== null}
                className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "open" ? "Abrindo..." : "Abrir fila"}
              </button>
            ) : null}

            {isOpen ? (
              <button
                type="button"
                onClick={() => void runAction("pause")}
                disabled={actionLoading !== null}
                className="rounded-md border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100 hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "pause" ? "Pausando..." : "Pausar fila"}
              </button>
            ) : null}

            {isPaused ? (
              <button
                type="button"
                onClick={() => void runAction("open")}
                disabled={actionLoading !== null}
                className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "open" ? "Retomando..." : "Retomar fila"}
              </button>
            ) : null}

            {data.session && data.session.status !== "CLOSED" ? (
              <button
                type="button"
                onClick={() => void runAction("close")}
                disabled={actionLoading !== null}
                className="rounded-md border border-red-800 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "close" ? "Fechando..." : "Fechar fila"}
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <div role="alert" className="rounded-lg border border-red-900/70 bg-red-950/40 p-4 text-sm text-red-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void loadWaitlist()}
                className="rounded-md border border-red-700 px-3 py-1.5 text-xs font-semibold text-red-50 hover:bg-red-900/50"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : null}

        {callNextSuccess ? (
          <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm font-medium text-emerald-200">
            {callNextSuccess}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-stone-800 bg-stone-900/70 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm text-stone-400">Status atual</p>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      isOpen ? "bg-emerald-400" : isPaused ? "bg-amber-300" : "bg-stone-500"
                    }`}
                  />
                  <h2 className="text-2xl font-semibold text-white">
                    {data.session ? sessionLabels[data.session.status] : "Sem fila aberta"}
                  </h2>
                </div>
                <p className="mt-2 text-sm text-stone-400">
                  {data.session
                    ? `Aberta em ${formatDateTime(data.session.openedAt)}`
                    : "Abra a fila para liberar a entrada pelo link público."}
                </p>
              </div>
              <div className="rounded-md bg-stone-950 px-4 py-3 text-center ring-1 ring-stone-800">
                <p className="text-xs uppercase tracking-wide text-stone-500">Aguardando</p>
                <p className="mt-1 text-3xl font-semibold text-white">{data.summary.waiting}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-sm font-semibold text-white">Link público</p>
            {publicUrl ? (
              <>
                <p className="mt-2 break-all rounded-md bg-stone-950 p-3 text-sm text-stone-200 ring-1 ring-stone-800">
                  {publicUrl}
                </p>
                <button
                  type="button"
                  onClick={() => void copyPublicUrl()}
                  className="mt-3 rounded-md border border-stone-700 px-3 py-2 text-sm font-semibold text-stone-100 hover:bg-stone-800"
                >
                  {copied ? "Link copiado" : "Copiar link"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm text-stone-400">Link indisponível para esta barbearia.</p>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Total" value={data.summary.total} />
          <SummaryCard label="Chamados" value={data.summary.called} />
          <SummaryCard label="Em atendimento" value={data.summary.inService} />
          <SummaryCard label="Finalizados" value={data.summary.completed} />
          <SummaryCard label="Cancelados/expirados" value={data.summary.canceled + data.summary.expired} />
        </section>

        <section className="rounded-lg border border-stone-800 bg-stone-900/70">
          <div className="flex flex-col gap-4 border-b border-stone-800 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Clientes na fila</h2>
              <p className="text-sm text-stone-400">Ao chamar, um agendamento de encaixe (FIT_IN) é criado automaticamente.</p>
            </div>

            {isOpen && waitingEntries.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                {data.members && data.members.length > 0 ? (
                  <select
                    aria-label="Selecione o profissional"
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    className="rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-sm font-medium text-stone-100 focus:border-amber-400 focus:outline-none"
                  >
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleCallNext(selectedMemberId)}
                  disabled={actionLoading !== null || !selectedMemberId}
                  className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoading === "call-next" ? "Chamando..." : "Chamar próximo"}
                </button>
              </div>
            ) : (
              <span className="w-fit rounded-full bg-stone-950 px-3 py-1 text-xs font-semibold text-stone-300 ring-1 ring-stone-800">
                {waitingEntries.length} aguardando
              </span>
            )}
          </div>

          {entries.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-medium text-white">Nenhum cliente na fila</p>
              <p className="mt-2 text-sm text-stone-400">
                Quando clientes entrarem pelo link público, eles aparecerão aqui.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-800">
              {entries.map((entry) => (
                <article key={entry.id} className="grid gap-4 p-5 lg:grid-cols-[0.7fr_1.4fr_1fr_1fr_0.8fr] lg:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Senha</p>
                    <p className="mt-1 text-2xl font-semibold text-white">#{entry.queueNumber}</p>
                    {entry.currentPosition ? (
                      <p className="text-xs text-amber-200">Posição {entry.currentPosition}</p>
                    ) : null}
                  </div>

                  <div>
                    <p className="font-semibold text-white">{entry.customerName}</p>
                    <p className="mt-1 text-sm text-stone-400">{entry.maskedPhone}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Serviço</p>
                    <p className="mt-1 text-sm font-medium text-stone-100">{entry.serviceName ?? "Serviço removido"}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Preferência</p>
                    <p className="mt-1 text-sm font-medium text-stone-100">
                      {entry.preferredMemberName ?? "Sem preferência"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 lg:items-end">
                    <span className="w-fit rounded-full bg-stone-950 px-3 py-1 text-xs font-semibold text-stone-200 ring-1 ring-stone-800">
                      {statusLabels[entry.status]}
                    </span>
                    <span className="text-xs text-stone-500">
                      Passes {entry.skipCount} / no-shows {entry.noShowCount}
                    </span>
                    <span className="text-xs text-stone-500">{formatDateTime(entry.joinedAt)}</span>
                    {entry.status === "CALLED" && entry.calledByMemberId ? (
                      <>
                        <span className="text-xs text-amber-300">Chamado por {entry.calledByMemberName ?? "profissional"}</span>
                        <button type="button" onClick={() => void handleEntryAction(entry.id, entry.calledByMemberId!, "start-service")} disabled={actionLoading !== null} className="rounded-md bg-emerald-500 px-2 py-1 text-xs font-semibold text-stone-950 disabled:opacity-60">
                          {actionLoading === `start-service:${entry.id}` ? "Iniciando..." : "Iniciar atendimento"}
                        </button>
                        <button type="button" onClick={() => void handleEntryAction(entry.id, entry.calledByMemberId!, "pass-turn")} disabled={actionLoading !== null} className="rounded-md border border-stone-700 px-2 py-1 text-xs font-semibold text-stone-200 disabled:opacity-60">
                          {actionLoading === `pass-turn:${entry.id}` ? "Passando..." : "Passar vez"}
                        </button>
                        <button type="button" onClick={() => void handleEntryAction(entry.id, entry.calledByMemberId!, "no-show")} disabled={actionLoading !== null} className="rounded-md border border-red-700 bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950/60 disabled:opacity-60">
                          {actionLoading === `no-show:${entry.id}` ? "Marcando..." : "Não apareceu"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {mismatchModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-stone-800 bg-stone-900 p-6 text-stone-100 shadow-xl">
            <h3 className="text-lg font-semibold text-amber-300">Preferência divergente</h3>
            <p className="mt-3 text-sm text-stone-300">
              Este cliente indicou preferência por <strong className="text-white">{mismatchModal.preferredMemberName}</strong>. Deseja chamar com o profissional selecionado mesmo assim?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setMismatchModal(null)}
                className="rounded-md border border-stone-700 px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCallNext(mismatchModal.memberId, true)}
                className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300"
              >
                Confirmar e chamar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/70 p-4">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
