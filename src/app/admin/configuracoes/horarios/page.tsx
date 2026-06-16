"use client";

import { useState, useEffect } from "react";

const DAYS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
];

interface HourEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  isActive: boolean;
}

function defaultHours(): HourEntry[] {
  return DAYS.map((d) => ({
    dayOfWeek: d.value,
    startTime: "09:00",
    endTime: "18:00",
    breakStart: "",
    breakEnd: "",
    isActive: d.value >= 1 && d.value <= 5, // Mon–Fri active by default
  }));
}

const inputClass =
  "bg-stone-950/70 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm w-full";

export default function HorariosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hours, setHours] = useState<HourEntry[]>(defaultHours());

  useEffect(() => {
    fetch("/api/admin/working-hours")
      .then((r) => r.json())
      .then((data: any[]) => {
        if (data.length > 0) {
          const updated = defaultHours().map((def) => {
            const saved = data.find((h) => h.dayOfWeek === def.dayOfWeek);
            if (saved) {
              return {
                dayOfWeek: saved.dayOfWeek,
                startTime: saved.startTime,
                endTime: saved.endTime,
                breakStart: saved.breakStart ?? "",
                breakEnd: saved.breakEnd ?? "",
                isActive: saved.isActive,
              };
            }
            return def;
          });
          setHours(updated);
        }
      })
      .catch(() => setError("Não foi possível carregar os horários."))
      .finally(() => setLoading(false));
  }, []);

  function update(dayOfWeek: number, field: keyof HourEntry, value: string | boolean) {
    setHours((prev) =>
      prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h))
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/working-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess("Horários salvos com sucesso!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando horários...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Horários de Funcionamento</h1>
        <p className="text-stone-400 text-sm mt-1">
          Defina os dias e horários em que você atende.
        </p>
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

      <div className="space-y-3">
        {hours.map((h) => {
          const day = DAYS.find((d) => d.value === h.dayOfWeek)!;
          return (
            <div
              key={h.dayOfWeek}
              className={`bg-stone-900 border rounded-xl p-4 transition-all ${
                h.isActive ? "border-stone-800" : "border-stone-900 opacity-60"
              }`}
            >
              <div className="flex items-center gap-4 flex-wrap">
                {/* Toggle + Day name */}
                <div className="flex items-center gap-3 w-36 shrink-0">
                  <button
                    type="button"
                    onClick={() => update(h.dayOfWeek, "isActive", !h.isActive)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      h.isActive ? "bg-amber-500" : "bg-stone-700"
                    }`}
                    aria-label={`${h.isActive ? "Desativar" : "Ativar"} ${day.label}`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        h.isActive ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className={`text-sm font-medium ${h.isActive ? "text-stone-200" : "text-stone-600"}`}>
                    {day.label}
                  </span>
                </div>

                {h.isActive ? (
                  <div className="flex items-center gap-2 flex-wrap flex-1">
                    {/* Working hours */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-stone-500 shrink-0">Início</label>
                      <input
                        type="time"
                        value={h.startTime}
                        onChange={(e) => update(h.dayOfWeek, "startTime", e.target.value)}
                        title="Horário de início"
                        className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm"
                      />
                    </div>
                    <span className="text-stone-600 text-xs">até</span>
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-stone-500 shrink-0">Fim</label>
                      <input
                        type="time"
                        value={h.endTime}
                        onChange={(e) => update(h.dayOfWeek, "endTime", e.target.value)}
                        title="Horário de fim"
                        className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm"
                      />
                    </div>

                    {/* Break */}
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className="text-xs text-stone-600">Intervalo:</span>
                      <input
                        type="time"
                        value={h.breakStart}
                        onChange={(e) => update(h.dayOfWeek, "breakStart", e.target.value)}
                        placeholder="--:--"
                        className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm"
                      />
                      <span className="text-stone-600 text-xs">–</span>
                      <input
                        type="time"
                        value={h.breakEnd}
                        onChange={(e) => update(h.dayOfWeek, "breakEnd", e.target.value)}
                        placeholder="--:--"
                        className="bg-stone-950/70 border border-stone-800 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500/80 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-stone-600 text-sm italic">Fechado</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all disabled:opacity-50 text-sm tracking-wide"
        >
          {saving ? "Salvando..." : "Salvar Horários"}
        </button>
      </div>
    </div>
  );
}
