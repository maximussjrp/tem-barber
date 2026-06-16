"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─────────── Types ───────────
interface Service { id: string; name: string; price: string; category: { name: string } }
interface WorkingHour {
  dayOfWeek: number; startTime: string; endTime: string;
  breakStart: string | null; breakEnd: string | null; isActive: boolean;
}
interface TimeOff { id: string; startDate: string; endDate: string; reason: string | null }
interface Member {
  id: string; role: string; bio: string | null; isActive: boolean; ratingAvg: number;
  user: { id: string; name: string; email: string | null; phone: string; avatarUrl: string | null };
  workingHours: WorkingHour[];
  services: { service: { id: string; name: string; price: string } }[];
  timeOffs: TimeOff[];
}

// ─────────── Helpers ───────────
const DAYS = [
  { value: 0, label: "Domingo" }, { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" }, { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" }, { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
];
const ROLE_OPTIONS = [
  { value: "BARBER", label: "Barbeiro" },
  { value: "MANAGER", label: "Gerente" },
  { value: "OWNER", label: "Proprietário" },
];
const inputClass = "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";
const labelClass = "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

function defaultHours(existing: WorkingHour[]): WorkingHour[] {
  return DAYS.map((d) => {
    const saved = existing.find((h) => h.dayOfWeek === d.value);
    return saved ?? {
      dayOfWeek: d.value, startTime: "09:00", endTime: "18:00",
      breakStart: null, breakEnd: null, isActive: d.value >= 1 && d.value <= 5,
    };
  });
}

// ─────────── Component ───────────
type Tab = "perfil" | "servicos" | "horarios" | "folgas";

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const memberId = params.id;

  const [member, setMember] = useState<Member | null>(null);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("perfil");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Perfil state
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Serviços state
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [savingServices, setSavingServices] = useState(false);

  // Horários state
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [savingHours, setSavingHours] = useState(false);

  // Folgas state
  const [timeOffStart, setTimeOffStart] = useState("");
  const [timeOffEnd, setTimeOffEnd] = useState("");
  const [timeOffReason, setTimeOffReason] = useState("");
  const [savingTimeOff, setSavingTimeOff] = useState(false);
  const [deletingTimeOffId, setDeletingTimeOffId] = useState<string | null>(null);

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, sRes] = await Promise.all([
        fetch(`/api/admin/team/${memberId}`),
        fetch("/api/admin/services"),
      ]);
      if (!mRes.ok) { router.push("/admin/equipe"); return; }
      const m: Member = await mRes.json();
      const s: Service[] = await sRes.json();
      setMember(m);
      setAllServices(s);
      setRole(m.role);
      setBio(m.bio ?? "");
      setHours(defaultHours(m.workingHours));
      setSelectedServices(new Set(m.services.map((bs) => bs.service.id)));
    } catch {
      setError("Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [memberId, router]);

  useEffect(() => { load(); }, [load]);

  // ── Perfil ──
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true); setError(null);
    try {
      const res = await fetch(`/api/admin/team/${memberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, bio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMember((prev) => prev ? { ...prev, role: data.role, bio: data.bio } : prev);
      showSuccess("Perfil atualizado!");
    } catch (e: any) { setError(e.message ?? "Erro."); }
    finally { setSavingProfile(false); }
  }

  // ── Serviços ──
  function toggleService(id: string) {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveServices() {
    setSavingServices(true); setError(null);
    try {
      const res = await fetch(`/api/admin/team/${memberId}/services`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds: Array.from(selectedServices) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showSuccess("Serviços salvos!");
    } catch (e: any) { setError(e.message ?? "Erro."); }
    finally { setSavingServices(false); }
  }

  // ── Horários ──
  function updateHour(dayOfWeek: number, field: keyof WorkingHour, value: string | boolean) {
    setHours((prev) => prev.map((h) => h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h));
  }

  async function saveHours() {
    setSavingHours(true); setError(null);
    try {
      const res = await fetch(`/api/admin/team/${memberId}/working-hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showSuccess("Horários salvos!");
    } catch (e: any) { setError(e.message ?? "Erro."); }
    finally { setSavingHours(false); }
  }

  // ── Folgas ──
  async function addTimeOff(e: React.FormEvent) {
    e.preventDefault();
    setSavingTimeOff(true); setError(null);
    try {
      const res = await fetch(`/api/admin/team/${memberId}/time-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: timeOffStart, endDate: timeOffEnd, reason: timeOffReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMember((prev) => prev ? { ...prev, timeOffs: [...prev.timeOffs, data] } : prev);
      setTimeOffStart(""); setTimeOffEnd(""); setTimeOffReason("");
      showSuccess("Folga registrada!");
    } catch (e: any) { setError(e.message ?? "Erro."); }
    finally { setSavingTimeOff(false); }
  }

  async function deleteTimeOff(timeOffId: string) {
    setDeletingTimeOffId(timeOffId); setError(null);
    try {
      const res = await fetch(`/api/admin/team/${memberId}/time-off`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeOffId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMember((prev) => prev ? { ...prev, timeOffs: prev.timeOffs.filter((t) => t.id !== timeOffId) } : prev);
      showSuccess("Folga excluída!");
    } catch (e: any) { setError(e.message ?? "Erro."); }
    finally { setDeletingTimeOffId(null); }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando...</p>
      </div>
    );
  }

  if (!member) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "perfil", label: "Perfil" },
    { key: "servicos", label: "Serviços" },
    { key: "horarios", label: "Horários" },
    { key: "folgas", label: "Folgas" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      {/* Back + header */}
      <div className="mb-6">
        <Link href="/admin/equipe" className="text-stone-500 hover:text-amber-400 text-sm transition-all">
          ← Voltar para Equipe
        </Link>
        <div className="flex items-center gap-4 mt-4">
          <div className="w-14 h-14 rounded-full bg-stone-800 border border-stone-700 overflow-hidden flex items-center justify-center shrink-0">
            {member.user.avatarUrl ? (
              <img src={member.user.avatarUrl} alt={member.user.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl leading-none">✂️</span>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-100">{member.user.name}</h1>
            <p className="text-stone-400 text-sm">{member.user.phone} · {member.user.email ?? "Sem e-mail"}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-5">
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-lg mb-5">
          ✓ {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-stone-950/80 p-1 rounded-lg border border-stone-800 mb-6 overflow-x-auto gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setError(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
              activeTab === t.key
                ? "bg-amber-500 text-stone-950 shadow-md font-semibold"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Perfil ── */}
      {activeTab === "perfil" && (
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-4">Cargo e Bio</h2>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Cargo</label>
                <select
                  title="Cargo do colaborador"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={inputClass}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Bio / Especialidade</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Ex: Especialista em degradê e barba..."
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {savingProfile ? "Salvando..." : "Salvar Perfil"}
            </button>
          </div>
        </form>
      )}

      {/* ── Tab: Serviços ── */}
      {activeTab === "servicos" && (
        <div>
          <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-stone-800">
              <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Selecione os serviços que este colaborador realiza
              </p>
            </div>
            {allServices.length === 0 ? (
              <p className="text-stone-600 text-sm p-5 text-center">
                Nenhum serviço cadastrado. <Link href="/admin/servicos" className="text-amber-400 hover:underline">Criar serviços →</Link>
              </p>
            ) : (
              <ul className="divide-y divide-stone-800">
                {allServices.map((s) => (
                  <li key={s.id} className="px-5 py-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedServices.has(s.id)}
                        onChange={() => toggleService(s.id)}
                        className="w-4 h-4 accent-amber-500"
                        title={`Selecionar serviço ${s.name}`}
                      />
                      <div className="flex-1">
                        <p className="text-stone-200 text-sm">{s.name}</p>
                        <p className="text-stone-500 text-xs">{s.category.name}</p>
                      </div>
                      <span className="text-amber-400 text-sm font-medium">
                        R$ {Number(s.price).toFixed(2).replace(".", ",")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveServices}
              disabled={savingServices}
              className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {savingServices ? "Salvando..." : "Salvar Serviços"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Horários ── */}
      {activeTab === "horarios" && (
        <div>
          <div className="space-y-3 mb-4">
            {hours.map((h) => {
              const day = DAYS.find((d) => d.value === h.dayOfWeek)!;
              return (
                <div
                  key={h.dayOfWeek}
                  className={`bg-stone-900 border rounded-xl p-4 transition-all ${h.isActive ? "border-stone-800" : "border-stone-900 opacity-60"}`}
                >
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-3 w-36 shrink-0">
                      <button
                        type="button"
                        aria-label={`${h.isActive ? "Desativar" : "Ativar"} ${day.label}`}
                        onClick={() => updateHour(h.dayOfWeek, "isActive", !h.isActive)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${h.isActive ? "bg-amber-500" : "bg-stone-700"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${h.isActive ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                      <span className={`text-sm font-medium ${h.isActive ? "text-stone-200" : "text-stone-600"}`}>{day.label}</span>
                    </div>
                    {h.isActive ? (
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <span className="text-xs text-stone-500">Início</span>
                        <input type="time" title="Horário início" value={h.startTime} onChange={(e) => updateHour(h.dayOfWeek, "startTime", e.target.value)} className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm" />
                        <span className="text-stone-600 text-xs">até</span>
                        <input type="time" title="Horário fim" value={h.endTime} onChange={(e) => updateHour(h.dayOfWeek, "endTime", e.target.value)} className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm" />
                        <span className="text-xs text-stone-600 ml-1">Intervalo:</span>
                        <input type="time" title="Início intervalo" value={h.breakStart ?? ""} onChange={(e) => updateHour(h.dayOfWeek, "breakStart", e.target.value)} className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm" />
                        <span className="text-stone-600 text-xs">–</span>
                        <input type="time" title="Fim intervalo" value={h.breakEnd ?? ""} onChange={(e) => updateHour(h.dayOfWeek, "breakEnd", e.target.value)} className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm" />
                      </div>
                    ) : (
                      <span className="text-stone-600 text-sm italic">Folga</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveHours}
              disabled={savingHours}
              className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {savingHours ? "Salvando..." : "Salvar Horários"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Folgas ── */}
      {activeTab === "folgas" && (
        <div className="space-y-5">
          {/* Add form */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-4">Registrar Folga / Ausência</h2>
            <form onSubmit={addTimeOff} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Data de início *</label>
                  <input
                    type="date"
                    required
                    title="Data de início da folga"
                    value={timeOffStart}
                    onChange={(e) => setTimeOffStart(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Data de fim *</label>
                  <input
                    type="date"
                    required
                    title="Data de fim da folga"
                    value={timeOffEnd}
                    min={timeOffStart}
                    onChange={(e) => setTimeOffEnd(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Motivo</label>
                <input
                  type="text"
                  value={timeOffReason}
                  onChange={(e) => setTimeOffReason(e.target.value)}
                  placeholder="Ex: Férias, Médico, Bloqueio manual..."
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingTimeOff}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-6 py-2.5 rounded-lg text-sm transition-all disabled:opacity-50"
                >
                  {savingTimeOff ? "Registrando..." : "Registrar Folga"}
                </button>
              </div>
            </form>
          </div>

          {/* List */}
          <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                {member.timeOffs.length} folga{member.timeOffs.length !== 1 ? "s" : ""} registrada{member.timeOffs.length !== 1 ? "s" : ""}
              </span>
            </div>
            {member.timeOffs.length === 0 ? (
              <p className="text-stone-600 text-sm p-5 text-center">Nenhuma folga registrada.</p>
            ) : (
              <ul className="divide-y divide-stone-800">
                {member.timeOffs.map((t) => (
                  <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-stone-200 text-sm">
                        {new Date(t.startDate).toLocaleDateString("pt-BR")} → {new Date(t.endDate).toLocaleDateString("pt-BR")}
                      </p>
                      {t.reason && <p className="text-stone-500 text-xs mt-0.5">{t.reason}</p>}
                    </div>
                    <button
                      onClick={() => deleteTimeOff(t.id)}
                      disabled={deletingTimeOffId === t.id}
                      className="text-stone-500 hover:text-red-400 text-xs px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-all disabled:opacity-50 shrink-0"
                    >
                      {deletingTimeOffId === t.id ? "..." : "Excluir"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
