"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
}

interface MemberWaitlistResponse {
  session: {
    id: string;
    status: "OPEN" | "PAUSED" | "CLOSED";
    entries: WaitlistEntry[];
  } | null;
  summary: {
    total: number;
    waiting: number;
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as { error?: unknown; message?: unknown };
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  return fallback;
}

export default function MemberWaitlistPage() {
  const [data, setData] = useState<MemberWaitlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mismatchModal, setMismatchModal] = useState<{
    preferredMemberName: string;
  } | null>(null);

  const loadWaitlist = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/waitlist", { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Não foi possível carregar a fila."));
      }

      setData(payload as MemberWaitlistResponse);
      setError(null);
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

  async function handleCallNext(confirmPreferredMismatch = false) {
    setCalling(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/member/waitlist/call-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmPreferredMismatch }),
      });

      const payload = await response.json().catch(() => null);

      if (response.status === 409 && payload?.error === "PREFERRED_MEMBER_MISMATCH") {
        setMismatchModal({
          preferredMemberName: payload.preferredMember?.name ?? "outro profissional",
        });
        return;
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Não foi possível chamar o próximo cliente."));
      }

      setMismatchModal(null);
      setSuccess("Encaixe criado na sua agenda com sucesso!");
      window.setTimeout(() => setSuccess(null), 5000);
      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível chamar o próximo cliente.");
    } finally {
      setCalling(false);
    }
  }

  const entries = useMemo(() => data?.session?.entries ?? [], [data?.session?.entries]);
  const nextWaitingClient = useMemo(
    () => entries.find((entry) => entry.status === "WAITING"),
    [entries]
  );
  const waitingCount = useMemo(
    () => entries.filter((e) => e.status === "WAITING").length,
    [entries]
  );
  const isOpen = data?.session?.status === "OPEN";

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-stone-800" />
          <div className="h-40 animate-pulse rounded-lg bg-stone-900 ring-1 ring-stone-800" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="border-b border-stone-800 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Área do Profissional</p>
          <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Fila Online</h1>
          <p className="mt-2 text-sm text-stone-400">
            Chame o próximo cliente da fila diretamente para a sua agenda.
          </p>
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

        {success ? (
          <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm font-medium text-emerald-200">
            {success}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-sm text-stone-400">Status da fila</p>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full ${
                  isOpen ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <h2 className="text-xl font-semibold text-white">
                {isOpen ? "Fila Aberta" : "Fila Fechada / Pausada"}
              </h2>
            </div>
          </div>

          <div className="rounded-lg border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-sm text-stone-400">Clientes aguardando</p>
            <p className="mt-2 text-3xl font-semibold text-white">{waitingCount}</p>
          </div>
        </section>

        <section className="rounded-lg border border-stone-800 bg-stone-900/70 p-6">
          <h2 className="text-lg font-semibold text-white">Próximo cliente</h2>

          {!isOpen ? (
            <p className="mt-4 text-sm text-stone-400">A fila online não está aberta no momento.</p>
          ) : !nextWaitingClient ? (
            <p className="mt-4 text-sm text-stone-400">Nenhum cliente aguardando na fila.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-md bg-stone-950 p-4 ring-1 ring-stone-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-stone-500">Senha #{nextWaitingClient.queueNumber}</span>
                    <h3 className="mt-1 text-xl font-semibold text-white">{nextWaitingClient.customerName}</h3>
                    <p className="text-sm text-stone-400">{nextWaitingClient.maskedPhone}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs uppercase tracking-wide text-stone-500">Serviço</p>
                    <p className="text-sm font-medium text-stone-200">{nextWaitingClient.serviceName ?? "Não especificado"}</p>
                    {nextWaitingClient.preferredMemberName ? (
                      <p className="mt-1 text-xs text-amber-300">
                        Preferência: {nextWaitingClient.preferredMemberName}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-stone-500">Sem preferência</p>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleCallNext(false)}
                disabled={calling}
                className="w-full rounded-md bg-amber-400 py-3 text-center text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-6"
              >
                {calling ? "Chamando..." : "Chamar próximo para mim"}
              </button>
            </div>
          )}
        </section>
      </div>

      {mismatchModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-stone-800 bg-stone-900 p-6 text-stone-100 shadow-xl">
            <h3 className="text-lg font-semibold text-amber-300">Preferência divergente</h3>
            <p className="mt-3 text-sm text-stone-300">
              Este cliente indicou preferência por <strong className="text-white">{mismatchModal.preferredMemberName}</strong>. Deseja chamar para o seu atendimento mesmo assim?
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
                onClick={() => void handleCallNext(true)}
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
