"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Period = {
  id: string;
  competence: string;
  status: string;
  generatedAmount: string;
  releasedAmount: string;
  paidAmount: string;
  reversedAmount: string;
  balanceAmount: string;
  member: { user: { name: string } };
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CommissionPeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/admin/commissions/periods?competence=${competence}`);
    setPeriods(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(() => setError("Erro ao carregar periodos."));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competence]);

  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; id: string; kind: "close" | "pay" | null }>({ isOpen: false, id: "", kind: null });

  async function handleConfirm() {
    const { id, kind } = confirmDialog;
    if (!id || !kind) return;
    setBusy(`${kind}:${id}`);
    setConfirmDialog({ isOpen: false, id: "", kind: null });
    const res = await fetch(`/api/admin/commissions/periods/${id}/${kind}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erro na operacao.");
    }
    await load();
    setBusy("");
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Períodos de Comissão</h1>
          <p className="text-sm text-[var(--text-muted)]">Revise, feche e pague apenas saldos liberados.</p>
        </div>
        <input
          type="month"
          value={competence}
          onChange={(e) => {
            setLoading(true);
            setCompetence(e.target.value);
          }}
          className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
        />
      </div>
      {error && <div className="rounded-lg border border-[var(--border-danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : periods.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
          Nenhum período encontrado.
        </div>
      ) : (
        <div className="grid gap-3">
          {periods.map((period) => (
            <div key={period.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm hover:border-[var(--border-medium)] transition-colors">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <p className="text-[var(--text-primary)] font-semibold">{period.member.user.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {period.competence} /{" "}
                    <span className={`px-2 py-0.5 rounded text-xxs font-bold ${
                      period.status === "PAID" ? "bg-[var(--success-subtle)] text-emerald-400 border border-emerald-950/20" :
                      period.status === "CLOSED" ? "bg-[var(--surface-raised)] text-[var(--text-muted)]" :
                      "bg-blue-500/10 text-blue-400"
                    }`}>
                      {period.status === "PAID" ? "Pago" : period.status === "CLOSED" ? "Fechado" : "Aberto"}
                    </span>
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  <span className="text-[var(--text-secondary)]">Gerado <b className="block text-[var(--text-primary)] font-serif font-semibold">{brl(period.generatedAmount)}</b></span>
                  <span className="text-[var(--text-secondary)]">Liberado <b className="block text-emerald-400 font-serif font-bold">{brl(period.releasedAmount)}</b></span>
                  <span className="text-[var(--text-secondary)]">Pago <b className="block text-[var(--text-primary)] font-serif font-semibold">{brl(period.paidAmount)}</b></span>
                  <span className="text-[var(--text-secondary)]">Reversões <b className="block text-red-400 font-serif">{brl(period.reversedAmount)}</b></span>
                  <span className="text-[var(--text-secondary)]">Saldo <b className="block text-[var(--gold)] font-serif font-bold">{brl(period.balanceAmount)}</b></span>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={period.status !== "OPEN" || busy !== ""}
                    onClick={() => setConfirmDialog({ isOpen: true, id: period.id, kind: "close" })}
                    className="px-3 py-2 rounded-lg border border-[var(--gold-border)] text-[var(--gold)] text-sm hover:bg-[var(--brand-subtle)] transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {busy === `close:${period.id}` ? "Fechando..." : "Fechar Período"}
                  </button>
                  <button
                    disabled={period.status === "PAID" || busy !== ""}
                    onClick={() => setConfirmDialog({ isOpen: true, id: period.id, kind: "pay" })}
                    className="px-3 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] text-sm font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {busy === `pay:${period.id}` ? "Pagando..." : "Marcar Pago"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, id: "", kind: null })}
        onConfirm={handleConfirm}
        title={confirmDialog.kind === "close" ? "Fechar período" : "Marcar como pago"}
        description={`Tem certeza que deseja ${confirmDialog.kind === "close" ? "fechar" : "marcar como pago"} este período?`}
        confirmLabel="Confirmar"
      />
    </div>
  );
}
