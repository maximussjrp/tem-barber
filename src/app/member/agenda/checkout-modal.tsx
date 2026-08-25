import { useState, useEffect, useCallback } from "react";

interface CheckoutContextType {
  comanda: {
    id: string;
    status?: string;
    total: string;
    paidTotal: string;
    remainingTotal: string;
  };
  items: Array<{
    id?: string;
    type?: string;
    description: string;
    unitPrice: string;
    quantity: string;
    total?: string;
    status: string;
    executorId?: string | null;
  }>;
  operationalState?: "ACTIVE" | "AWAITING_PAYMENT" | "COMPLETED";
  canPayNow: boolean;
  canLeaveForCash: boolean;
  hasTeamPendingService: boolean;
}

interface Appointment {
  id: string;
  customer: { name: string };
}

/**
 * DECISION #3, #18, #19: Checkout modal with payment methods grid
 * Desktop: modal centered, Mobile: bottom sheet
 */
export function CheckoutModal({
  appointment,
  isOpen,
  onClose,
  onFinalize,
}: {
  appointment: Appointment;
  isOpen: boolean;
  onClose: () => void;
  onFinalize: (mode: "pay_now" | "leave_for_cash", method?: string) => Promise<void>;
}) {
  const [context, setContext] = useState<CheckoutContextType | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/member/agenda/${appointment.id}/checkout`);
      if (res.ok) {
        const ctx = await res.json();
        setContext(ctx);
      } else {
        const err = await res.json();
        setError(err.message || "Erro ao carregar checkout.");
      }
    } finally {
      setLoading(false);
    }
  }, [appointment.id]);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadContext();
    }
  }, [isOpen, loadContext]);

  const handlePayNow = async () => {
    if (!selectedMethod) {
      setError("Selecione o método de pagamento.");
      return;
    }
    setSubmitting(true);
    try {
      await onFinalize("pay_now", selectedMethod);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeaveForCash = async () => {
    setSubmitting(true);
    try {
      await onFinalize("leave_for_cash");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-stone-900 border border-stone-800 shadow-xl rounded-t-2xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
          <h2 className="text-lg font-bold text-stone-100">Finalizar Atendimento</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300 text-2xl leading-none">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-stone-400 text-center py-8">Carregando...</p>
          ) : error ? (
            <p className="text-sm text-red-400 text-center py-8">{error}</p>
          ) : context ? (
            <>
              {/* Client */}
              <div>
                <p className="text-xs uppercase text-stone-600 font-semibold tracking-wider mb-2">Cliente</p>
                <p className="text-sm font-semibold text-stone-100">{appointment.customer.name}</p>
              </div>

              {/* Items */}
              {context.items.length > 0 && (
                <div>
                  <p className="text-xs uppercase text-stone-600 font-semibold tracking-wider mb-2">Itens</p>
                  <div className="space-y-1">
                    {context.items.map((item) => (
                      <div key={item.description} className="flex justify-between text-xs text-stone-400">
                        <span className="truncate">
                          {item.description}
                          {Number(item.quantity) > 1 && ` x${item.quantity}`}
                        </span>
                        <span className="shrink-0">
                          R$ {parseFloat(item.unitPrice).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="border-t border-stone-800 pt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-400">Total:</span>
                  <span className="font-semibold text-stone-100">
                    R$ {parseFloat(context.comanda.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Já pago:</span>
                  <span className="text-amber-400">
                    R$ {parseFloat(context.comanda.paidTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-base">
                  <span className="text-stone-300">Restante:</span>
                  <span className="text-emerald-400">
                    R$ {parseFloat(context.comanda.remainingTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Payment Methods Grid (DECISION #12, #18) */}
              {context.canPayNow && (
                <div>
                  <p className="text-xs uppercase text-stone-600 font-semibold tracking-wider mb-2">Método de Pagamento</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "CASH", label: "Dinheiro" },
                      { value: "PIX", label: "Pix" },
                      { value: "DEBIT", label: "Débito" },
                      { value: "CREDIT", label: "Crédito" },
                    ].map((method) => (
                      <button
                        key={method.value}
                        onClick={() => setSelectedMethod(method.value)}
                        className={`p-2 rounded-lg border text-xs font-semibold transition-colors ${
                          selectedMethod === method.value
                            ? "border-emerald-500 bg-emerald-900/30 text-emerald-300"
                            : "border-stone-700 bg-stone-950/50 text-stone-400 hover:border-stone-600"
                        }`}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>

                </div>
              )}

              {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
            </>
          ) : null}
        </div>

        {/* Actions */}
        {context && (
          <div className="border-t border-stone-800 px-6 py-4 space-y-2 bg-stone-950">
            {context.canPayNow ? (
              <>
                <button
                  onClick={handlePayNow}
                  disabled={submitting}
                  className="w-full rounded-lg bg-emerald-600 text-stone-950 font-bold py-2.5 hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {submitting
                    ? "Finalizando..."
                    : `Receber R$ ${parseFloat(context.comanda.remainingTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} e finalizar`}
                </button>
                <button
                  onClick={handleLeaveForCash}
                  disabled={submitting}
                  className="w-full rounded-lg border border-stone-700 text-stone-300 font-semibold py-2.5 hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {submitting ? "Finalizando..." : "Concluir e deixar para o caixa"}
                </button>
              </>
            ) : (
              <button
                onClick={handleLeaveForCash}
                disabled={submitting}
                className="w-full rounded-lg bg-emerald-600 text-stone-950 font-bold py-2.5 hover:bg-emerald-500 transition-colors disabled:opacity-50 text-sm"
              >
                {submitting ? "Finalizando..." : "Finalizar atendimento"}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={submitting}
              className="w-full rounded-lg border border-stone-700 text-stone-300 font-semibold py-2.5 hover:bg-stone-800 transition-colors disabled:opacity-50 text-sm"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
