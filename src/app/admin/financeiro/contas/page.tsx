export default function ContasPage() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Contas a Pagar / Receber
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Gerencie contas a pagar e receber, vencimentos e pagamentos da barbearia.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6 text-center space-y-3 max-w-2xl">
        <div className="w-12 h-12 rounded-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          Gestão de Títulos e Contas
        </h2>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Esta área concentra a gestão de contas, vencimentos, pagamentos e recebimentos da barbearia.
        </p>
      </div>
    </div>
  );
}
