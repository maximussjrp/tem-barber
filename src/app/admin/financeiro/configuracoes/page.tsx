export default function ConfiguracoesFinanceirasPage() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Configurações Financeiras
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Configure como o financeiro da sua barbearia funciona.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        {/* Card 1: Contas recorrentes */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6" />
                <path d="M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Contas recorrentes
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Configure despesas e receitas que se repetem.
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3 leading-relaxed">
            Área destinada à configuração de despesas e receitas recorrentes da barbearia.
          </p>
        </div>

        {/* Card 2: Categorias */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9h16" />
                <path d="M4 15h16" />
                <path d="M10 3v18" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Categorias
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Organize a classificação das movimentações financeiras.
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3 leading-relaxed">
            Plano de contas e categorias usados para organizar receitas, despesas e demais movimentações financeiras.
          </p>
        </div>
      </div>
    </div>
  );
}
