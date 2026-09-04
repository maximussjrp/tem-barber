"use client";

import { useEffect, useState } from "react";
import { CommissionNav } from "@/components/admin/commissions/CommissionNav";

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

type CareerLevel = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  defaultCommissionRate: string | null;
  active: boolean;
};

type MatrixService = {
  id: string;
  name: string;
  price: string;
  categoryId: string;
  category: { id: string; name: string };
};

type MatrixRule = {
  id: string;
  serviceId: string;
  careerLevelId: string;
  type: string;
  commissionRate: string;
  active: boolean;
};

const priority = [
  "1. Profissional + serviço",
  "2. Profissional + categoria",
  "3. Profissional padrão",
  "4. Matriz Serviço + Nível de Carreira (Novo)",
  "5. Serviço geral",
  "6. Categoria geral",
  "7. Nível de Carreira Padrão (Novo)",
  "8. Padrão da barbearia",
];

function scopeLabel(config: Config) {
  const parts = [config.member?.user?.name, config.service?.name, config.category?.name].filter(Boolean);
  return parts.join(" / ") || "Padrão da barbearia";
}

function scopeTypeLabel(config: Config) {
  if (config.member && config.service) return "Profissional + serviço";
  if (config.member && config.category) return "Profissional + categoria";
  if (config.member) return "Profissional padrão";
  if (config.service) return "Serviço geral";
  if (config.category) return "Categoria geral";
  return "Padrão da barbearia";
}

