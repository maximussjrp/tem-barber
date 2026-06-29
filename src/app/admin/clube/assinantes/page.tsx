"use client";

import { useEffect, useState } from "react";
import { ClubModal } from "@/components/admin/clube/ClubModal";
import { ClubStatusBadge } from "@/components/admin/clube/ClubStatusBadge";

type Subscription = {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  customer: { id: string; name: string; phone: string };
  clubPlan: { id: string; name: string; monthlyPrice: string; shopSharePercent: string; barberPoolPercent: string };
};
type Plan = { id: string; name: string };
type BalanceEntry = { serviceId?: string; productId?: string; benefitType: string; used: number; included: number; remaining: number };
type Payment = { id: string; amount: string; competence: string; paidAt: string; paymentMethod: string };

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function currentCompetence() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "ACTIVE",       label: "Ativo" },
  { value: "GRACE_PERIOD", label: "Carência" },
  { value: "PAST_DUE",     label: "Em atraso" },
  { value: "SUSPENDED",    label: "Suspenso" },
  { value: "CANCELED",     label: "Cancelado" },
  { value: "EXPIRED",      label: "Expirado" },
];

const PAYMENT_METHODS = [
  { value: "CREDIT", label: "Cartão de crédito" },
  { value: "DEBIT",  label: "Cartão de débito" },
  { value: "PIX",         label: "Pix" },
  { value: "CASH",        label: "Dinheiro" },
  { value: "OTHER",       label: "Transferência / Outro" },
];

function getPaymentMethodLabel(method: string) {
  switch (method) {
    case "CREDIT": return "Cartão de crédito";
    case "DEBIT": return "Cartão de débito";
    case "PIX": return "Pix";
    case "CASH": return "Dinheiro";
    case "OTHER": return "Transferência / Outro";
    default: return method;
  }
}

