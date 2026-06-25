"use client";

import { useEffect, useState } from "react";

type Option = { id: string; name: string; user?: { name: string } };
type Config = {
  id: string;
  scopeKey: string;
  type: string;
  value: string;
  active: boolean;
  member?: { user: { name: string } } | null;
  service?: { name: string } | null;
  category?: { name: string } | null;
};

const priority = [
  "1. Profissional + servico",
  "2. Profissional + categoria",
  "3. Profissional padrao",
  "4. Servico geral",
  "5. Categoria geral",
  "6. Padrao da barbearia",
];

function scopeLabel(config: Config) {
  const parts = [config.member?.user.name, config.service?.name, config.category?.name].filter(Boolean);
  return parts.join(" / ") || "Padrao da barbearia";
}

function scopeTypeLabel(config: Config) {
  if (config.member && config.service) return "Profissional + servico";
  if (config.member && config.category) return "Profissional + categoria";
  if (config.member) return "Profissional padrao";
  if (config.service) return "Servico geral";
  if (config.category) return "Categoria geral";
  return "Padrao da barbearia";
}

export default function CommissionConfigsPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [members, setMembers] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [form, setForm] = useState({ memberId: "", serviceId: "", categoryId: "", type: "PERCENTAGE", value: "40", active: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [configsRes, membersRes, servicesRes, categoriesRes] = await Promise.all([
      fetch("/api/admin/commissions/configs"),
      fetch("/api/admin/team"),
      fetch("/api/admin/services"),
      fetch("/api/admin/categories"),
    ]);
    setConfigs(await configsRes.json());
    setMembers(await membersRes.json());
    setServices(await servicesRes.json());
    setCategories(await categoriesRes.json());
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(() => setError("Erro ao carregar configuracoes."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save() {
    setSaving(true);
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/commissions/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        memberId: form.memberId || null,
        serviceId: form.serviceId || null,
        categoryId: form.categoryId || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erro ao salvar regra.");
    } else {
      await load();
    }
    setSaving(false);
    setLoading(false);
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Configurações de Comissão</h1>
        <p className="text-sm text-[var(--text-muted)]">A primeira regra válida na prioridade abaixo será aplicada e salva como snapshot.</p>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        <div className="rounded-xl border border-[var(--gold-border)] bg-[var(--surface-raised)] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-widest text-[var(--gold)] font-bold mb-3">Prioridade</p>
          <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
            {priority.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-4 shadow-sm">
          <div className="grid md:grid-cols-3 gap-3">
            <select
              value={form.memberId}
              onChange={(e) => setForm({ ...form, memberId: e.target.value })}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            >
              <option value="">Sem profissional</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user?.name ?? member.name}
                </option>
              ))}
            </select>
            <select
              value={form.serviceId}
              onChange={(e) => setForm({ ...form, serviceId: e.target.value, categoryId: "" })}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            >
              <option value="">Sem serviço</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value, serviceId: "" })}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            >
              <option value="PERCENTAGE">Percentual</option>
              <option value="FIXED_VALUE">Valor fixo</option>
            </select>
            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            />
            <button
              disabled={saving}
              onClick={save}
              className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Salvando..." : "Salvar Regra"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] select-none cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="rounded border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--gold)] focus:ring-[var(--gold-border)]"
            />
            Regra ativa
          </label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-[var(--border-danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : configs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
          Nenhuma regra cadastrada.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {configs.map((config) => (
            <div key={config.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm hover:border-[var(--border-medium)] transition-colors">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[var(--text-primary)] font-semibold">{scopeLabel(config)}</p>
                <span className={`text-xxs px-2 py-0.5 rounded-full font-bold border ${
                  config.active
                    ? "bg-[var(--success-subtle)] text-emerald-400 border-emerald-950/20"
                    : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)]"
                }`}>
                  {config.active ? "Ativa" : "Inativa"}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {scopeTypeLabel(config)}
              </p>
              <p className="text-[var(--gold)] mt-3 font-serif font-bold text-base">
                {config.type === "PERCENTAGE"
                  ? `${config.value}%`
                  : Number(config.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
