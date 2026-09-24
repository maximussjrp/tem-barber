"use client";

export function OperationOptionsModal({
  onClose,
  onSelectFitIn,
  onSelectBlock,
}: {
  onClose: () => void;
  onSelectFitIn: () => void;
  onSelectBlock: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">Opções da agenda</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">
          Selecione a operação que deseja realizar na agenda:
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectFitIn();
            }}
            className="w-full text-left p-4 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 transition-all flex flex-col gap-1 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-orange-200 group-hover:text-orange-100">
                + NOVO ENCAIXE
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-300">
                Encaixe
              </span>
            </div>
            <p className="text-xs text-stone-300">
              Criar um atendimento mesmo quando houver outro agendamento no horário.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectBlock();
            }}
            className="w-full text-left p-4 rounded-xl border border-stone-700 bg-stone-900/80 hover:bg-stone-800 transition-all flex flex-col gap-1 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-stone-200 group-hover:text-stone-100">
                🔒 BLOQUEAR AGENDA
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-stone-800 text-stone-400">
                Bloqueio
              </span>
            </div>
            <p className="text-xs text-stone-400">
              Indisponibilizar um período para saída, compromisso, intervalo ou ausência do profissional.
            </p>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
