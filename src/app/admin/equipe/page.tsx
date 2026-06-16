"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatPhone } from "@/lib/utils";

interface Member {
  id: string;
  role: string;
  isActive: boolean;
  ratingAvg: number;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    avatarUrl: string | null;
  };
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Proprietário",
  MANAGER: "Gerente",
  BARBER: "Barbeiro",
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  MANAGER: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  BARBER: "bg-stone-700/50 text-stone-300 border-stone-700",
};

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";
const labelClass = "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

const emptyForm = {
  name: "",
  phone: "",
  cpf: "",
  email: "",
  password: "",
  role: "BARBER",
  bio: "",
};

export default function EquipePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  useEffect(() => { loadMembers(); }, []);

  async function loadMembers() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/team");
      setMembers(await res.json());
    } catch {
      setError("Erro ao carregar a equipe.");
    } finally {
      setLoading(false);
    }
  }

  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, "").substring(0, 11);
    let formatted = digits;
    if (digits.length > 6) {
      formatted = `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
    } else if (digits.length > 2) {
      formatted = `(${digits.substring(0, 2)}) ${digits.substring(2)}`;
    } else if (digits.length > 0) {
      formatted = `(${digits}`;
    }
    setForm((f) => ({ ...f, phone: formatted }));
  }

  function handleCpfChange(value: string) {
    const digits = value.replace(/\D/g, "").substring(0, 11);
    let formatted = digits;
    if (digits.length > 9) {
      formatted = `${digits.substring(0, 3)}.${digits.substring(3, 6)}.${digits.substring(6, 9)}-${digits.substring(9)}`;
    } else if (digits.length > 6) {
      formatted = `${digits.substring(0, 3)}.${digits.substring(3, 6)}.${digits.substring(6)}`;
    } else if (digits.length > 3) {
      formatted = `${digits.substring(0, 3)}.${digits.substring(3)}`;
    }
    setForm((f) => ({ ...f, cpf: formatted }));
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers((prev) => [...prev, data]);
      setModalOpen(false);
      setForm(emptyForm);
      showSuccess("Colaborador adicionado com sucesso!");
    } catch (e: any) {
      setError(e.message ?? "Erro ao cadastrar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(member: Member) {
    setTogglingId(member.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, isActive: data.isActive } : m)));
    } catch (e: any) {
      setError(e.message ?? "Erro ao alterar status.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Equipe</h1>
          <p className="text-stone-400 text-sm mt-1">
            Gerencie os colaboradores da barbearia.
          </p>
        </div>
        <button
          onClick={() => { setError(null); setModalOpen(true); }}
          className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-all"
        >
          + Convidar Colaborador
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-6">
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-lg mb-6">
          ✓ {success}
        </div>
      )}

      {loading ? (
        <p className="text-stone-500 animate-pulse">Carregando equipe...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {members.map((member) => (
            <div
              key={member.id}
              className={`bg-stone-900 border rounded-xl p-5 transition-all ${
                member.isActive ? "border-stone-800" : "border-stone-900 opacity-60"
              }`}
            >
              {/* Header */}
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-stone-800 border border-stone-700 overflow-hidden flex items-center justify-center shrink-0">
                  {member.user.avatarUrl ? (
                    <img src={member.user.avatarUrl} alt={member.user.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl leading-none">✂️</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-stone-100 font-semibold text-sm truncate">
                    {member.user.name}
                  </p>
                  <p className="text-stone-500 text-xs mt-0.5">
                    {formatPhone(member.user.phone)}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${ROLE_COLORS[member.role]}`}>
                      {ROLE_LABELS[member.role] ?? member.role}
                    </span>
                    {!member.isActive && (
                      <span className="text-xs px-2 py-0.5 rounded border bg-stone-800 text-stone-500 border-stone-700">
                        Inativo
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Rating */}
              {member.ratingAvg > 0 && (
                <div className="flex items-center gap-1 mb-4">
                  <span className="text-amber-400 text-sm">★</span>
                  <span className="text-stone-300 text-sm font-medium">
                    {member.ratingAvg.toFixed(1)}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-3">
                <Link
                  href={`/admin/equipe/${member.id}`}
                  className="flex-1 text-center text-xs font-medium text-stone-400 hover:text-amber-400 border border-stone-800 hover:border-amber-500/30 py-2 rounded-lg transition-all"
                >
                  Gerenciar
                </Link>
                {member.role !== "OWNER" && (
                  <button
                    onClick={() => handleToggle(member)}
                    disabled={togglingId === member.id}
                    className={`flex-1 text-xs font-medium py-2 rounded-lg border transition-all disabled:opacity-50 ${
                      member.isActive
                        ? "text-stone-500 hover:text-red-400 border-stone-800 hover:border-red-500/30"
                        : "text-stone-500 hover:text-emerald-400 border-stone-800 hover:border-emerald-500/30"
                    }`}
                  >
                    {togglingId === member.id ? "..." : member.isActive ? "Desativar" : "Ativar"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-lg shadow-2xl relative overflow-hidden my-4">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-stone-100">Convidar Colaborador</h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-stone-600 hover:text-stone-300 text-xl leading-none"
                  aria-label="Fechar modal"
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-xs px-3 py-2 rounded-lg mb-4">
                  ⚠️ {error}
                </div>
              )}

              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className={labelClass}>Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Carlos Santos"
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Telefone *</label>
                    <input
                      type="tel"
                      required
                      value={form.phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>CPF *</label>
                    <input
                      type="text"
                      required
                      value={form.cpf}
                      onChange={(e) => handleCpfChange(e.target.value)}
                      placeholder="000.000.000-00"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>E-mail</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Ex: carlos@email.com"
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Senha provisória *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="Mín. 6 caracteres"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Cargo *</label>
                    <select
                      title="Cargo do colaborador"
                      required
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="BARBER">Barbeiro</option>
                      <option value="MANAGER">Gerente</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Bio / Especialidade</label>
                  <textarea
                    rows={2}
                    value={form.bio}
                    onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                    placeholder="Ex: Especialista em degradê e barba..."
                    className={`${inputClass} resize-none`}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold py-3 rounded-lg text-sm transition-all disabled:opacity-50"
                  >
                    {saving ? "Cadastrando..." : "Cadastrar Colaborador"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-5 border border-stone-700 text-stone-400 hover:text-stone-200 rounded-lg text-sm transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
