"use client";

import { useState } from "react";

type Props = {
  remainingTotal: number;
  busy: boolean;
  onPay: (payments: { method: string; amount: string }[]) => Promise<void>;
  onClose: () => void;
};

interface MixedPaymentItem {
  id: string;
  method: string;
  amount: string;
}

export function PaymentModal({ remainingTotal, busy, onPay, onClose }: Props) {
  const [isMixed, setIsMixed] = useState(false);
  const [singleMethod, setSingleMethod] = useState("PIX");
  const [singleAmount, setSingleAmount] = useState(remainingTotal.toFixed(2));
  
  // Para pagamento misto
  const [mixedPayments, setMixedPayments] = useState<MixedPaymentItem[]>([
    { id: "1", method: "PIX", amount: "" },
  ]);

  const [cashReceived, setCashReceived] = useState("");

  const amountNum = Number(singleAmount) || 0;
  const cashReceivedNum = Number(cashReceived) || 0;
  const showChange = !isMixed && singleMethod === "CASH" && cashReceivedNum > amountNum && amountNum > 0;
  const change = showChange ? cashReceivedNum - amountNum : 0;

  // Calculos para pagamento misto
  const mixedTotal = mixedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const mixedDiff = remainingTotal - mixedTotal;

  function addMixedRow() {
    setMixedPayments([
      ...mixedPayments,
      { id: crypto.randomUUID(), method: "PIX", amount: "" },
    ]);
  }

  function removeMixedRow(id: string) {
    if (mixedPayments.length === 1) return;
    setMixedPayments(mixedPayments.filter((p) => p.id !== id));
  }

  function updateMixedRow(id: string, field: "method" | "amount", value: string) {
    setMixedPayments(
      mixedPayments.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!isMixed) {
      if (amountNum <= 0) {
        alert("Valor deve ser maior que zero.");
        return;
      }
      if (amountNum > remainingTotal) {
        alert("Valor não pode ser maior que o saldo restante.");
        return;
      }
      if (singleMethod === "CASH" && cashReceivedNum > 0 && cashReceivedNum < amountNum) {
        alert("Valor recebido em dinheiro é menor que o valor a pagar.");
        return;
      }
      
      await onPay([{ method: singleMethod, amount: amountNum.toFixed(2) }]);
    } else {
      // Validar pagamento misto
      if (mixedPayments.some((p) => (Number(p.amount) || 0) <= 0)) {
        alert("Cada parcela deve ter um valor maior que zero.");
        return;
      }
      if (Math.abs(mixedDiff) >= 0.01) {
        alert(`A soma das parcelas (R$ ${mixedTotal.toFixed(2)}) deve ser exatamente igual ao total restante (R$ ${remainingTotal.toFixed(2)}).`);
        return;
      }
      
      const payload = mixedPayments.map((p) => ({
        method: p.method,
        amount: (Number(p.amount) || 0).toFixed(2),
      }));
      await onPay(payload);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
      <div className="bg-stone-900 border border-stone-800 rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-stone-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-stone-100">Finalizar Atendimento - Receber</h2>
          <button onClick={onClose} disabled={busy} className="text-stone-400 hover:text-stone-200 disabled:opacity-50 text-2xl leading-none">&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex justify-between items-center bg-stone-950/40 p-3 rounded-lg border border-stone-800">
            <span className="text-sm text-stone-400">Total a Pagar</span>
            <span className="text-xl font-bold text-amber-400">R$ {remainingTotal.toFixed(2)}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Tipo de Pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsMixed(false)}
                className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                  !isMixed
                    ? "bg-amber-500 text-stone-950 font-bold"
                    : "bg-stone-950 border border-stone-700 text-stone-300 hover:bg-stone-800"
                }`}
              >
                Pagamento Único
              </button>
              <button
                type="button"
                onClick={() => setIsMixed(true)}
                className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isMixed
                    ? "bg-amber-500 text-stone-950 font-bold"
                    : "bg-stone-950 border border-stone-700 text-stone-300 hover:bg-stone-800"
                }`}
              >
                Pagamento Misto
              </button>
            </div>
          </div>

          {!isMixed ? (
            // Formulario Pagamento Único
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Forma de Pagamento</label>
                <select
                  value={singleMethod}
                  onChange={(e) => {
                    setSingleMethod(e.target.value);
                    setCashReceived("");
                  }}
                  disabled={busy}
                  className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="PIX">Pix</option>
                  <option value="CREDIT">Cartão de Crédito</option>
                  <option value="DEBIT">Cartão de Débito</option>
                  <option value="CASH">Dinheiro</option>
                  <option value="OTHER">Outros</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Valor do Pagamento (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  max={remainingTotal}
                  value={singleAmount}
                  onChange={(e) => setSingleAmount(e.target.value)}
                  disabled={busy}
                  className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              {singleMethod === "CASH" && (
                <div className="pt-2 border-t border-stone-800">
                  <label className="block text-sm font-medium text-stone-300 mb-1">Valor recebido do cliente (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    disabled={busy}
                    placeholder="Ex: 50.00"
                    className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500"
                  />
                  {showChange && (
                    <p className="mt-2 text-sm text-amber-400 font-medium">Troco a devolver: R$ {change.toFixed(2)}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Formulario Pagamento Misto
            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-stone-300">Parcelas declaradas</label>
              
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {mixedPayments.map((p, idx) => (
                  <div key={p.id} className="flex gap-2 items-center">
                    <select
                      value={p.method}
                      onChange={(e) => updateMixedRow(p.id, "method", e.target.value)}
                      disabled={busy}
                      className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none text-sm w-1/2"
                    >
                      <option value="PIX">Pix</option>
                      <option value="CREDIT">Crédito</option>
                      <option value="DEBIT">Débito</option>
                      <option value="CASH">Dinheiro</option>
                      <option value="OTHER">Outros</option>
                    </select>
                    
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Valor"
                      value={p.amount}
                      onChange={(e) => updateMixedRow(p.id, "amount", e.target.value)}
                      disabled={busy}
                      className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-stone-100 focus:outline-none text-sm w-1/3"
                    />

                    <button
                      type="button"
                      onClick={() => removeMixedRow(p.id)}
                      disabled={busy || mixedPayments.length === 1}
                      className="p-1.5 text-red-400 hover:text-red-300 disabled:opacity-30 hover:bg-stone-850 rounded-lg"
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addMixedRow}
                disabled={busy}
                className="text-xs text-amber-500 hover:text-amber-400 font-semibold flex items-center gap-1 mt-1"
              >
                + Adicionar Parcela
              </button>

              <div className="pt-3 border-t border-stone-800 space-y-1 text-sm">
                <div className="flex justify-between text-stone-400">
                  <span>Total declarado:</span>
                  <span>R$ {mixedTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Falta declarar:</span>
                  <span className={Math.abs(mixedDiff) < 0.01 ? "text-emerald-400" : "text-amber-400"}>
                    R$ {mixedDiff.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-stone-800 flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                busy ||
                (!isMixed && (amountNum <= 0 || amountNum > remainingTotal)) ||
                (isMixed && Math.abs(mixedDiff) >= 0.01)
              }
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Processando..." : "Confirmar e Finalizar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
