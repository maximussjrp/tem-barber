"use client";

import { useState } from "react";

export interface MemberSlotsData {
  memberName: string;
  startTime: string;
  endTime: string;
  freeSlots: number[]; // minutes from midnight
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Removed unused groupConsecutive

import { formatHeaderDate, todayIsoBR } from "@/lib/time-utils";

export default function WhatsAppShareSlots({
  members,
  barbershopName,
  barbershopSlug,
  todayStr,
}: {
  members: MemberSlotsData[];
  barbershopName: string;
  barbershopSlug: string;
  todayStr: string; // YYYY-MM-DD
}) {
  const dateLabel = formatHeaderDate(todayStr);

  // Selected slots per member: { memberName -> Set<minutes> }
  const [selected, setSelected] = useState<Record<string, Set<number>>>(() => {
    const init: Record<string, Set<number>> = {};
    for (const mem of members) {
      init[mem.memberName] = new Set(mem.freeSlots);
    }
    return init;
  });

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [prevMembers, setPrevMembers] = useState(members);

  if (members !== prevMembers) {
    setPrevMembers(members);
    const init: Record<string, Set<number>> = {};
    for (const mem of members) {
      init[mem.memberName] = new Set(mem.freeSlots);
    }
    setSelected(init);
  }

  const toggleSlot = (memberName: string, slot: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(prev[memberName]);
      if (set.has(slot)) set.delete(slot);
      else set.add(slot);
      next[memberName] = set;
      return next;
    });
  };

  const selectAll = (memberName: string, slots: number[]) => {
    setSelected((prev) => ({ ...prev, [memberName]: new Set(slots) }));
  };

  const clearAll = (memberName: string) => {
    setSelected((prev) => ({ ...prev, [memberName]: new Set() }));
  };

  const totalSelected = Object.values(selected).reduce((s, set) => s + set.size, 0);

  const buildMessage = () => {
    const dateObj = new Date(todayStr + "T00:00:00Z");
    const formattedDate = dateObj.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    
    // Check if selected date is today
    const today = todayIsoBR();
    const dateLabelStr = todayStr === today ? "hoje" : `dia ${formattedDate}`;

    const lines: string[] = [
      `🔥 Horários livres ${dateLabelStr} na ${barbershopName}`,
      "",
    ];

    for (const mem of members) {
      const slots = [...(selected[mem.memberName] ?? [])].sort((a, b) => a - b);
      if (slots.length === 0) continue;
      lines.push(mem.memberName);
      lines.push(slots.map((s) => formatTime(s)).join(", "));
      lines.push("");
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    lines.push("Agende pelo link:");
    lines.push(`${origin}/${barbershopSlug}/agendar`);

    return lines.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildMessage());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Erro ao copiar mensagem:", err);
    }
  };

  const shareOnWhatsApp = () => {
    const text = encodeURIComponent(buildMessage());
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/30 hover:bg-[#25D366]/20 transition-colors text-sm font-semibold"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
        Compartilhar horários
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
      <div className="relative bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#25D366]" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            <div>
              <p className="text-sm font-bold text-stone-100">Compartilhar no WhatsApp</p>
              <p className="text-xs text-stone-500 capitalize">{dateLabel}</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="text-stone-500 hover:text-stone-200 transition-colors" title="Fechar">✕</button>
        </div>

        {/* Slot selection */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {members.length === 0 && (
            <p className="text-stone-500 text-sm text-center py-6">Nenhum barbeiro disponível hoje.</p>
          )}
          {members.map((mem) => {
            const sel = selected[mem.memberName] ?? new Set<number>();
            const allSelected = mem.freeSlots.every((s) => sel.has(s));
            return (
              <div key={mem.memberName}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-stone-800 flex items-center justify-center text-[10px] font-bold text-stone-400">
                      {mem.memberName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold text-stone-200">{mem.memberName}</span>
                    <span className="text-xs text-stone-600">{mem.startTime}–{mem.endTime}</span>
                  </div>
                  <button
                    onClick={() => allSelected ? clearAll(mem.memberName) : selectAll(mem.memberName, mem.freeSlots)}
                    className="text-xs text-amber-500 hover:text-amber-400 transition-colors font-medium"
                  >
                    {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                  </button>
                </div>

                {mem.freeSlots.length === 0 ? (
                  <p className="text-xs text-stone-600 pl-8">Sem horários livres</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pl-8">
                    {mem.freeSlots.map((slot) => {
                      const isSelected = sel.has(slot);
                      return (
                        <button
                          key={slot}
                          onClick={() => toggleSlot(mem.memberName, slot)}
                          className={`text-[11px] tabular-nums px-2 py-1 rounded-md font-semibold border transition-all ${
                            isSelected
                              ? "bg-[#25D366]/20 text-[#25D366] border-[#25D366]/50"
                              : "bg-stone-800/50 text-stone-400 border-stone-700/50 hover:border-stone-600 hover:text-stone-300"
                          }`}
                        >
                          {formatTime(slot)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Preview + send */}
        <div className="shrink-0 border-t border-stone-800 px-5 py-4 space-y-3">
          {totalSelected > 0 && (
            <div className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 max-h-28 overflow-y-auto">
              <p className="text-[11px] text-stone-500 font-semibold uppercase tracking-wider mb-1">Prévia</p>
              <pre className="text-xs text-stone-300 whitespace-pre-wrap font-sans leading-relaxed">
                {buildMessage()}
              </pre>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2.5 rounded-lg border border-stone-700 text-stone-400 hover:bg-stone-800 transition-colors text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={handleCopy}
              disabled={totalSelected === 0}
              className="flex-1 py-2.5 rounded-lg border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 font-bold transition-colors text-sm"
            >
              {copied ? "Copiado!" : "Copiar"}
            </button>
            <button
              onClick={shareOnWhatsApp}
              disabled={totalSelected === 0}
              className="flex-1 py-2.5 rounded-lg bg-[#25D366] hover:bg-[#22c45e] disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 font-bold transition-colors text-sm flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
