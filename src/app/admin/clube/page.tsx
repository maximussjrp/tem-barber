"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type MetricCard = {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  color?: "brand" | "success" | "warning" | "danger" | "info";
};

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function currentCompetence() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ClubeDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [plans, setPlans] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/clube/plans").then((r) => r.json()),
      fetch("/api/admin/clube/subscriptions").then((r) => r.json()),
      fetch("/api/admin/clube/settlements").then((r) => r.json()),
    ])
      .then(([p, s, st]) => {
        setPlans(Array.isArray(p) ? p : []);
        setSubscriptions(Array.isArray(s) ? s : []);
        setSettlements(Array.isArray(st) ? st : []);
      })
      .catch(() => setError("Erro ao carregar dados do Clube."))
      .finally(() => setLoading(false));
  }, []);

  const activePlans = plans.filter((p) => p.isActive).length;
  const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const overdueSubscriptions = subscriptions.filter((s) =>
    ["PAST_DUE", "SUSPENDED"].includes(s.status)
  ).length;

  const competence = currentCompetence();
  const monthPayments = subscriptions
    .flatMap((s: any) => s.payments ?? [])
    .filter((p: any) => p.competence === competence);
  const monthRevenue = monthPayments.reduce(
    (acc: number, p: any) => acc + Number(p.amount ?? 0),
    0
  );

  const lastSettlement = settlements[0] ?? null;

  const metrics: MetricCard[] = [
    {
      label: "Planos Ativos",
      value: activePlans,
      sub: "Planos disponíveis",
      href: "/admin/clube/planos",
      color: "brand",
    },
    {
      label: "Assinantes Ativos",
      value: activeSubscriptions,
      sub: "Clientes do clube",
      href: "/admin/clube/assinantes",
      color: "success",
    },
    {
      label: "Inadimplentes",
      value: overdueSubscriptions,
      sub: "Atrasados ou suspensos",
      href: "/admin/clube/assinantes",
      color: overdueSubscriptions > 0 ? "warning" : "info",
    },
    {
      label: "Receita do Clube",
      value: brl(monthRevenue),
      sub: `Competência ${competence}`,
      color: "info",
    },
    {
      label: "Último Fechamento",
      value: lastSettlement ? lastSettlement.competence : "—",
      sub: lastSettlement
        ? `Fundo: ${brl(lastSettlement.barberPoolAmount ?? 0)}`
        : "Nenhum calculado",
      href: "/admin/clube/fechamentos",
      color: "brand",
    },
    {
      label: "Total de Assinantes",
      value: subscriptions.length,
      sub: "Todas as situações",
      href: "/admin/clube/assinantes",
      color: "info",
    },
  ];

  const colorMap: Record<string, string> = {
    brand:   "border-[var(--brand)]/30 bg-[var(--brand-subtle)]",
    success: "border-green-800/40 bg-green-950/20",
    warning: "border-amber-800/40 bg-amber-950/20",
    danger:  "border-red-800/40 bg-red-950/20",
    info:    "border-blue-800/40 bg-blue-950/20",
  };
  const valueColorMap: Record<string, string> = {
    brand:   "text-[var(--brand-hover)]",
    success: "text-green-400",
    warning: "text-amber-400",
    danger:  "text-red-400",
    info:    "text-blue-400",
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
          Clube de Assinatura
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Visão geral do módulo de fidelidade e recorrência.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {metrics.map((m) => {
            const card = (
              <div
                className={`rounded-xl border p-5 flex flex-col gap-2 transition-all ${colorMap[m.color ?? "info"]} ${m.href ? "hover:scale-[1.02] cursor-pointer" : ""}`}
              >
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  {m.label}
                </p>
                <p className={`metric text-2xl font-bold ${valueColorMap[m.color ?? "info"]}`}>
                  {m.value}
                </p>
                {m.sub && (
                  <p className="text-xs text-[var(--text-muted)]">{m.sub}</p>
                )}
              </div>
            );
            return m.href ? (
              <Link key={m.label} href={m.href}>
                {card}
              </Link>
            ) : (
              <div key={m.label}>{card}</div>
            );
          })}
        </div>
      )}

      {/* Quick links */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { href: "/admin/clube/planos", icon: "⭐", label: "Gerenciar Planos", desc: "Criar, editar e configurar benefícios" },
            { href: "/admin/clube/assinantes", icon: "👤", label: "Assinantes", desc: "Vincular clientes, registrar pagamentos" },
            { href: "/admin/clube/fechamentos", icon: "📊", label: "Fechamentos", desc: "Calcular e aprovar rateio mensal" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] hover:border-[var(--border)] transition-all"
            >
              <span className="text-2xl">{item.icon}</span>
              <div>
                <p className="font-semibold text-[var(--text-primary)] text-sm">{item.label}</p>
                <p className="text-xs text-[var(--text-muted)]">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
