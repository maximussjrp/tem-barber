"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface Plan {
  id: string;
  name: string;
  price: number | any;
}

interface TenantSubscription {
  id: string;
  status: string;
  planId: string;
  planName: string | null;
  monthlyPrice: any | null;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  gracePeriodEndsAt: string | null;
  paymentMethod: string | null;
  lastPaymentAt: string | null;
  internalNotes: string | null;
  updatedBy: string | null;
  updatedAt: string;
  plan: Plan;
}

interface Barbershop {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  subscriptions: TenantSubscription[];
  members: {
    role: string;
    user: {
      name: string;
      email: string | null;
    };
  }[];
}

interface Props {
  initialBarbershops: Barbershop[];
  plans: Plan[];
}

export function PlatformDashboard({ initialBarbershops, plans }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");
  const [editingSub, setEditingSub] = useState<{
    barbershopId: string;
    barbershopName: string;
    subscription: TenantSubscription | null;
  } | null>(null);

  // Form states
  const [formStatus, setFormStatus] = useState<string>("TRIAL");
  const [formPlanId, setFormPlanId] = useState<string>("");
  const [formTrialEndsAt, setFormTrialEndsAt] = useState<string>("");
  const [formPeriodStart, setFormPeriodStart] = useState<string>("");
  const [formPeriodEnd, setFormPeriodEnd] = useState<string>("");
  const [formGracePeriodEndsAt, setFormGracePeriodEndsAt] = useState<string>("");
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("");
  const [formLastPaymentAt, setFormLastPaymentAt] = useState<string>("");
  const [formInternalNotes, setFormInternalNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const handleEditClick = (barbershop: Barbershop) => {
    const sub = barbershop.subscriptions[0] || null;
    setEditingSub({
      barbershopId: barbershop.id,
      barbershopName: barbershop.name,
      subscription: sub,
    });

    const formatDateInput = (dateStr: string | null) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toISOString().slice(0, 10);
    };

    setFormStatus(sub?.status || "TRIAL");
    setFormPlanId(sub?.planId || plans[0]?.id || "");
    setFormTrialEndsAt(formatDateInput(sub?.trialEndsAt));
    setFormPeriodStart(formatDateInput(sub?.currentPeriodStart));
    setFormPeriodEnd(formatDateInput(sub?.currentPeriodEnd));
    setFormGracePeriodEndsAt(formatDateInput(sub?.gracePeriodEndsAt));
    setFormPaymentMethod(sub?.paymentMethod || "");
    setFormLastPaymentAt(formatDateInput(sub?.lastPaymentAt));
    setFormInternalNotes(sub?.internalNotes || "");
    setFormError("");
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub) return;

    setIsSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/admin/platform-subscriptions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          barbershopId: editingSub.barbershopId,
          status: formStatus,
          planId: formPlanId || null,
          trialEndsAt: formTrialEndsAt || null,
          currentPeriodStart: formPeriodStart || null,
          currentPeriodEnd: formPeriodEnd || null,
          gracePeriodEndsAt: formGracePeriodEndsAt || null,
          paymentMethod: formPaymentMethod || null,
          lastPaymentAt: formLastPaymentAt || null,
          internalNotes: formInternalNotes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alterações.");
      }

      setEditingSub(null);
      router.refresh();
    } catch (err: any) {
      setFormError(err.message || "Erro desconhecido.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get active stats
  const items = initialBarbershops.map((shop) => {
    const sub = shop.subscriptions[0];
    const owner = shop.members[0]?.user;
    
    // Calculate remaining days
    let remainingDays = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (sub) {
      const expirationDate = sub.status === "TRIAL"
        ? (sub.trialEndsAt ? new Date(sub.trialEndsAt) : null)
        : (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null);
        
      if (expirationDate) {
        expirationDate.setHours(0, 0, 0, 0);
        const diffTime = expirationDate.getTime() - now.getTime();
        remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    return {
      ...shop,
      sub,
      owner,
      remainingDays,
    };
  });

  const kpis = {
    total: items.length,
    active: items.filter(i => i.sub?.status === "ACTIVE").length,
    trial: items.filter(i => i.sub?.status === "TRIAL").length,
    pastDue: items.filter(i => i.sub?.status === "PAST_DUE").length,
    suspended: items.filter(i => i.sub?.status === "SUSPENDED").length,
    canceled: items.filter(i => i.sub?.status === "CANCELED").length,
    mrr: items
      .filter(i => i.sub?.status === "ACTIVE")
      .reduce((sum, i) => sum + Number(i.sub?.monthlyPrice || 0), 0),
  };

  const filteredItems = items.filter((item) => {
    // Status Filter
    if (filter === "TRIAL" && item.sub?.status !== "TRIAL") return false;
    if (filter === "ACTIVE" && item.sub?.status !== "ACTIVE") return false;
    if (filter === "PAST_DUE" && item.sub?.status !== "PAST_DUE") return false;
    if (filter === "SUSPENDED" && item.sub?.status !== "SUSPENDED") return false;
    if (filter === "CANCELED" && item.sub?.status !== "CANCELED") return false;

    // Search Filter
    if (search.trim() !== "") {
      const s = search.toLowerCase();
      const shopNameMatches = item.name.toLowerCase().includes(s);
      const slugMatches = item.slug.toLowerCase().includes(s);
      const ownerNameMatches = item.owner?.name.toLowerCase().includes(s) || false;
      const ownerEmailMatches = item.owner?.email?.toLowerCase().includes(s) || false;
      return shopNameMatches || slugMatches || ownerNameMatches || ownerEmailMatches;
    }

    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "TRIAL":
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Em Teste</span>;
      case "ACTIVE":
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Ativo</span>;
      case "PAST_DUE":
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Vencido</span>;
      case "SUSPENDED":
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">Suspenso</span>;
      case "CANCELED":
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-500/10 text-stone-400 border border-stone-500/20">Cancelado</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-700 text-stone-300">Expirado</span>;
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-8 bg-stone-950 min-h-screen text-stone-100 font-sans">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-serif">Controle de Assinaturas</h1>
          <p className="text-stone-400 text-sm mt-1">Painel interno do Administrador Tem Barber</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {[
          { label: "Total", value: kpis.total, desc: "Tenants cadastrados" },
          { label: "Ativos", value: kpis.active, desc: "Assinantes pagantes" },
          { label: "Testes", value: kpis.trial, desc: "Período de trial" },
          { label: "Vencidos", value: kpis.pastDue, desc: "Tolerância de atraso" },
          { label: "Suspensos", value: kpis.suspended, desc: "Acesso bloqueado" },
          { label: "Cancelados", value: kpis.canceled, desc: "Sem renovação" },
          {
            label: "MRR Estimado",
            value: kpis.mrr.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
            desc: "Receita Recorrente (Active)",
            span: "col-span-2 md:col-span-4 lg:col-span-1"
          },
        ].map((kpi, idx) => (
          <div
            key={idx}
            className={`bg-stone-900/40 border border-stone-800/80 rounded-2xl p-4 flex flex-col justify-between shadow-lg backdrop-blur-md ${kpi.span || ""}`}
          >
            <span className="text-stone-400 text-xs font-medium uppercase tracking-wider">{kpi.label}</span>
            <div className="my-2">
              <span className="text-2xl font-bold text-white tracking-tight">{kpi.value}</span>
            </div>
            <span className="text-[10px] text-stone-500 font-normal leading-normal">{kpi.desc}</span>
          </div>
        ))}
      </div>

      {/* Filters and Actions */}
      <div className="bg-stone-900/20 border border-stone-850 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Buscar barbearia, slug ou dono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:border-amber-500 transition-colors"
          />
          <div className="absolute left-3.5 top-3.5 text-stone-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex flex-wrap items-center gap-1.5 bg-stone-900/60 p-1.5 rounded-xl border border-stone-850">
          {[
            { id: "ALL", label: "Todos" },
            { id: "TRIAL", label: "Trial" },
            { id: "ACTIVE", label: "Ativos" },
            { id: "PAST_DUE", label: "Vencidos" },
            { id: "SUSPENDED", label: "Suspensos" },
            { id: "CANCELED", label: "Cancelados" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filter === tab.id
                  ? "bg-amber-500 text-stone-950 shadow-md"
                  : "text-stone-400 hover:text-stone-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-stone-900/30 border border-stone-900 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-850 text-stone-400 text-xs font-semibold uppercase bg-stone-900/20">
                <th className="py-4 px-6">Barbearia</th>
                <th className="py-4 px-6">Dono / Contato</th>
                <th className="py-4 px-6">Plano / Preço</th>
                <th className="py-4 px-6 text-center">Status</th>
                <th className="py-4 px-6">Próximo Vencimento</th>
                <th className="py-4 px-6 text-center">Dias Restantes</th>
                <th className="py-4 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-850">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-stone-500 font-medium">
                    Nenhuma barbearia encontrada.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-stone-900/10 transition-colors">
                    <td className="py-4 px-6">
                      <div className="font-semibold text-stone-100">{item.name}</div>
                      <div className="text-xs text-stone-500 mt-0.5">slug: {item.slug}</div>
                    </td>
                    <td className="py-4 px-6">
                      {item.owner ? (
                        <>
                          <div className="text-stone-300 font-medium">{item.owner.name}</div>
                          <div className="text-xs text-stone-500 mt-0.5">{item.owner.email}</div>
                        </>
                      ) : (
                        <span className="text-stone-600 text-xs font-normal">Sem owner cadastrado</span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      {item.sub ? (
                        <>
                          <div className="text-stone-300 font-medium">{item.sub.planName || "Plan personalizado"}</div>
                          <div className="text-xs text-amber-500 font-semibold mt-0.5">
                            {Number(item.sub.monthlyPrice || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </div>
                        </>
                      ) : (
                        <span className="text-stone-600 text-xs">Nenhum</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {getStatusBadge(item.sub?.status || "EXPIRED")}
                    </td>
                    <td className="py-4 px-6 text-stone-300">
                      {item.sub ? (
                        item.sub.status === "TRIAL" ? (
                          item.sub.trialEndsAt ? new Date(item.sub.trialEndsAt).toLocaleDateString("pt-BR") : "N/A"
                        ) : (
                          item.sub.currentPeriodEnd ? new Date(item.sub.currentPeriodEnd).toLocaleDateString("pt-BR") : "N/A"
                        )
                      ) : (
                        "N/A"
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {item.sub ? (
                        item.remainingDays > 0 ? (
                          <span className="text-emerald-400 font-medium">{item.remainingDays} dias</span>
                        ) : item.remainingDays === 0 ? (
                          <span className="text-amber-400 font-medium">Vence hoje</span>
                        ) : (
                          <span className="text-stone-500 font-normal">Expirado ({Math.abs(item.remainingDays)}d)</span>
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => handleEditClick(item)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg border border-stone-700 bg-stone-800 text-stone-200 hover:bg-stone-700 hover:text-white transition-colors"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal (Dialog) */}
      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative max-w-lg w-full bg-stone-900 border border-stone-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 animate-fade-in my-8">
            <div>
              <h2 className="text-xl font-bold text-white font-serif">Editar Assinatura</h2>
              <p className="text-xs text-stone-400 mt-1">Tenant: {editingSub.barbershopName}</p>
            </div>

            {formError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold rounded-xl leading-relaxed">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Plan Selection */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-300">Plano</label>
                  <select
                    value={formPlanId}
                    onChange={(e) => setFormPlanId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (R$ {Number(p.price).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Selection */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-300">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  >
                    <option value="TRIAL">TRIAL (Teste)</option>
                    <option value="ACTIVE">ACTIVE (Ativo)</option>
                    <option value="PAST_DUE">PAST_DUE (Vencido)</option>
                    <option value="SUSPENDED">SUSPENDED (Suspenso)</option>
                    <option value="CANCELED">CANCELED (Cancelado)</option>
                  </select>
                </div>
              </div>

              {formStatus === "TRIAL" ? (
                /* Trial Ends */
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-300">Fim do Teste (trialEndsAt)</label>
                  <input
                    type="date"
                    value={formTrialEndsAt}
                    onChange={(e) => setFormTrialEndsAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              ) : (
                /* Period dates */
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-stone-300">Início Período</label>
                    <input
                      type="date"
                      value={formPeriodStart}
                      onChange={(e) => setFormPeriodStart(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-stone-300">Fim Período (Vencimento)</label>
                    <input
                      type="date"
                      value={formPeriodEnd}
                      onChange={(e) => setFormPeriodEnd(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* Grace period */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-300">Tolerância (gracePeriodEndsAt)</label>
                  <input
                    type="date"
                    value={formGracePeriodEndsAt}
                    onChange={(e) => setFormGracePeriodEndsAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                {/* Last Payment */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-300">Último Pagamento</label>
                  <input
                    type="date"
                    value={formLastPaymentAt}
                    onChange={(e) => setFormLastPaymentAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-stone-300">Forma de Pagamento</label>
                <input
                  type="text"
                  placeholder="Ex: Pix, Transferência, Dinheiro, Cortesia..."
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-stone-300">Observações Internas</label>
                <textarea
                  rows={2}
                  placeholder="Anotações para controle interno do suporte..."
                  value={formInternalNotes}
                  onChange={(e) => setFormInternalNotes(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-850">
                <button
                  type="button"
                  onClick={() => setEditingSub(null)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 rounded-xl border border-stone-800 text-stone-300 hover:bg-stone-850 transition-colors text-xs font-semibold disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold transition-colors text-xs disabled:opacity-40"
                >
                  {isSubmitting ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
