"use client";

import { useEffect, useState } from "react";
import { ClubConfirmDialog } from "@/components/admin/clube/ClubConfirmDialog";
import { ClubStatusBadge } from "@/components/admin/clube/ClubStatusBadge";
import { CyclePotCard } from "@/components/admin/clube/CyclePotCard";
import { CycleBarberCard } from "@/components/admin/clube/CycleBarberCard";
import { CurrentCycleSummary } from "@/lib/operations/club-current-cycle";

type Member = {
  id: string;
  barbershopMemberId: string;
  pointsShare: string;
  amount: string;
  member: { user: { name: string } };
};

type Settlement = {
  id: string;
  competence: string;
  status: string;
  totalRevenue: string;
  shopAmount: string;
  barberPoolAmount: string;
  carryInAmount: string;
  carryOutAmount: string;
  totalPoints: string;
  members: Member[];
};

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pts(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function currentCompetence() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function FechamentosPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [currentCycle, setCurrentCycle] = useState<CurrentCycleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycleLoading, setCycleLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [calcCompetence, setCalcCompetence] = useState(currentCompetence());
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState("");

  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [confirmPay, setConfirmPay] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  async function reloadAll() {
    setLoading(true);
    setCycleLoading(true);
    try {
      const [resSettlements, resCurrent] = await Promise.all([
        fetch("/api/admin/clube/settlements"),
        fetch("/api/admin/clube/settlements/current"),
      ]);
      if (resSettlements.ok) setSettlements(await resSettlements.json());
      if (resCurrent.ok) setCurrentCycle(await resCurrent.json());
    } catch {
      setError("Erro ao carregar dados do Clube.");
    } finally {
      setLoading(false);
      setCycleLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [resSettlements, resCurrent] = await Promise.all([
          fetch("/api/admin/clube/settlements"),
          fetch("/api/admin/clube/settlements/current"),
        ]);
        if (!ignore) {
          if (resSettlements.ok) setSettlements(await resSettlements.json());
          if (resCurrent.ok) setCurrentCycle(await resCurrent.json());
        }
      } catch {
        if (!ignore) setError("Erro ao carregar dados do Clube.");
      } finally {
        if (!ignore) {
          setLoading(false);
          setCycleLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleCalculate() {
    setCalcLoading(true);
    setCalcError("");
    try {
      const res = await fetch("/api/admin/clube/settlements/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competence: calcCompetence }),
      });
      if (!res.ok) {
        const err = await res.json();
        setCalcError(err.message ?? "Erro ao calcular fechamento.");
        return;
      }
      reloadAll();
    } catch {
      setCalcError("Erro de conexão.");
    } finally {
      setCalcLoading(false);
    }
  }

  async function handleApprove() {
    if (!confirmApprove) return;
    setActionLoading(true);
    try {
      await fetch(`/api/admin/clube/settlements/${confirmApprove}/approve`, { method: "POST" });
      setConfirmApprove(null);
      reloadAll();
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePay() {
    if (!confirmPay) return;
    setActionLoading(true);
    try {
      await fetch(`/api/admin/clube/settlements/${confirmPay}/pay`, { method: "POST" });
      setConfirmPay(null);
      reloadAll();
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <ClubConfirmDialog
        isOpen={!!confirmApprove}
        onClose={() => setConfirmApprove(null)}
        onConfirm={handleApprove}
        title="Aprovar fechamento"
        message="Ao aprovar, os pontos serão liquidados e o fechamento ficará disponível para pagamento aos barbeiros."
        confirmLabel="Aprovar"
        variant="warning"
        loading={actionLoading}
      />
      <ClubConfirmDialog
        isOpen={!!confirmPay}
        onClose={() => setConfirmPay(null)}
        onConfirm={handlePay}
        title="Marcar como pago"
        message="Confirma que os valores foram pagos aos barbeiros? Esta ação não pode ser desfeita."
        confirmLabel="Confirmar pagamento"
        variant="danger"
        loading={actionLoading}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Fechamentos do Clube</h1>
        <p className="text-sm text-[var(--text-muted)]">Painel operacional e histórico de rateio mensal.</p>
      </div>

      {/* Mandatory Banner LOTE A */}
      <div className="rounded-xl border border-blue-800/40 bg-blue-950/30 p-4 text-sm text-blue-300 flex items-start gap-3">
        <span className="text-xl shrink-0">ℹ️</span>
        <div>
          <p className="font-semibold text-blue-200">Prévia operacional do ciclo atual</p>
          <p className="text-xs text-blue-300/90 mt-0.5">
            A integração financeira do clube será aplicada nas próximas etapas. Os valores abaixo representam a estimativa em tempo real.
          </p>
        </div>
      </div>

      {/* Ciclo Atual Panel */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>📊</span> Ciclo Atual em Aberto
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {currentCycle?.cycle?.since
                ? `Acumulando desde ${new Date(currentCycle.cycle.since).toLocaleDateString("pt-BR")}`
                : "Acumulado total (primeiro ciclo)"}
            </p>
          </div>
          {currentCycle?.totals && (
            <div className="text-right">
              <span className="text-xs text-[var(--text-muted)] block">Total de Serviços</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                {currentCycle.totals.totalServicesCount} {currentCycle.totals.totalServicesCount === 1 ? "executado" : "executados"}
              </span>
            </div>
          )}
        </div>

        {cycleLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-4">
            <div className="h-24 rounded-xl bg-[var(--surface-raised)] animate-pulse" />
            <div className="h-24 rounded-xl bg-[var(--surface-raised)] animate-pulse" />
          </div>
        ) : currentCycle?.totals ? (
          <div className="space-y-4">
            {/* Cards de Potes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CyclePotCard
                label="Pote Barbeiros (Rateio)"
                amount={currentCycle.totals.barberPool}
                sub={`Total de pontos no ciclo: ${pts(currentCycle.totals.totalPoints)}`}
                icon="💈"
                variant="blue"
              />

              {currentCycle.totals.shopPool !== null ? (
                <CyclePotCard
                  label="Pote Barbearia (Receita Líquida)"
                  amount={currentCycle.totals.shopPool}
                  sub={currentCycle.totals.totalRevenue ? `Receita total: ${brl(currentCycle.totals.totalRevenue)}` : undefined}
                  icon="🏛️"
                  variant="gold"
                />
              ) : (
                <CyclePotCard
                  label="Pote Barbearia"
                  amount={null}
                  sub="Disponível exclusivamente para o Dono"
                  icon="🔒"
                  variant="brand"
                  isRestricted
                />
              )}
            </div>

            {/* Status do ciclo se zero pontos */}
            {!currentCycle.cycle.hasPoints && (
              <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                ⚠️ <strong>Pendente — sem serviços realizados no ciclo:</strong> Os barbeiros ainda não acumularam pontos neste ciclo. O rateio estará disponível assim que serviços do clube forem executados.
              </div>
            )}

            {/* Cards por Barbeiro */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">
                Desempenho dos Barbeiros no Ciclo Aberto
              </p>
              {currentCycle.barbers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic">Nenhum barbeiro ativo cadastrado.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {currentCycle.barbers.map((b) => (
                    <CycleBarberCard key={b.memberId} barber={b} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Seção de Cálculo de Fechamento por Competência (Histórico) */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <p className="text-sm font-bold text-[var(--text-primary)] mb-3">Calcular fechamento por competência</p>
        {calcError && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-300 mb-3">{calcError}</div>
        )}
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">Mês de referência</label>
            <input
              type="month"
              value={calcCompetence}
              onChange={(e) => setCalcCompetence(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors"
            />
          </div>
          <button
            onClick={handleCalculate}
            disabled={calcLoading}
            className="btn-gold px-5 py-2.5 text-sm min-h-0 disabled:opacity-50"
          >
            {calcLoading ? "Calculando..." : "Calcular fechamento"}
          </button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Um novo cálculo substitui o fechamento existente se ainda estiver em status CALCULATED.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* Histórico de Fechamentos Preservado */}
      <div>
        <h2 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-3">Histórico de Fechamentos</h2>
        {loading ? (
          <p className="text-[var(--text-muted)] text-sm">Carregando histórico...</p>
        ) : settlements.length === 0 ? (
          <div className="py-12 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
            <span className="text-3xl">📊</span>
            <p className="font-bold text-[var(--text-primary)] mt-3 mb-1 text-sm">Nenhum fechamento histórico calculado</p>
            <p className="text-xs text-[var(--text-muted)]">Use o formulário acima para calcular uma competência anterior.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {settlements.map((s) => (
              <div key={s.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
                <div
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-[var(--surface-hover)] transition-colors rounded-xl"
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-[var(--text-primary)]">{s.competence}</p>
                    <ClubStatusBadge status={s.status} type="settlement" />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] shrink-0 flex-wrap">
                    <span>Total: <strong className="text-[var(--text-primary)]">{brl(s.totalRevenue)}</strong></span>
                    <span>Barbearia: <strong className="text-[var(--brand-hover)]">{brl(s.shopAmount)}</strong></span>
                    <span>Fundo: <strong className="text-blue-400">{brl(s.barberPoolAmount)}</strong></span>
                    <div className="flex gap-2 ml-2">
                      {s.status === "CALCULATED" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmApprove(s.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--brand-subtle)] border border-[var(--gold-border)] text-[var(--brand-hover)] hover:bg-[rgba(201,168,76,0.14)] transition-colors"
                        >
                          Aprovar
                        </button>
                      )}
                      {s.status === "APPROVED" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmPay(s.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-950/30 border border-green-800/40 text-green-400 hover:bg-green-950/50 transition-colors"
                        >
                          Marcar como pago
                        </button>
                      )}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ml-1 ${expanded === s.id ? "rotate-180" : ""}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {expanded === s.id && (
                  <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
                    {/* Carry-over */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Carry-in (entrada)", value: brl(s.carryInAmount), color: "text-blue-400" },
                        { label: "Carry-out (saída)", value: brl(s.carryOutAmount), color: "text-amber-400" },
                        { label: "Total pontos", value: pts(s.totalPoints), color: "text-[var(--text-primary)]" },
                        { label: "Status", value: s.status, color: "text-[var(--text-secondary)]" },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">{item.label}</p>
                          <p className={`font-bold text-sm ${item.color}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Members */}
                    {s.members.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Rateio por barbeiro</p>
                        <div className="grid gap-2">
                          {s.members.map((m) => (
                            <div key={m.id} className="flex justify-between items-center text-sm rounded-lg bg-[var(--surface-raised)] px-3 py-2">
                              <span className="text-[var(--text-secondary)]">{m.member.user.name}</span>
                              <div className="flex gap-4 text-xs">
                                <span className="text-[var(--text-muted)]">{pts(m.pointsShare)} pts</span>
                                <span className="text-green-400 font-bold">{brl(m.amount)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