export default function AssinantesPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Link modal
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));

  // Detail panel
  const [detailSub, setDetailSub] = useState<Subscription | null>(null);
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("PIX");
  const [payCompetence, setPayCompetence] = useState(currentCompetence());

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const [subRes, planRes] = await Promise.all([
        fetch(`/api/admin/clube/subscriptions?${params}`),
        fetch("/api/admin/clube/plans"),
      ]);
      setSubscriptions(await subRes.json());
      const pd = await planRes.json();
      setPlans(Array.isArray(pd) ? pd.filter((p: any) => p.isActive) : []);
    } catch {
      setError("Erro ao carregar assinantes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function searchClients(q: string) {
    if (q.length < 2) { setClientResults([]); return; }
    const res = await fetch(`/api/admin/clients/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setClientResults(data.clients ?? []);
  }

  useEffect(() => {
    const t = setTimeout(() => searchClients(clientSearch), 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  async function handleLink() {
    if (!selectedClient || !selectedPlan) return;
    setLinkLoading(true);
    setLinkError("");
    try {
      const start = new Date(periodStart);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      const res = await fetch("/api/admin/clube/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedClient.id,
          clubPlanId: selectedPlan,
          currentPeriodStart: start.toISOString(),
          currentPeriodEnd: end.toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setLinkError(err.message ?? "Erro ao vincular.");
        return;
      }
      setLinkOpen(false);
      setSelectedClient(null);
      setSelectedPlan("");
      setClientSearch("");
      load();
    } catch {
      setLinkError("Erro de conexão.");
    } finally {
      setLinkLoading(false);
    }
  }

  async function openDetail(sub: Subscription) {
    setDetailSub(sub);
    setDetailLoading(true);
    try {
      const [balRes, payRes] = await Promise.all([
        fetch(`/api/admin/clube/subscriptions/${sub.id}/balance`),
        fetch(`/api/admin/clube/subscriptions/${sub.id}/payments`),
      ]);
      const balData = await balRes.json();
      setBalance(balData.benefits ?? []);
      setPayments(await payRes.json());
    } catch { /* silent */ }
    finally { setDetailLoading(false); }
  }

  async function handlePay() {
    if (!detailSub) return;
    setPayLoading(true);
    setPayError("");
    try {
      const res = await fetch(`/api/admin/clube/subscriptions/${detailSub.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(payAmount),
          paymentMethod: payMethod,
          competence: payCompetence,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setPayError(err.message ?? "Erro ao registrar pagamento.");
        return;
      }
      setPayOpen(false);
      setPayAmount("");
      openDetail(detailSub);
    } catch {
      setPayError("Erro de conexão.");
    } finally {
      setPayLoading(false);
    }
  }

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors";
  const labelCls = "block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5";

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Modais */}
      <ClubModal
        isOpen={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Vincular cliente ao clube"
        description="Busque o cliente e selecione o plano."
        footer={
          <>
            <button onClick={() => setLinkOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors">
              Cancelar
            </button>
            <button onClick={handleLink} disabled={!selectedClient || !selectedPlan || linkLoading} className="btn-gold px-5 py-2 text-sm min-h-0 disabled:opacity-50">
              {linkLoading ? "Vinculando..." : "Vincular"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {linkError && <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{linkError}</div>}
          <div>
            <label className={labelCls}>Buscar cliente</label>
            <input
              className={inputCls}
              value={clientSearch}
              onChange={(e) => { setClientSearch(e.target.value); setSelectedClient(null); }}
              placeholder="Nome ou telefone..."
            />
            {clientResults.length > 0 && !selectedClient && (
              <div className="mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] divide-y divide-[var(--border-subtle)]">
                {clientResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedClient(c); setClientSearch(c.name); setClientResults([]); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <p className="text-sm font-medium text-[var(--text-primary)]">{c.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{c.phone}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedClient && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--brand-subtle)] border border-[var(--gold-border)]">
                <span className="text-sm text-[var(--brand-hover)] font-semibold">{selectedClient.name}</span>
                <button onClick={() => { setSelectedClient(null); setClientSearch(""); }} className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">✕</button>
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Plano *</label>
            <select className={inputCls} value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} required>
              <option value="">Selecione um plano</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Início do ciclo</label>
            <input className={inputCls} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
        </div>
      </ClubModal>

      <ClubModal
        isOpen={payOpen}
        onClose={() => setPayOpen(false)}
        title="Registrar pagamento manual"
        footer={
          <>
            <button onClick={() => setPayOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors">Cancelar</button>
            <button onClick={handlePay} disabled={!payAmount || payLoading} className="btn-gold px-5 py-2 text-sm min-h-0 disabled:opacity-50">
              {payLoading ? "Registrando..." : "Registrar"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {payError && <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{payError}</div>}
          <div>
            <label className={labelCls}>Valor (R$) *</label>
            <input className={inputCls} type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Forma de pagamento</label>
            <select className={inputCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Competência (AAAA-MM)</label>
            <input className={inputCls} type="month" value={payCompetence} onChange={(e) => setPayCompetence(e.target.value)} />
          </div>
        </div>
      </ClubModal>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Assinantes</h1>
          <p className="text-sm text-[var(--text-muted)]">Gerencie os clientes vinculados ao clube.</p>
        </div>
        <button onClick={() => { setLinkError(""); setLinkOpen(true); }} className="btn-gold px-4 py-2 text-sm min-h-0">
          Vincular cliente
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${statusFilter === opt.value ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-subtle)]" : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : subscriptions.length === 0 ? (
        <div className="py-16 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
          <span className="text-4xl">👤</span>
          <p className="font-bold text-[var(--text-primary)] mt-4 mb-1">Nenhum assinante encontrado</p>
          <p className="text-sm text-[var(--text-muted)]">Vincule um cliente a um plano para começar.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
              <div
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-[var(--surface-hover)] transition-colors rounded-xl"
                onClick={() => detailSub?.id === sub.id ? setDetailSub(null) : openDetail(sub)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[var(--text-primary)]">{sub.customer.name}</p>
                    <ClubStatusBadge status={sub.status} type="subscription" />
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub.clubPlan.name}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] shrink-0">
                  <span>{fmt(sub.currentPeriodStart)} → {fmt(sub.currentPeriodEnd)}</span>
                  <span className="text-[var(--brand-hover)] font-bold">{brl(sub.clubPlan.monthlyPrice)}/mês</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${detailSub?.id === sub.id ? "rotate-180" : ""}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {/* Detail expanded */}
              {detailSub?.id === sub.id && (
                <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
                  {detailLoading ? (
                    <p className="text-[var(--text-muted)] text-sm">Carregando detalhes...</p>
                  ) : (
                    <>
                      {/* Balance */}
                      {balance.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Saldo de benefícios</p>
                          <div className="grid gap-2">
                            {balance.map((b, i) => (
                              <div key={i} className="flex items-center justify-between text-sm rounded-lg bg-[var(--surface-raised)] px-3 py-2">
                                <span className="text-[var(--text-secondary)]">{b.benefitType}</span>
                                <span className="text-[var(--text-primary)] font-semibold">{b.remaining} / {b.included} restantes</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Payments */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Pagamentos</p>
                          <button onClick={() => { setPayError(""); setPayOpen(true); }} className="text-xs font-semibold text-[var(--brand-hover)] hover:underline">
                            + Registrar pagamento
                          </button>
                        </div>
                        {payments.length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)]">Nenhum pagamento registrado.</p>
                        ) : (
                          <div className="grid gap-1.5">
                            {payments.map((p) => (
                              <div key={p.id} className="flex justify-between text-xs rounded-lg bg-[var(--surface-raised)] px-3 py-2">
                                <span className="text-[var(--text-muted)]">{p.competence} · {getPaymentMethodLabel(p.paymentMethod)}</span>
                                <span className="text-green-400 font-bold">{brl(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