export default function CommissionConfigsPage() {
  const [activeTab, setActiveTab] = useState<"configs" | "levels" | "matrix">("configs");

  // Configs state
  const [configs, setConfigs] = useState<Config[]>([]);
  const [members, setMembers] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [form, setForm] = useState({ memberId: "", serviceId: "", categoryId: "", type: "PERCENTAGE", value: "40", active: true });
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [errorConfig, setErrorConfig] = useState("");

  // Levels state
  const [careerLevels, setCareerLevels] = useState<CareerLevel[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  const [editingLevel, setEditingLevel] = useState<CareerLevel | null>(null);
  const [levelModalOpen, setLevelModalOpen] = useState(false);
  const [levelForm, setLevelForm] = useState({
    name: "",
    description: "",
    defaultCommissionRate: "35",
    sortOrder: "0",
    active: true,
  });
  const [errorLevel, setErrorLevel] = useState("");

  // Matrix state
  const [matrixServices, setMatrixServices] = useState<MatrixService[]>([]);
  const [matrixLevels, setMatrixLevels] = useState<CareerLevel[]>([]);
  const [matrixCells, setMatrixCells] = useState<Record<string, string>>({}); // "serviceId:levelId" => "45"
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [errorMatrix, setErrorMatrix] = useState("");
  const [successMatrix, setSuccessMatrix] = useState("");

  async function loadConfigsData() {
    setLoadingConfigs(true);
    try {
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
    } catch {
      setErrorConfig("Erro ao carregar configurações.");
    } finally {
      setLoadingConfigs(false);
    }
  }

  async function loadLevelsData() {
    setLoadingLevels(true);
    try {
      const res = await fetch("/api/admin/career-levels");
      if (res.ok) {
        setCareerLevels(await res.json());
      }
    } catch {
      setErrorLevel("Erro ao carregar níveis de carreira.");
    } finally {
      setLoadingLevels(false);
    }
  }

  async function loadMatrixData() {
    setLoadingMatrix(true);
    setErrorMatrix("");
    setSuccessMatrix("");
    try {
      const res = await fetch("/api/admin/commission-rules/matrix");
      if (res.ok) {
        const data: { services: MatrixService[]; careerLevels: CareerLevel[]; rules: MatrixRule[] } = await res.json();
        setMatrixServices(data.services || []);
        setMatrixLevels(data.careerLevels || []);

        const initialCells: Record<string, string> = {};
        for (const rule of data.rules || []) {
          if (rule.active) {
            initialCells[`${rule.serviceId}:${rule.careerLevelId}`] = String(rule.commissionRate);
          }
        }
        setMatrixCells(initialCells);
      }
    } catch {
      setErrorMatrix("Erro ao carregar matriz de comissões.");
    } finally {
      setLoadingMatrix(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadConfigsData();
  }, []);

  useEffect(() => {
    if (activeTab === "levels") {
      loadLevelsData();
    } else if (activeTab === "matrix") {
      loadMatrixData();
    }
  }, [activeTab]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Config handlers
  async function saveConfig() {
    setSavingConfig(true);
    setErrorConfig("");
    try {
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
        setErrorConfig(data.error || "Erro ao salvar regra.");
      } else {
        await loadConfigsData();
      }
    } catch {
      setErrorConfig("Erro de rede ao salvar regra.");
    } finally {
      setSavingConfig(false);
    }
  }

  // Career level handlers
  function openNewLevelModal() {
    setEditingLevel(null);
    setLevelForm({ name: "", description: "", defaultCommissionRate: "35", sortOrder: "0", active: true });
    setErrorLevel("");
    setLevelModalOpen(true);
  }

  function openEditLevelModal(level: CareerLevel) {
    setEditingLevel(level);
    setLevelForm({
      name: level.name,
      description: level.description || "",
      defaultCommissionRate: level.defaultCommissionRate ? String(level.defaultCommissionRate) : "",
      sortOrder: String(level.sortOrder || 0),
      active: level.active,
    });
    setErrorLevel("");
    setLevelModalOpen(true);
  }

  async function saveLevel() {
    setSavingLevel(true);
    setErrorLevel("");
    try {
      const url = editingLevel ? `/api/admin/career-levels/${editingLevel.id}` : "/api/admin/career-levels";
      const method = editingLevel ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: levelForm.name,
          description: levelForm.description,
          defaultCommissionRate: levelForm.defaultCommissionRate,
          sortOrder: Number(levelForm.sortOrder) || 0,
          active: levelForm.active,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorLevel(data.error || "Erro ao salvar nível de carreira.");
      } else {
        setLevelModalOpen(false);
        await loadLevelsData();
      }
    } catch {
      setErrorLevel("Erro de rede ao salvar nível de carreira.");
    } finally {
      setSavingLevel(false);
    }
  }

  async function toggleLevelActive(level: CareerLevel) {
    try {
      const res = await fetch(`/api/admin/career-levels/${level.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !level.active }),
      });
      if (res.ok) {
        await loadLevelsData();
      }
    } catch {
      // ignore
    }
  }

  // Matrix handlers
  function handleCellChange(serviceId: string, levelId: string, value: string) {
    setMatrixCells((prev) => ({
      ...prev,
      [`${serviceId}:${levelId}`]: value,
    }));
  }

  async function saveMatrix() {
    setSavingMatrix(true);
    setErrorMatrix("");
    setSuccessMatrix("");

    const rulesPayload: Array<{ serviceId: string; careerLevelId: string; commissionRate: string | null }> = [];

    for (const service of matrixServices) {
      for (const level of matrixLevels) {
        const key = `${service.id}:${level.id}`;
        const val = matrixCells[key];
        rulesPayload.push({
          serviceId: service.id,
          careerLevelId: level.id,
          commissionRate: val !== undefined && val !== "" ? val : null,
        });
      }
    }

    try {
      const res = await fetch("/api/admin/commission-rules/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rulesPayload }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMatrix(data.error || "Erro ao salvar matriz de comissão.");
      } else {
        setSuccessMatrix("Matriz de comissão salva com sucesso!");
        setTimeout(() => setSuccessMatrix(""), 4000);
        await loadMatrixData();
      }
    } catch {
      setErrorMatrix("Erro de rede ao salvar matriz.");
    } finally {
      setSavingMatrix(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Configurações de Comissão</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Gerencie regras específicas por colaborador, níveis de carreira e matriz de percentuais por serviço.
        </p>
      </div>

      <CommissionNav />

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-subtle)] gap-2">
        <button
          onClick={() => setActiveTab("configs")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "configs"
              ? "border-[var(--gold)] text-[var(--gold)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          Regras Específicas
        </button>
        <button
          onClick={() => setActiveTab("levels")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "levels"
              ? "border-[var(--gold)] text-[var(--gold)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          Níveis de Carreira
        </button>
        <button
          onClick={() => setActiveTab("matrix")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "matrix"
              ? "border-[var(--gold)] text-[var(--gold)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          Matriz Serviço x Nível
        </button>
      </div>

      {/* Tab 1: Regras Específicas */}
      {activeTab === "configs" && (
        <div className="space-y-5">
          <div className="grid md:grid-cols-[280px_1fr] gap-4">
            <div className="rounded-xl border border-[var(--gold-border)] bg-[var(--surface-raised)] p-4 shadow-sm">
              <p className="text-xs uppercase tracking-widest text-[var(--gold)] font-bold mb-3">Ordem de Prioridade</p>
              <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
                {priority.map((item) => (
                  <li key={item} className="text-xs leading-relaxed">{item}</li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-4 shadow-sm">
              <div className="grid md:grid-cols-3 gap-3">
                <select
                  value={form.memberId}
                  onChange={(e) => setForm({ ...form, memberId: e.target.value })}
                  className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="">Sem profissional (Geral)</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user?.name ?? member.name}
                    </option>
                  ))}
                </select>
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value, categoryId: "" })}
                  className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
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
                  className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
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
                  className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="PERCENTAGE">Percentual (%)</option>
                  <option value="FIXED_VALUE">Valor Fixo (R$)</option>
                </select>
                <input
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="Ex: 40"
                  className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
                <button
                  disabled={savingConfig}
                  onClick={saveConfig}
                  className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold text-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingConfig ? "Salvando..." : "Salvar Regra"}
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

          {errorConfig && (
            <div className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              ⚠️ {errorConfig}
            </div>
          )}

          {loadingConfigs ? (
            <p className="text-[var(--text-muted)] text-sm animate-pulse">Carregando regras...</p>
          ) : configs.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] text-sm">
              Nenhuma regra individual cadastrada.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm hover:border-[var(--border-medium)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[var(--text-primary)] font-semibold text-sm">{scopeLabel(config)}</p>
                    <span
                      className={`text-xxs px-2 py-0.5 rounded-full font-bold border ${
                        config.active
                          ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/20"
                          : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)]"
                      }`}
                    >
                      {config.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{scopeTypeLabel(config)}</p>
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
      )}

      {/* Tab 2: Níveis de Carreira */}
      {activeTab === "levels" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">
              Cadastre os níveis de senioridade dos profissionais (ex: Junior, Pleno, Senior).
            </p>
            <button
              onClick={openNewLevelModal}
              className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold text-sm transition-all cursor-pointer"
            >
              + Novo Nível
            </button>
          </div>

          {loadingLevels ? (
            <p className="text-[var(--text-muted)] text-sm animate-pulse">Carregando níveis...</p>
          ) : careerLevels.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] text-sm">
              Crie seus níveis de carreira para configurar percentuais por serviço.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {careerLevels.map((level) => (
                <div
                  key={level.id}
                  className={`rounded-xl border p-4 transition-all ${
                    level.active
                      ? "border-[var(--border-subtle)] bg-[var(--surface)]"
                      : "border-[var(--border-subtle)] bg-[var(--surface)] opacity-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-bold text-[var(--text-primary)] text-base">{level.name}</h3>
                      {level.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{level.description}</p>
                      )}
                    </div>
                    <span
                      className={`text-xxs px-2 py-0.5 rounded-full font-bold border shrink-0 ${
                        level.active
                          ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/20"
                          : "bg-stone-800 text-stone-400 border-stone-700"
                      }`}
                    >
                      {level.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[var(--text-muted)]">Comissão padrão: </span>
                      <span className="font-bold text-[var(--gold)]">
                        {level.defaultCommissionRate !== null ? `${level.defaultCommissionRate}%` : "Sem padrão"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditLevelModal(level)}
                        className="text-xs font-semibold text-[var(--gold)] hover:underline cursor-pointer"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleLevelActive(level)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {level.active ? "Inativar" : "Ativar"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal Modal Novo / Editar Nível */}
          {levelModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
              <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
                <h2 className="text-lg font-bold text-stone-100">
                  {editingLevel ? "Editar Nível de Carreira" : "Novo Nível de Carreira"}
                </h2>

                {errorLevel && (
                  <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-xs px-3 py-2 rounded-lg">
                    ⚠️ {errorLevel}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                      Nome do nível *
                    </label>
                    <input
                      value={levelForm.name}
                      onChange={(e) => setLevelForm({ ...levelForm, name: e.target.value })}
                      placeholder="Ex: Barbeiro Sênior"
                      className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                      Descrição
                    </label>
                    <input
                      value={levelForm.description}
                      onChange={(e) => setLevelForm({ ...levelForm, description: e.target.value })}
                      placeholder="Ex: Profissional com mais de 3 anos de experiência"
                      className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                        Comissão Padrão (%)
                      </label>
                      <input
                        value={levelForm.defaultCommissionRate}
                        onChange={(e) => setLevelForm({ ...levelForm, defaultCommissionRate: e.target.value })}
                        placeholder="Ex: 35"
                        className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                        Ordem (sortOrder)
                      </label>
                      <input
                        type="number"
                        value={levelForm.sortOrder}
                        onChange={(e) => setLevelForm({ ...levelForm, sortOrder: e.target.value })}
                        className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-stone-300 select-none cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={levelForm.active}
                      onChange={(e) => setLevelForm({ ...levelForm, active: e.target.checked })}
                      className="rounded border-stone-800 bg-stone-950 text-amber-500"
                    />
                    Nível ativo
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
                  <button
                    onClick={() => setLevelModalOpen(false)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-stone-400 hover:text-stone-200 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={savingLevel}
                    onClick={saveLevel}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {savingLevel ? "Salvando..." : "Salvar Nível"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Matriz Serviço x Nível */}
      {activeTab === "matrix" && (
        <div className="space-y-5">
          {/* Fallback alert banner */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-xs space-y-1">
            <p className="font-bold flex items-center gap-1 text-amber-400 text-sm">
              💡 Aviso de Fallback e Prioridade
            </p>
            <p>
              Exceções e regras individuais configuradas na aba <strong>Regras Específicas</strong> continuam tendo prioridade sobre esta matriz.
            </p>
            <p className="text-amber-300/80">
              Esta matriz será utilizada para determinar a comissão quando o barbeiro possuir um Nível de Carreira vinculado no cadastro e não existir uma regra individual cadastrada para ele.
            </p>
          </div>

          {errorMatrix && (
            <div className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              ⚠️ {errorMatrix}
            </div>
          )}
          {successMatrix && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
              ✓ {successMatrix}
            </div>
          )}

          {loadingMatrix ? (
            <p className="text-[var(--text-muted)] text-sm animate-pulse">Carregando matriz de comissões...</p>
          ) : matrixLevels.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] text-sm space-y-2">
              <p>Crie seus níveis de carreira para configurar percentuais por serviço.</p>
              <button
                onClick={() => setActiveTab("levels")}
                className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] font-bold text-xs cursor-pointer"
              >
                Ir para Níveis de Carreira
              </button>
            </div>
          ) : matrixServices.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] text-sm">
              Nenhum serviço ativo cadastrado.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-[var(--text-muted)]">
                  Preencha a comissão em % para cada célula. Deixe em branco para remover a regra e usar o fallback padrão.
                </p>
                <button
                  disabled={savingMatrix}
                  onClick={saveMatrix}
                  className="px-5 py-2.5 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold text-sm transition-all disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {savingMatrix ? "Salvando Matriz..." : "Salvar Matriz"}
                </button>
              </div>

              {/* Matrix Table with horizontal scroll */}
              <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-sm">
                <table className="w-full text-left text-sm border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
                      <th className="p-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider min-w-[200px]">
                        Serviço / Categoria
                      </th>
                      {matrixLevels.map((level) => (
                        <th
                          key={level.id}
                          className="p-3 text-xs font-semibold text-center text-[var(--gold)] uppercase tracking-wider min-w-[120px]"
                        >
                          <div>{level.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-normal lowercase">
                            {level.defaultCommissionRate !== null ? `padrão: ${level.defaultCommissionRate}%` : "sem padrão"}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {matrixServices.map((service) => (
                      <tr key={service.id} className="hover:bg-[var(--surface-raised)]/50 transition-colors">
                        <td className="p-3">
                          <div className="font-semibold text-[var(--text-primary)] text-sm">{service.name}</div>
                          <div className="text-xs text-[var(--text-muted)] flex items-center gap-2">
                            <span>{service.category?.name || "Geral"}</span>
                            <span>•</span>
                            <span>
                              {Number(service.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        </td>

                        {matrixLevels.map((level) => {
                          const cellKey = `${service.id}:${level.id}`;
                          const cellValue = matrixCells[cellKey] ?? "";

                          return (
                            <td key={level.id} className="p-3 text-center">
                              <div className="relative inline-block w-24">
                                <input
                                  type="text"
                                  value={cellValue}
                                  onChange={(e) => handleCellChange(service.id, level.id, e.target.value)}
                                  placeholder={level.defaultCommissionRate !== null ? String(level.defaultCommissionRate) : "—"}
                                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-center text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                                />
                                <span className="absolute right-2 top-2 text-xs text-[var(--text-muted)] pointer-events-none">
                                  %
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  disabled={savingMatrix}
                  onClick={saveMatrix}
                  className="px-5 py-2.5 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold text-sm transition-all disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {savingMatrix ? "Salvando Matriz..." : "Salvar Matriz"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
