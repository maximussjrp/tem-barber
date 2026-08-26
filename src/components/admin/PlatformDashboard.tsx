"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export interface Plan {
  id: string;
  name: string;
  price: number | string;
}

export interface TenantSubscription {
  id: string;
  status: string;
  planId: string;
  planName: string | null;
  monthlyPrice: number | string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEndsAt: string | null;
  paymentMethod: string | null;
  lastPaymentAt: string | null;
  internalNotes: string | null;
  updatedBy: string | null;
  updatedAt: string;
  plan?: Plan | null;
}

export interface DerivedAccess {
  rawStatus: string | null;
  effectiveStatus:
    | "TRIAL"
    | "ACTIVE"
    | "GRACE_PERIOD"
    | "PAST_DUE"
    | "SUSPENDED"
    | "CANCELED"
    | "EXPIRED"
    | "NO_SUBSCRIPTION";
  accessAllowed: boolean;
  accessType: "TRIAL" | "PAID" | "GRACE" | "NONE";
  validUntil: string | null;
  remainingDays: number;
  remainingLabel: string;
  isTrial: boolean;
  isPaid: boolean;
  isGracePeriod: boolean;
  isExpired: boolean;
  synchronizationWarnings: string[];
}

export interface DerivedBilling {
  billingStatus: "NONE" | "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "REFUNDED";
  billingDueDate: string | null;
  billingPaymentDate: string | null;
  billingValue: number | string | null;
  canPay: boolean;
  billingLabel: string;
  warnings: string[];
}

export interface BarbershopItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  subscription: TenantSubscription | null;
  subscriptionCount: number;
  members: {
    role: string;
    user: {
      name: string;
      email: string | null;
    };
  }[];
  access: DerivedAccess;
  billing: DerivedBilling;
  isMrrConfirmed: boolean;
  confirmedRevenue: number;
  synchronizationWarnings: string[];
  formattedValidUntil: string | null;
  formattedLastPaymentAt: string | null;
}

interface Props {
  initialBarbershops: BarbershopItem[];
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

  const handleEditClick = (item: BarbershopItem) => {
    const sub = item.subscription;
    setEditingSub({
      barbershopId: item.id,
      barbershopName: item.name,
      subscription: sub,
    });

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
          internalNotes: formInternalNotes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alterações.");
      }

      setEditingSub(null);
      router.refresh();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // KPI Calculations using server-derived properties
  const kpis = {
    total: initialBarbershops.length,
    active: initialBarbershops.filter((i) => i.access.effectiveStatus === "ACTIVE").length,
    trial: initialBarbershops.filter((i) => i.access.effectiveStatus === "TRIAL").length,
    grace: initialBarbershops.filter((i) => i.access.effectiveStatus === "GRACE_PERIOD").length,
    blocked: initialBarbershops.filter(
      (i) => i.access.effectiveStatus === "PAST_DUE" || i.access.effectiveStatus === "SUSPENDED"
    ).length,
    expired: initialBarbershops.filter((i) => i.access.effectiveStatus === "EXPIRED").length,
    noSub: initialBarbershops.filter((i) => i.access.effectiveStatus === "NO_SUBSCRIPTION").length,
    pendingPayments: initialBarbershops.filter((i) => i.billing.billingStatus === "PENDING").length,
    overduePayments: initialBarbershops.filter((i) => i.billing.billingStatus === "OVERDUE").length,
    mrrConfirmed: initialBarbershops.reduce((sum, i) => sum + i.confirmedRevenue, 0),
    pendingRevenue: initialBarbershops
      .filter((i) => i.billing.billingStatus === "PENDING" || i.billing.billingStatus === "OVERDUE")
      .reduce((sum, i) => sum + Number(i.subscription?.monthlyPrice || 0), 0),
  };

