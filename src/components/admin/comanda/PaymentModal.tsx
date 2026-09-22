"use client";

import { useState } from "react";

type Props = {
  remainingTotal: number;
  busy: boolean;
  canManageDebt?: boolean;
  isClosedWithDebt?: boolean;
  customerCreditBalance?: number;
  canConsumeCredit?: boolean;
  members?: { id: string; name: string }[];
  onPay: (
    payments: { method: string; amount: string }[],
    options?: {
      closeWithDebt?: boolean;
      confirmOutstandingBalance?: boolean;
      allocations?: {
        method: string;
        receivedAmount: number;
        tipAmount?: number;
        tipMemberId?: string | null;
        creditDepositAmount?: number;
      }[];
    }
  ) => Promise<void>;
  onClose: () => void;
};

interface MixedPaymentItem {
  id: string;
  method: string;
  amount: string;
  tipAmount?: string;
  tipMemberId?: string;
  creditDepositAmount?: string;
}

export function PaymentModal({
  remainingTotal,
  busy,
  canManageDebt = false,
  isClosedWithDebt = false,
  customerCreditBalance = 0,
  canConsumeCredit = true,
  members = [],
  onPay,
  onClose,
}: Props) {
  const [isMixed, setIsMixed] = useState(false);
  const [singleMethod, setSingleMethod] = useState("PIX");
  const [singleAmount, setSingleAmount] = useState(remainingTotal.toFixed(2));

  // Allocation engine extras: gorjeta e depósito em crédito
  const [tipAmount, setTipAmount] = useState("");
  const [tipMemberId, setTipMemberId] = useState(members.length === 1 ? members[0].id : "");
  const [creditDepositAmount, setCreditDepositAmount] = useState("");

  // Para pagamento misto
  const [mixedPayments, setMixedPayments] = useState<MixedPaymentItem[]>([
    { id: "1", method: "PIX", amount: "" },
  ]);

  const [cashReceived, setCashReceived] = useState("");
  const [confirmDebt, setConfirmDebt] = useState(false);

  const amountNum = Number(singleAmount) || 0;
  const tipAmountNum = singleMethod === "CUSTOMER_CREDIT" ? 0 : (Number(tipAmount) || 0);
  const creditDepositNum = singleMethod === "CUSTOMER_CREDIT" ? 0 : (Number(creditDepositAmount) || 0);
  const cashReceivedNum = Number(cashReceived) || 0;

  const totalAllocatedNoChange = amountNum + tipAmountNum + creditDepositNum;
  const effectiveReceived = singleMethod === "CASH" && cashReceivedNum > totalAllocatedNoChange
    ? cashReceivedNum
    : totalAllocatedNoChange;

  const showChange = !isMixed && singleMethod === "CASH" && cashReceivedNum > totalAllocatedNoChange && totalAllocatedNoChange >= 0;
  const change = showChange ? cashReceivedNum - totalAllocatedNoChange : 0;

  // Calculos para pagamento misto/único
  const mixedTotal = mixedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const mixedCreditTotal = mixedPayments
    .filter((p) => p.method === "CUSTOMER_CREDIT")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const appliedTotal = isMixed ? mixedTotal : amountNum;
  const outstanding = Math.max(0, remainingTotal - appliedTotal);
  const isPartialOrZero = outstanding > 0.009;

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

    if (tipAmountNum > 0 && !tipMemberId && members.length > 0) {
      alert("Selecione o profissional que receberá a gorjeta.");
      return;
    }

    if (isClosedWithDebt) {
      // Receber dívida de comanda já fechada
      if (appliedTotal <= 0) {
        alert("Informe um valor maior que zero para pagamento de dívida.");
        return;
      }
      if (appliedTotal > remainingTotal + 0.009) {
        alert("O pagamento excede o saldo restante em aberto.");
        return;
      }
      let payload: { method: string; amount: string }[];
      if (!isMixed) {
        if (singleMethod === "CASH" && cashReceivedNum > 0 && cashReceivedNum < totalAllocatedNoChange) {
          alert("Valor recebido em dinheiro é menor que a soma de venda, gorjeta e depósito.");
          return;
        }
        if (singleMethod === "CUSTOMER_CREDIT" && amountNum > customerCreditBalance + 0.009) {
          alert(`O valor (R$ ${amountNum.toFixed(2)}) excede o saldo de crédito disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
          return;
        }
        payload = [{ method: singleMethod, amount: amountNum.toFixed(2) }];
      } else {
        if (mixedPayments.some((p) => (Number(p.amount) || 0) <= 0)) {
          alert("Cada parcela deve ter um valor maior que zero.");
          return;
        }
        if (mixedCreditTotal > customerCreditBalance + 0.009) {
          alert(`O total pago em crédito do cliente (R$ ${mixedCreditTotal.toFixed(2)}) excede o saldo disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
          return;
        }
        payload = mixedPayments.map((p) => ({
          method: p.method,
          amount: (Number(p.amount) || 0).toFixed(2),
        }));
      }

      const allocations = !isMixed && (tipAmountNum > 0 || creditDepositNum > 0) ? [
        {
          method: singleMethod,
          receivedAmount: effectiveReceived,
          tipAmount: tipAmountNum > 0 ? tipAmountNum : undefined,
          tipMemberId: tipAmountNum > 0 ? (tipMemberId || null) : undefined,
          creditDepositAmount: creditDepositNum > 0 ? creditDepositNum : undefined,
        }
      ] : undefined;

      await onPay(payload, { closeWithDebt: true, confirmOutstandingBalance: true, allocations });
      return;
    }

    // Finalizar comanda aberta
    if (!isMixed) {
      if (amountNum < 0) {
        alert("Valor não pode ser negativo.");
        return;
      }
      if (amountNum > remainingTotal + 0.009) {
        alert("Valor não pode ser maior que o saldo restante.");
        return;
      }
      if (singleMethod === "CASH" && cashReceivedNum > 0 && cashReceivedNum < totalAllocatedNoChange) {
        alert("Valor recebido em dinheiro é menor que a soma de venda, gorjeta e depósito.");
        return;
      }
      if (singleMethod === "CUSTOMER_CREDIT" && amountNum > customerCreditBalance + 0.009) {
        alert(`O valor (R$ ${amountNum.toFixed(2)}) excede o saldo de crédito disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
        return;
      }
      if (isPartialOrZero && !canManageDebt) {
        alert("Apenas gerentes e proprietários podem finalizar comanda com saldo em aberto.");
        return;
      }
      if (isPartialOrZero && !confirmDebt) {
        alert(`É necessário confirmar que o cliente ficará com R$ ${outstanding.toFixed(2)} em aberto.`);
        return;
      }

      const payload = amountNum > 0 ? [{ method: singleMethod, amount: amountNum.toFixed(2) }] : [];
      const allocations = (tipAmountNum > 0 || creditDepositNum > 0) ? [
        {
          method: singleMethod,
          receivedAmount: effectiveReceived,
          tipAmount: tipAmountNum > 0 ? tipAmountNum : undefined,
          tipMemberId: tipAmountNum > 0 ? (tipMemberId || null) : undefined,
          creditDepositAmount: creditDepositNum > 0 ? creditDepositNum : undefined,
        }
      ] : undefined;

      await onPay(payload, {
        closeWithDebt: isPartialOrZero,
        confirmOutstandingBalance: isPartialOrZero,
        allocations,
      });
    } else {
      if (mixedPayments.some((p) => (Number(p.amount) || 0) <= 0)) {
        alert("Cada parcela deve ter um valor maior que zero.");
        return;
      }
      if (appliedTotal > remainingTotal + 0.009) {
        alert(`A soma das parcelas (R$ ${mixedTotal.toFixed(2)}) excede o total restante (R$ ${remainingTotal.toFixed(2)}).`);
        return;
      }
      if (mixedCreditTotal > customerCreditBalance + 0.009) {
        alert(`O total pago em crédito do cliente (R$ ${mixedCreditTotal.toFixed(2)}) excede o saldo disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
        return;
      }
      if (isPartialOrZero && !canManageDebt) {
        alert(`A soma das parcelas (R$ ${mixedTotal.toFixed(2)}) deve ser exatamente igual ao total restante (R$ ${remainingTotal.toFixed(2)}).`);
        return;
      }
      if (isPartialOrZero && !confirmDebt) {
        alert(`É necessário confirmar que o cliente ficará com R$ ${outstanding.toFixed(2)} em aberto.`);
        return;
      }

      const payload = mixedPayments.map((p) => ({
        method: p.method,
        amount: (Number(p.amount) || 0).toFixed(2),
      }));

      const allocations = mixedPayments.some((p) => (Number(p.tipAmount) || 0) > 0 || (Number(p.creditDepositAmount) || 0) > 0)
        ? mixedPayments.map((p) => {
            const r = Number(p.amount) || 0;
            const t = Number(p.tipAmount) || 0;
            const c = Number(p.creditDepositAmount) || 0;
            return {
              method: p.method,
              receivedAmount: r + t + c,
              tipAmount: t > 0 ? t : undefined,
              tipMemberId: t > 0 ? (p.tipMemberId || tipMemberId || null) : undefined,
              creditDepositAmount: c > 0 ? c : undefined,
            };
          })
        : undefined;

      await onPay(payload, {
        closeWithDebt: isPartialOrZero,
        confirmOutstandingBalance: isPartialOrZero,
        allocations,
      });
    }
  }

  function getButtonText() {
    if (busy) return "Processando...";
    if (isClosedWithDebt) return "Confirmar Recebimento";
    if (!isPartialOrZero) return "Confirmar e Finalizar";
    if (appliedTotal === 0) return "Finalizar sem receber agora";
    return `Finalizar com R$ ${outstanding.toFixed(2)} em aberto`;
  }

  const isCreditInvalid =
    (!isMixed && singleMethod === "CUSTOMER_CREDIT" && (amountNum > customerCreditBalance + 0.009 || !canConsumeCredit)) ||
    (isMixed && mixedCreditTotal > customerCreditBalance + 0.009);

  const isSubmitDisabled =
    busy ||
    isCreditInvalid ||
    (!isClosedWithDebt && isPartialOrZero && (!canManageDebt || !confirmDebt)) ||
    (!isMixed && amountNum < 0) ||
    (!isMixed && amountNum > remainingTotal + 0.009) ||
    (isMixed && mixedTotal > remainingTotal + 0.009) ||
    (isClosedWithDebt && appliedTotal <= 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] flex justify-between items-center">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {isClosedWithDebt ? "Receber Saldo em Aberto" : "Finalizar Atendimento - Receber"}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 text-2xl leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex justify-between items-center bg-[var(--surface-raised)] p-3 rounded-lg border border-[var(--border-subtle)]">
            <span className="text-sm text-[var(--text-secondary)]">
              {isClosedWithDebt ? "Saldo em Aberto" : "Total a Pagar"}
            </span>
            <span className="text-xl font-bold text-[var(--gold)] font-serif">
              R$ {remainingTotal.toFixed(2)}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Tipo de Pagamento
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsMixed(false)}
                className={`py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  !isMixed
                    ? "bg-[var(--gold)] text-[var(--text-inverse)] font-bold"
                    : "bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                Pagamento Único
              </button>
              <button
                type="button"
                onClick={() => setIsMixed(true)}
                className={`py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  isMixed
                    ? "bg-[var(--gold)] text-[var(--text-inverse)] font-bold"
                    : "bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
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
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Forma de Pagamento
                </label>
                <select
                  value={singleMethod}
                  onChange={(e) => {
                    setSingleMethod(e.target.value);
                    setCashReceived("");
                  }}
                  disabled={busy}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="PIX">Pix</option>
                  <option value="CREDIT">Cartão de Crédito</option>
                  {canConsumeCredit && customerCreditBalance > 0 && (
                    <option value="CUSTOMER_CREDIT">Crédito do Cliente (R$ {customerCreditBalance.toFixed(2)})</option>
                  )}
                  <option value="DEBIT">Cartão de Débito</option>
                  <option value="CASH">Dinheiro</option>
                  <option value="OTHER">Outros</option>
                </select>
                {singleMethod === "CUSTOMER_CREDIT" && (
                  <div className="text-xs mt-1 text-amber-400 font-medium">
                    Saldo de crédito disponível: R$ {customerCreditBalance.toFixed(2)}
                    {!canConsumeCredit && (
                      <span className="text-[var(--danger)] block">Sem permissão para consumir crédito.</span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Valor Aplicado à Venda (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={remainingTotal}
                  value={singleAmount}
                  onChange={(e) => setSingleAmount(e.target.value)}
                  disabled={busy}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
              </div>

              {singleMethod !== "CUSTOMER_CREDIT" ? (
                <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                        Gorjeta (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={tipAmount}
                        onChange={(e) => setTipAmount(e.target.value)}
                        disabled={busy}
                        className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                      />
                    </div>
                    {tipAmountNum > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                          Profissional Favorecido <span className="text-[var(--danger)]">*</span>
                        </label>
                        <select
                          value={tipMemberId}
                          onChange={(e) => setTipMemberId(e.target.value)}
                          disabled={busy}
                          required
                          className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                        >
                          <option value="">Selecione...</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Adicionar ao Crédito do Cliente (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={creditDepositAmount}
                      onChange={(e) => setCreditDepositAmount(e.target.value)}
                      disabled={busy}
                      className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                    />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] p-2 rounded border border-[var(--border-subtle)]">
                  ℹ️ Pagamento via Crédito do Cliente é restrito à quitação da venda. Não permite gorjeta, depósito ou troco.
                </div>
              )}

              {singleMethod === "CASH" && (
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Valor recebido do cliente (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    disabled={busy}
                    placeholder="Ex: 50.00"
                    className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                  />
                  {showChange && (
                    <p className="mt-2 text-sm text-[var(--gold)] font-serif font-medium">
                      Troco a devolver: R$ {change.toFixed(2)}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Formulario Pagamento Misto
            <div className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-[var(--text-secondary)]">
                Parcelas declaradas
              </label>

              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {mixedPayments.map((p) => (
                  <div key={p.id} className="flex gap-2 items-center">
                    <select
                      value={p.method}
                      onChange={(e) => updateMixedRow(p.id, "method", e.target.value)}
                      disabled={busy}
                      className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] focus:outline-none text-sm w-1/2"
                    >
                      <option value="PIX">Pix</option>
                      <option value="CREDIT">Cartão de Crédito</option>
                      {canConsumeCredit && customerCreditBalance > 0 && (
                        <option value="CUSTOMER_CREDIT">Crédito do Cliente</option>
                      )}
                      <option value="DEBIT">Cartão de Débito</option>
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
                      className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] focus:outline-none text-sm w-1/3"
                    />

                    <button
                      type="button"
                      onClick={() => removeMixedRow(p.id)}
                      disabled={busy || mixedPayments.length === 1}
                      className="p-1.5 text-[var(--danger)] hover:text-red-400 disabled:opacity-30 hover:bg-[var(--surface-hover)] rounded-lg transition-colors cursor-pointer"
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
                className="text-xs text-[var(--gold)] hover:text-[var(--gold-light)] font-semibold flex items-center gap-1 mt-1 cursor-pointer transition-colors"
              >
                + Adicionar Parcela
              </button>
            </div>
          )}

          {/* Allocation Engine Summary Card */}
          <div className="p-3 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg space-y-1.5 text-xs">
            <div className="font-bold text-[var(--gold)] uppercase tracking-wider mb-1">Resumo de Alocação do Checkout</div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>Saldo da venda:</span>
              <span>R$ {remainingTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[var(--text-primary)]">
              <span>Aplicado à venda:</span>
              <span>R$ {appliedTotal.toFixed(2)}</span>
            </div>
            {tipAmountNum > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Gorjeta:</span>
                <span>R$ {tipAmountNum.toFixed(2)}</span>
              </div>
            )}
            {creditDepositNum > 0 && (
              <div className="flex justify-between text-blue-400">
                <span>Crédito gerado:</span>
                <span>R$ {creditDepositNum.toFixed(2)}</span>
              </div>
            )}
            {showChange && change > 0 && (
              <div className="flex justify-between text-amber-300 font-medium">
                <span>Troco (dinheiro):</span>
                <span>R$ {change.toFixed(2)}</span>
              </div>
            )}
            {outstanding > 0.009 && (
              <div className="flex justify-between text-[var(--danger)] font-semibold pt-1 border-t border-[var(--border-subtle)]">
                <span>Saldo em aberto:</span>
                <span>R$ {outstanding.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Seção de Saldo em Aberto / Confirmação */}
          {!isClosedWithDebt && isPartialOrZero && (
            <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3 bg-[var(--surface-raised)] p-3 rounded-lg">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>Total da Comanda:</span>
                  <span>R$ {remainingTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>Recebido Agora:</span>
                  <span>R$ {appliedTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-amber-400">
                  <span>Ficará em Aberto:</span>
                  <span>R$ {outstanding.toFixed(2)}</span>
                </div>
              </div>

              {canManageDebt ? (
                <label className="flex items-start gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmDebt}
                    onChange={(e) => setConfirmDebt(e.target.checked)}
                    disabled={busy}
                    className="mt-0.5 rounded border-[var(--border-subtle)] text-[var(--gold)] focus:ring-[var(--gold)]"
                  />
                  <span>
                    Confirmo que o cliente ficará com R$ {outstanding.toFixed(2)} em aberto.
                  </span>
                </label>
              ) : (
                <p className="text-xs text-[var(--danger)] pt-2 border-t border-[var(--border-subtle)] font-medium">
                  Apenas gerentes e proprietários podem finalizar comandas com saldo em aberto.
                </p>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-[var(--border-subtle)] flex gap-3 justify-end bg-[var(--surface-raised)] -mx-5 -mb-5 p-5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 cursor-pointer transition-colors text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm"
            >
              {getButtonText()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

