"use client";

import { useState } from "react";

export default function BookingLinkShare({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const bookingUrl = `${baseUrl}/${slug}/agendar`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("input");
      el.value = bookingUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const shareWhatsApp = () => {
    const scissors = String.fromCodePoint(0x2702, 0xFE0F);
    const calendar = String.fromCodePoint(0x1F4C5);
    const link = String.fromCodePoint(0x1F517);
    const msg = `${scissors} Agende seu horário conosco!\n${calendar} É rápido e fácil.\n${link} ${bookingUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Link de agendamento</h2>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Compartilhe seu link e receba agendamentos automaticamente.
      </p>

      {/* URL + copy */}
      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-3 py-2">
        <p className="flex-1 text-xs text-[var(--text-muted)] font-mono truncate min-w-0">
          {bookingUrl || `/${slug}/agendar`}
        </p>
        <button
          onClick={copy}
          className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all border ${
            copied
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
              : "bg-[var(--gold-surface)] text-[var(--gold)] border-[var(--gold-border)] hover:bg-[var(--gold)] hover:text-[#111113]"
          }`}
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/${slug}/agendar`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:border-[var(--gold-border)] hover:text-[var(--gold)] transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          Visualizar
        </a>
        <button
          onClick={shareWhatsApp}
          className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-xl bg-emerald-600/15 border border-emerald-600/25 text-emerald-400 hover:bg-emerald-600/25 transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          WhatsApp
        </button>
      </div>
    </div>
  );
}