  const filteredItems = initialBarbershops.filter((item) => {
    // Status Filter
    if (filter === "TRIAL" && item.access.effectiveStatus !== "TRIAL") return false;
    if (filter === "ACTIVE" && item.access.effectiveStatus !== "ACTIVE") return false;
    if (filter === "GRACE_PERIOD" && item.access.effectiveStatus !== "GRACE_PERIOD") return false;
    if (
      filter === "PAST_DUE" &&
      item.access.effectiveStatus !== "PAST_DUE" &&
      item.access.effectiveStatus !== "SUSPENDED"
    )
      return false;
    if (filter === "EXPIRED" && item.access.effectiveStatus !== "EXPIRED") return false;
    if (filter === "NO_SUBSCRIPTION" && item.access.effectiveStatus !== "NO_SUBSCRIPTION") return false;
    if (filter === "WARNINGS" && item.synchronizationWarnings.length === 0) return false;

    // Search Filter
    if (search.trim() !== "") {
      const s = search.toLowerCase();
      const shopNameMatches = item.name.toLowerCase().includes(s);
      const slugMatches = item.slug.toLowerCase().includes(s);
      const owner = item.members.find((m) => m.role === "OWNER")?.user;
      const ownerNameMatches = owner?.name.toLowerCase().includes(s) || false;
      const ownerEmailMatches = owner?.email?.toLowerCase().includes(s) || false;
      return shopNameMatches || slugMatches || ownerNameMatches || ownerEmailMatches;
    }

    return true;
  });

