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
        <h1 className="text-2xl font-serif font-bold text-stone-100">Configuracoes de comissao</h1>
        <p className="text-sm text-stone-500">A primeira regra valida na prioridade abaixo sera aplicada e salva como snapshot.</p>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        <div className="rounded-xl border border-amber-900/60 bg-stone-950 p-4">
          <p className="text-xs uppercase tracking-widest text-amber-400 mb-3">Prioridade</p>
          <ol className="space-y-2 text-sm text-stone-300">
            {priority.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>

        <div className="rounded-xl border border-stone-800 bg-stone-950 p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100">
              <option value="">Sem profissional</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.user?.name ?? member.name}</option>)}
            </select>
            <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value, categoryId: "" })} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100">
              <option value="">Sem servico</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, serviceId: "" })} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100">
              <option value="">Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100">
              <option value="PERCENTAGE">Percentual</option>
              <option value="FIXED_VALUE">Valor fixo</option>
            </select>
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100" />
            <button disabled={saving} onClick={save} className="px-4 py-2 rounded-lg bg-amber-600 text-stone-950 font-semibold disabled:opacity-50">
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Regra ativa
          </label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      {loading ? <p className="text-stone-500">Carregando...</p> : configs.length === 0 ? (
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-8 text-center text-stone-500">Nenhuma regra cadastrada.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {configs.map((config) => (
            <div key={config.id} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-stone-100 font-semibold">{scopeLabel(config)}</p>
                <span className={`text-xs px-2 py-1 rounded-full ${config.active ? "bg-emerald-950 text-emerald-300" : "bg-stone-800 text-stone-400"}`}>
                  {config.active ? "Ativa" : "Inativa"}
                </span>
              </div>
              <p className="text-sm text-stone-500 mt-1">
                {scopeTypeLabel(config)}
              </p>
              <p className="text-amber-300 mt-3 font-bold">{config.type === "PERCENTAGE" ? `${config.value}%` : Number(config.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
