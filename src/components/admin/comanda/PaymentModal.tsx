"use client";

import { useState } from "react";

type Props = {
  remainingTotal: number;
  busy: boolean;
  onPay: (method: string, amount: string) => Promise<void>;
  onClose: () => void;
};

export function PaymentModal({ remainingTotal, busy, onPay, onClose }: Props) {
  const [method, setMethod] = useState("PIX");
  const [amount, setAmount] = useState(remainingTotal.toFixed(2));
  const [cashReceived, setCashReceived] = useState("");

  const amountNum = Number(amount) || 0;
  const cashReceivedNum = Number(cashReceived) || 0;
  const showChange = method === "CASH" && cashReceivedNum > amountNum && amountNum > 0;
  const change = showChange ? cashReceivedNum - amountNum : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amountNum <= 0) {
      alert("Valor deve ser maior que zero.");
      return;
    }
    if (amountNum > remainingTotal) {
      alert("Valor não pode ser maior que o saldo restante.");
      return;
    }
    if (method === "CASH" && cashReceivedNum > 0 && cashReceivedNum < amountNum) {
      alert("Valor recebido em dinheiro é menor que o valor a pagar.");
      return;
    }
    await onPay(method, amountNum.toFixed(2));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
      <div className="bg-stone-900 border border-stone-800 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-stone-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-stone-100">Registrar Pagamento</h2>
          <button onClick={onClose} disabled={busy} className="text-stone-400 hover:text-stone-200 disabled:opacity-50 text-2xl leading-none">&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Forma de Pagamento</label>
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
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
            <label className="block text-sm font-medium text-stone-300 mb-1">Valor a abater da comanda (R$)</label>
            <input
              type="number"
              step="0.01"
              max={remainingTotal}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          {method === "CASH" && (
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

          <div className="pt-4 flex gap-3 justify-end">
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
              disabled={busy || amountNum <= 0 || amountNum > remainingTotal}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Processando..." : "Confirmar Pagamento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