  const getAccessBadge = (status: DerivedAccess["effectiveStatus"]) => {
    switch (status) {
      case "TRIAL":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Em Teste
          </span>
        );
      case "ACTIVE":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Ativo
          </span>
        );
      case "GRACE_PERIOD":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Tolerância
          </span>
        );
      case "PAST_DUE":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Bloqueado por atraso
          </span>
        );
      case "SUSPENDED":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Suspenso
          </span>
        );
      case "CANCELED":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-500/10 text-stone-400 border border-stone-500/20">
            Cancelado
          </span>
        );
      case "EXPIRED":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
            Expirado
          </span>
        );
      case "NO_SUBSCRIPTION":
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-800 text-stone-400 border border-stone-700">
            Sem Assinatura
          </span>
        );
    }
  };

  const getBillingBadge = (status: DerivedBilling["billingStatus"]) => {
    switch (status) {
      case "PAID":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            Pago
          </span>
        );
      case "PENDING":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Pendente
          </span>
        );
      case "OVERDUE":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20">
            Vencida
          </span>
        );
      case "REFUNDED":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
            Estornada
          </span>
        );
      case "CANCELED":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-500/10 text-stone-400 border border-stone-500/20">
            Cancelada
          </span>
        );
      case "NONE":
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-stone-800 text-stone-400 border border-stone-700">
            Sem Cobrança
          </span>
        );
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-8 bg-stone-950 min-h-screen text-stone-100 font-sans">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-serif">
            Controle de Assinaturas
          </h1>
          <p className="text-stone-400 text-sm mt-1">
            Painel interno da Plataforma Tem Barber — Leitura Server-Side Única
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[
          { label: "Total", value: kpis.total, desc: "Tenants cadastrados" },
          { label: "Ativos", value: kpis.active, desc: "Acessos pagos vigentes" },
          { label: "Testes", value: kpis.trial, desc: "Trials em andamento" },
          { label: "Tolerância", value: kpis.grace, desc: "Atraso com tolerância" },
          { label: "Bloqueados", value: kpis.blocked, desc: "Atrasados / Suspensos" },
          { label: "Sem Assinatura", value: kpis.noSub, desc: "Apenas cadastro" },
          {
            label: "MRR Confirmado",
            value: kpis.mrrConfirmed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
            desc: "Receita confirmada com pagamento",
            span: "col-span-2 md:col-span-3 lg:col-span-3 bg-emerald-950/20 border-emerald-800/40",
          },
          {
            label: "Receita Pendente",
            value: kpis.pendingRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
            desc: "Cobranças pendentes / vencidas",
            span: "col-span-2 md:col-span-3 lg:col-span-3 bg-amber-950/20 border-amber-800/40",
          },
        ].map((kpi, idx) => (
          <div
            key={idx}
            className={`bg-stone-900/40 border border-stone-800/80 rounded-2xl p-4 flex flex-col justify-between shadow-lg backdrop-blur-md ${
              kpi.span || ""
            }`}
          >
            <span className="text-stone-400 text-xs font-medium uppercase tracking-wider">
              {kpi.label}
            </span>
            <div className="my-2">
              <span className="text-2xl font-bold text-white tracking-tight">{kpi.value}</span>
            </div>
            <span className="text-[10px] text-stone-500 font-normal leading-normal">
              {kpi.desc}
            </span>
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex flex-wrap items-center gap-1.5 bg-stone-900/60 p-1.5 rounded-xl border border-stone-850">
          {[
            { id: "ALL", label: "Todos" },
            { id: "TRIAL", label: "Trial" },
            { id: "ACTIVE", label: "Ativos" },
            { id: "GRACE_PERIOD", label: "Tolerância" },
            { id: "PAST_DUE", label: "Bloqueados" },
            { id: "EXPIRED", label: "Expirados" },
            { id: "NO_SUBSCRIPTION", label: "Sem Assinatura" },
            { id: "WARNINGS", label: "Inconsistências" },
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
                <th className="py-4 px-6 text-center">Acesso</th>
                <th className="py-4 px-6 text-center">Cobrança Asaas</th>
                <th className="py-4 px-6">Validade</th>
                <th className="py-4 px-6 text-center">Dias Restantes</th>
                <th className="py-4 px-6">Último Pagamento</th>
                <th className="py-4 px-6 text-center">Sincronização</th>
                <th className="py-4 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-850">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-stone-500 font-medium">
                    Nenhuma barbearia encontrada.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const owner = item.members.find((m) => m.role === "OWNER")?.user;

                  return (
                    <tr key={item.id} className="hover:bg-stone-900/10 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-stone-100">{item.name}</div>
                        <div className="text-xs text-stone-500 mt-0.5">slug: {item.slug}</div>
                      </td>
                      <td className="py-4 px-6">
                        {owner ? (
                          <>
                            <div className="text-stone-300 font-medium">{owner.name}</div>
                            <div className="text-xs text-stone-500 mt-0.5">{owner.email}</div>
                          </>
                        ) : (
                          <span className="text-stone-600 text-xs font-normal">
                            Sem owner cadastrado
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {item.subscription ? (
                          <>
                            <div className="text-stone-300 font-medium">
                              {item.subscription.planName || "Plano Tem Barber"}
                            </div>
                            <div className="text-xs text-amber-500 font-semibold mt-0.5">
                              {Number(item.subscription.monthlyPrice || 0).toLocaleString(
                                "pt-BR",
                                { style: "currency", currency: "BRL" }
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-stone-600 text-xs">Sem plano</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {getAccessBadge(item.access.effectiveStatus)}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {getBillingBadge(item.billing.billingStatus)}
                      </td>
                      <td className="py-4 px-6 text-stone-300 text-xs">
                        {item.formattedValidUntil || "—"}
                      </td>
                      <td className="py-4 px-6 text-center text-xs font-medium">
                        {item.access.accessAllowed ? (
                          item.access.remainingDays === 1 ? (
                            <span className="text-amber-400">Termina/Renova hoje</span>
                          ) : (
                            <span className="text-emerald-400">{item.access.remainingDays} dias</span>
                          )
                        ) : (
                          <span className="text-stone-500">Sem acesso</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-stone-400 text-xs">
                        {item.formattedLastPaymentAt || "—"}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {item.synchronizationWarnings.length > 0 ? (
                          <span
                            title={item.synchronizationWarnings.join("\n")}
                            className="cursor-help px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          >
                            Revisar sincronização ({item.synchronizationWarnings.length})
                          </span>
                        ) : (
                          <span className="text-emerald-500 text-xs font-semibold">OK</span>
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
                  );
                })
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
              <h2 className="text-xl font-bold text-white font-serif">Dados de Suporte</h2>
              <p className="text-xs text-stone-400 mt-1">Tenant: {editingSub.barbershopName}</p>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl leading-relaxed">
              Somente observações de suporte podem ser alteradas. Dados de acesso e cobrança são sincronizados pelo Asaas.
            </div>

            {formError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold rounded-xl leading-relaxed">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
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
