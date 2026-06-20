"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Props = {
  slug: string;
};

export function OnboardingPublicLink({ slug }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const path = `/${slug}/agendar`;
  const publicUrl = useMemo(() => {
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  }, [path]);

  async function copyLink() {
    setCopied(false);
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard indisponivel");
      }
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div id="link-publico" className="rounded-2xl border border-[var(--gold-border)] bg-[var(--surface-1)] p-5 md:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--gold)] mb-2">Link de agendamento</p>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Use este link para receber agendamentos pelo WhatsApp, Instagram ou Google.
          </p>
          <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-secondary)] break-all">
            {publicUrl}
          </p>
          {copied && <p className="mt-2 text-xs font-semibold text-emerald-300">Link copiado!</p>}
          {copyFailed && (
            <p className="mt-2 text-xs text-amber-300">
              Nao foi possivel copiar automaticamente. Selecione o link acima e copie manualmente.
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0">
          <button type="button" onClick={copyLink} className="btn-gold px-4 py-2 text-sm">
            Copiar link publico
          </button>
          <Link href={path} className="btn-outline-gold px-4 py-2 text-sm text-center">
            Visualizar pagina de agendamento
          </Link>
        </div>
      </div>
    </div>
  );
}
