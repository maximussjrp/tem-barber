"use client";

import { useState, useEffect, useRef } from "react";

type Props = {
  remainingTotal: number;
  busy: boolean;
  canManageDebt?: boolean;
  isClosedWithDebt?: boolean;
  customerCreditBalance?: number;
  canConsumeCredit?: boolean;
  members?: { id: string; name: string }[];
  error?: string | null;
  onClearError?: () => void;
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
  amount: string; // saleAmount
  receivedAmount?: string; // para CASH
  tipAmount?: string;
  tipMemberId?: string;
  creditDepositAmount?: string;
}

function hasValidDecimalPlaces(val: string): boolean {
  if (!val || val.trim() === "") return true;
  const parts = val.trim().split(".");
  return parts.length <= 2 && (parts.length === 1 || parts[1].length <= 2);
}

function isValidCurrency(val: string): boolean {
  if (!val || val.trim() === "") return false;
  const n = Number(val);
  if (isNaN(n) || !isFinite(n)) return false;
  return hasValidDecimalPlaces(val);
}

export function PaymentModal({
  remainingTotal,
  busy,
  canManageDebt = false,
  isClosedWithDebt = false,
  customerCreditBalance = 0,
  canConsumeCredit = true,
  members = [],
  error,
  onClearError,
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
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Erros contextuais locais
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  const continueEditBtnRef = useRef<HTMLButtonElement>(null);
  const discardBtnRef = useRef<HTMLButtonElement>(null);
  const lastActiveBeforeDiscardRef = useRef<HTMLElement | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const prevErrorRef = useRef<string | null>(null);

  // Abertura nativa via showModal(), fundo inerte e foco inicial intencional (UX1-REV-001 / BLOQUEADOR D)
  useEffect(() => {
    triggerElementRef.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialogNode = dialogRef.current;
    if (dialogNode && !dialogNode.open) {
      if (typeof dialogNode.showModal === "function") {
        try {
          dialogNode.showModal();
        } catch (err) {
          console.error("Erro ao abrir diálogo modal nativo:", err);
        }
      } else {
        console.warn("Elemento <dialog> sem suporte nativo a showModal.");
      }
    }

    const timer = setTimeout(() => {
      const initialInput = dialogNode?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), button:not([disabled])'
      );
      if (initialInput) {
        initialInput.focus();
      } else {
        modalRef.current?.focus();
      }
    }, 50);

    return () => {
      document.body.style.overflow = originalOverflow;
      clearTimeout(timer);
      if (dialogNode && typeof dialogNode.close === "function" && dialogNode.open) {
        dialogNode.close();
      }
      if (triggerElementRef.current && typeof triggerElementRef.current.focus === "function") {
        triggerElementRef.current.focus();
      }
    };
  }, []);

  // Gerenciamento modal estrito da confirmação de descarte (BLOQUEADOR B)
  useEffect(() => {
    const discardDialog = discardDialogRef.current;
    if (showDiscardConfirm) {
      lastActiveBeforeDiscardRef.current = document.activeElement as HTMLElement | null;
      if (discardDialog && typeof discardDialog.showModal === "function" && !discardDialog.open) {
        try {
          discardDialog.showModal();
        } catch {
          // Já em top layer
        }
      }
      const t = setTimeout(() => {
        continueEditBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    } else {
      if (discardDialog && typeof discardDialog.close === "function" && discardDialog.open) {
        discardDialog.close();
      }
      if (lastActiveBeforeDiscardRef.current && typeof lastActiveBeforeDiscardRef.current.focus === "function") {
        lastActiveBeforeDiscardRef.current.focus();
      }
    }
  }, [showDiscardConfirm]);

  // Reposicionamento e visibilidade de erros de API sem rolar o fundo (UX1-REV-004)
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
      setTimeout(() => {
        errorBannerRef.current?.focus();
      }, 50);
    } else if (!error) {
      prevErrorRef.current = null;
    }
  }, [error]);

  // Cálculo de modificações não salvas (UX1-REV-002)
  const isDirty =
    isMixed ||
    singleMethod !== "PIX" ||
    (singleAmount !== "" && Number(singleAmount) !== remainingTotal) ||
    tipAmount !== "" ||
    tipMemberId !== (members.length === 1 ? members[0].id : "") ||
    creditDepositAmount !== "" ||
    cashReceived !== "" ||
    confirmDebt ||
    (isMixed && (
      mixedPayments.length > 1 ||
      mixedPayments.some((p) => p.amount !== "" || p.method !== "PIX" || p.tipAmount || p.creditDepositAmount)
    ));

  function handleAttemptClose() {
    if (busy) return;
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    executeClose();
  }

  function handleCancelDiscard() {
    setShowDiscardConfirm(false);
  }

  function executeClose() {
    setShowDiscardConfirm(false);
    setValidationError(null);
    setInvalidField(null);
    if (onClearError) onClearError();
    if (dialogRef.current && typeof dialogRef.current.close === "function" && dialogRef.current.open) {
      dialogRef.current.close();
    }
    onClose();
  }

  function clearErrors() {
    if (validationError) setValidationError(null);
    if (invalidField) setInvalidField(null);
    if (error && onClearError) onClearError();
  }

  function triggerError(msg: string, fieldId?: string) {
    setValidationError(msg);
    setInvalidField(fieldId || null);
    if (onClearError) onClearError();
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setTimeout(() => {
      if (fieldId) {
        const el = document.getElementById(fieldId);
        if (el) {
          el.focus();
          return;
        }
      }
      errorBannerRef.current?.focus();
    }, 50);
  }

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

  // Calculos para pagamento misto
  const mixedTotal = mixedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const mixedCreditTotal = mixedPayments
    .filter((p) => p.method === "CUSTOMER_CREDIT")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const mixedTipsTotal = mixedPayments.reduce((sum, p) => {
    return sum + (p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.tipAmount) || 0));
  }, 0);

  const mixedCreditDepositTotal = mixedPayments.reduce((sum, p) => {
    return sum + (p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.creditDepositAmount) || 0));
  }, 0);

  const mixedChangeTotal = mixedPayments.reduce((sum, p) => {
    if (p.method !== "CASH") return sum;
    const sale = Number(p.amount) || 0;
    const tip = Number(p.tipAmount) || 0;
    const deposit = Number(p.creditDepositAmount) || 0;
    const base = sale + tip + deposit;
    const received = Number(p.receivedAmount) || 0;
    return sum + (received > base ? received - base : 0);
  }, 0);

  const appliedTotal = isMixed ? mixedTotal : amountNum;
  const outstanding = Math.max(0, remainingTotal - appliedTotal);
  const isPartialOrZero = outstanding > 0.009;

  function addMixedRow() {
    clearErrors();
    setMixedPayments([
      ...mixedPayments,
      { id: crypto.randomUUID(), method: "PIX", amount: "" },
    ]);
  }

  function removeMixedRow(id: string) {
    if (mixedPayments.length === 1) return;
    clearErrors();
    setMixedPayments(mixedPayments.filter((p) => p.id !== id));
  }

  function updateMixedRow(id: string, field: keyof Omit<MixedPaymentItem, "id">, value: string) {
    clearErrors();
    setMixedPayments(
      mixedPayments.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, [field]: value };
        if (field === "method" && value === "CUSTOMER_CREDIT") {
          updated.tipAmount = "";
          updated.tipMemberId = "";
          updated.creditDepositAmount = "";
          updated.receivedAmount = "";
        }
        return updated;
      })
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Bloqueia qualquer submissão caso a confirmação de descarte esteja aberta (BLOQUEADOR B)
    if (showDiscardConfirm) {
      return;
    }
    clearErrors();

    // 1. Validações contextuais de extras do Pagamento Único (somente quando ativo e não for crédito)
    if (!isMixed && singleMethod !== "CUSTOMER_CREDIT") {
      if (tipAmount.trim() !== "") {
        if (!isValidCurrency(tipAmount)) {
          triggerError("Valor de gorjeta inválido. Utilize até 2 casas decimais.", "tip-amount-input");
          return;
        }
        if (tipAmountNum < 0) {
          triggerError("Valor de gorjeta não pode ser negativo.", "tip-amount-input");
          return;
        }
      }

      if (tipAmountNum > 0 && !tipMemberId && members.length > 0) {
        triggerError("Selecione o profissional que receberá a gorjeta.", "tip-member-select");
        return;
      }

      if (creditDepositAmount.trim() !== "") {
        if (!isValidCurrency(creditDepositAmount)) {
          triggerError("Valor de depósito em crédito inválido. Utilize até 2 casas decimais.", "credit-deposit-input");
          return;
        }
        if (creditDepositNum < 0) {
          triggerError("Valor de depósito em crédito não pode ser negativo.", "credit-deposit-input");
          return;
        }
      }

      if (singleMethod === "CASH" && cashReceived.trim() !== "") {
        if (!isValidCurrency(cashReceived)) {
          triggerError("Valor recebido em dinheiro inválido. Utilize até 2 casas decimais.", "cash-received-input");
          return;
        }
        if (cashReceivedNum < 0) {
          triggerError("Valor recebido em dinheiro não pode ser negativo.", "cash-received-input");
          return;
        }
      }
    }

    if (isClosedWithDebt) {
      // Receber dívida de comanda já fechada
      if (appliedTotal <= 0) {
        triggerError("Informe um valor maior que zero para pagamento de dívida.", isMixed ? `mixed-amount-${mixedPayments[0]?.id}` : "single-amount-input");
        return;
      }
      if (appliedTotal > remainingTotal + 0.009) {
        triggerError("O pagamento excede o saldo restante em aberto.", isMixed ? `mixed-amount-${mixedPayments[0]?.id}` : "single-amount-input");
        return;
      }

      if (!isMixed) {
        if (singleAmount.trim() === "") {
          triggerError("Informe o valor a pagar.", "single-amount-input");
          return;
        }
        if (!isValidCurrency(singleAmount)) {
          triggerError("Informe um valor válido com até 2 casas decimais.", "single-amount-input");
          return;
        }
        if (amountNum <= 0) {
          triggerError("Informe um valor maior que zero para pagamento de dívida.", "single-amount-input");
          return;
        }
        if (singleMethod === "CASH" && cashReceivedNum > 0 && cashReceivedNum < totalAllocatedNoChange) {
          triggerError("Valor recebido em dinheiro é menor que a soma de venda, gorjeta e depósito.", "cash-received-input");
          return;
        }
        if (singleMethod === "CUSTOMER_CREDIT") {
          if (!canConsumeCredit) {
            triggerError("Cliente não tem permissão para utilizar saldo de crédito.", "single-method-select");
            return;
          }
          if (amountNum > customerCreditBalance + 0.009) {
            triggerError(`O valor (R$ ${amountNum.toFixed(2)}) excede o saldo de crédito disponível (R$ ${customerCreditBalance.toFixed(2)}).`, "single-amount-input");
            return;
          }
        }
        const payload = [{ method: singleMethod, amount: amountNum.toFixed(2) }];
        const allocations = (tipAmountNum > 0 || creditDepositNum > 0 || (singleMethod === "CASH" && change > 0)) ? [
          {
            method: singleMethod,
            receivedAmount: effectiveReceived,
            tipAmount: tipAmountNum > 0 ? tipAmountNum : undefined,
            tipMemberId: tipAmountNum > 0 ? (tipMemberId || null) : undefined,
            creditDepositAmount: creditDepositNum > 0 ? creditDepositNum : undefined,
          }
        ] : undefined;

        try {
          await onPay(payload, { closeWithDebt: true, confirmOutstandingBalance: true, allocations });
        } catch (err) {
          triggerError(err instanceof Error ? err.message : "Erro ao processar pagamento.");
        }
        return;
      } else {
        if (mixedPayments.length === 0) {
          triggerError("Adicione ao menos um meio de pagamento.");
          return;
        }
        for (let i = 0; i < mixedPayments.length; i++) {
          const p = mixedPayments[i];
          if (!p.amount || p.amount.trim() === "") {
            triggerError(`Informe o valor de venda na parcela #${i + 1}.`, `mixed-amount-${p.id}`);
            return;
          }
          if (!isValidCurrency(p.amount)) {
            triggerError(`Valor de venda inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-amount-${p.id}`);
            return;
          }
          if ((Number(p.amount) || 0) <= 0) {
            triggerError("Cada parcela deve ter um valor maior que zero.", `mixed-amount-${p.id}`);
            return;
          }
          if (p.method === "CUSTOMER_CREDIT" && !canConsumeCredit) {
            triggerError(`Cliente não tem permissão para utilizar saldo de crédito na parcela #${i + 1}.`, `mixed-method-${p.id}`);
            return;
          }
          const tipNum = Number(p.tipAmount) || 0;
          if (p.tipAmount && p.tipAmount.trim() !== "") {
            if (!isValidCurrency(p.tipAmount)) {
              triggerError(`Valor de gorjeta inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-tip-${p.id}`);
              return;
            }
            if (tipNum < 0) {
              triggerError(`Valor de gorjeta não pode ser negativo na parcela #${i + 1}.`, `mixed-tip-${p.id}`);
              return;
            }
          }
          if (p.method !== "CUSTOMER_CREDIT" && tipNum > 0 && !p.tipMemberId && !tipMemberId && members.length > 0) {
            triggerError(`Selecione o profissional que receberá a gorjeta na parcela #${i + 1}.`, `mixed-tip-member-${p.id}`);
            return;
          }
          if (p.creditDepositAmount && p.creditDepositAmount.trim() !== "") {
            if (!isValidCurrency(p.creditDepositAmount)) {
              triggerError(`Valor de depósito em crédito inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-credit-deposit-${p.id}`);
              return;
            }
            if ((Number(p.creditDepositAmount) || 0) < 0) {
              triggerError(`Valor de depósito em crédito não pode ser negativo na parcela #${i + 1}.`, `mixed-credit-deposit-${p.id}`);
              return;
            }
          }
          if (p.method === "CASH") {
            const sale = Number(p.amount) || 0;
            const tip = Number(p.tipAmount) || 0;
            const deposit = Number(p.creditDepositAmount) || 0;
            const base = sale + tip + deposit;
            if (p.receivedAmount && p.receivedAmount.trim() !== "") {
              if (!isValidCurrency(p.receivedAmount)) {
                triggerError(`Valor recebido em dinheiro inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-cash-${p.id}`);
                return;
              }
              if ((Number(p.receivedAmount) || 0) < 0) {
                triggerError(`Valor recebido em dinheiro não pode ser negativo na parcela #${i + 1}.`, `mixed-cash-${p.id}`);
                return;
              }
            }
            const received = Number(p.receivedAmount) || 0;
            if (received > 0 && received < base) {
              triggerError(`Valor recebido em dinheiro na parcela #${i + 1} é menor que a soma de venda, gorjeta e depósito.`, `mixed-cash-${p.id}`);
              return;
            }
          }
        }
        if (mixedCreditTotal > customerCreditBalance + 0.009) {
          triggerError(`O total pago em crédito do cliente (R$ ${mixedCreditTotal.toFixed(2)}) excede o saldo disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
          return;
        }

        const payload = mixedPayments.map((p) => ({
          method: p.method,
          amount: (Number(p.amount) || 0).toFixed(2),
        }));

        const allocations = mixedPayments.map((p) => {
          const sale = Number(p.amount) || 0;
          const tip = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.tipAmount) || 0);
          const credit = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.creditDepositAmount) || 0);
          const base = sale + tip + credit;
          let received = base;
          if (p.method === "CASH") {
            const typedCash = Number(p.receivedAmount) || 0;
            if (typedCash > base) {
              received = typedCash;
            }
          }
          return {
            method: p.method,
            receivedAmount: received,
            tipAmount: tip > 0 ? tip : undefined,
            tipMemberId: tip > 0 ? (p.tipMemberId || tipMemberId || null) : undefined,
            creditDepositAmount: credit > 0 ? credit : undefined,
          };
        });

        try {
          await onPay(payload, { closeWithDebt: true, confirmOutstandingBalance: true, allocations });
        } catch (err) {
          triggerError(err instanceof Error ? err.message : "Erro ao processar pagamento.");
        }
        return;
      }
    }

    // Finalizar comanda aberta
    if (!isMixed) {
      if (singleAmount.trim() === "") {
        triggerError("Informe o valor a pagar.", "single-amount-input");
        return;
      }
      if (!isValidCurrency(singleAmount)) {
        triggerError("Informe um valor válido com até 2 casas decimais.", "single-amount-input");
        return;
      }
      if (amountNum < 0) {
        triggerError("Valor não pode ser negativo.", "single-amount-input");
        return;
      }
      if (amountNum > remainingTotal + 0.009) {
        triggerError("Valor não pode ser maior que o saldo restante.", "single-amount-input");
        return;
      }
      if (singleMethod === "CASH" && cashReceivedNum > 0 && cashReceivedNum < totalAllocatedNoChange) {
        triggerError("Valor recebido em dinheiro é menor que a soma de venda, gorjeta e depósito.", "cash-received-input");
        return;
      }
      if (singleMethod === "CUSTOMER_CREDIT") {
        if (!canConsumeCredit) {
          triggerError("Cliente não tem permissão para utilizar saldo de crédito.", "single-method-select");
          return;
        }
        if (amountNum > customerCreditBalance + 0.009) {
          triggerError(`O valor (R$ ${amountNum.toFixed(2)}) excede o saldo de crédito disponível (R$ ${customerCreditBalance.toFixed(2)}).`, "single-amount-input");
          return;
        }
      }
      if (isPartialOrZero && !canManageDebt) {
        triggerError("Apenas gerentes e proprietários podem finalizar comanda com saldo em aberto.");
        return;
      }
      if (isPartialOrZero && !confirmDebt) {
        triggerError(`É necessário confirmar que o cliente ficará com R$ ${outstanding.toFixed(2)} em aberto.`, "confirm-debt-checkbox");
        return;
      }

      const payload = amountNum > 0 ? [{ method: singleMethod, amount: amountNum.toFixed(2) }] : [];
      const allocations = (tipAmountNum > 0 || creditDepositNum > 0 || (singleMethod === "CASH" && change > 0)) ? [
        {
          method: singleMethod,
          receivedAmount: effectiveReceived,
          tipAmount: tipAmountNum > 0 ? tipAmountNum : undefined,
          tipMemberId: tipAmountNum > 0 ? (tipMemberId || null) : undefined,
          creditDepositAmount: creditDepositNum > 0 ? creditDepositNum : undefined,
        }
      ] : undefined;

      try {
        await onPay(payload, {
          closeWithDebt: isPartialOrZero,
          confirmOutstandingBalance: isPartialOrZero,
          allocations,
        });
      } catch (err) {
        triggerError(err instanceof Error ? err.message : "Erro ao finalizar atendimento.");
      }
    } else {
      if (mixedPayments.length === 0) {
        triggerError("Adicione ao menos um meio de pagamento.");
        return;
      }
      for (let i = 0; i < mixedPayments.length; i++) {
        const p = mixedPayments[i];
        if (!p.amount || p.amount.trim() === "") {
          triggerError(`Informe o valor de venda na parcela #${i + 1}.`, `mixed-amount-${p.id}`);
          return;
        }
        if (!isValidCurrency(p.amount)) {
          triggerError(`Valor de venda inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-amount-${p.id}`);
          return;
        }
        if ((Number(p.amount) || 0) <= 0) {
          triggerError("Cada parcela deve ter um valor de venda maior que zero.", `mixed-amount-${p.id}`);
          return;
        }
        if (p.method === "CUSTOMER_CREDIT" && !canConsumeCredit) {
          triggerError(`Cliente não tem permissão para utilizar saldo de crédito na parcela #${i + 1}.`, `mixed-method-${p.id}`);
          return;
        }
        const tipNum = Number(p.tipAmount) || 0;
        if (p.tipAmount && p.tipAmount.trim() !== "") {
          if (!isValidCurrency(p.tipAmount)) {
            triggerError(`Valor de gorjeta inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-tip-${p.id}`);
            return;
          }
          if (tipNum < 0) {
            triggerError(`Valor de gorjeta não pode ser negativo na parcela #${i + 1}.`, `mixed-tip-${p.id}`);
            return;
          }
        }
        if (p.method !== "CUSTOMER_CREDIT" && tipNum > 0 && !p.tipMemberId && !tipMemberId && members.length > 0) {
          triggerError(`Selecione o profissional que receberá a gorjeta na parcela #${i + 1}.`, `mixed-tip-member-${p.id}`);
          return;
        }
        if (p.creditDepositAmount && p.creditDepositAmount.trim() !== "") {
          if (!isValidCurrency(p.creditDepositAmount)) {
            triggerError(`Valor de depósito em crédito inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-credit-deposit-${p.id}`);
            return;
          }
          if ((Number(p.creditDepositAmount) || 0) < 0) {
            triggerError(`Valor de depósito em crédito não pode ser negativo na parcela #${i + 1}.`, `mixed-credit-deposit-${p.id}`);
            return;
          }
        }
        if (p.method === "CASH") {
          const sale = Number(p.amount) || 0;
          const tip = Number(p.tipAmount) || 0;
          const deposit = Number(p.creditDepositAmount) || 0;
          const base = sale + tip + deposit;
          if (p.receivedAmount && p.receivedAmount.trim() !== "") {
            if (!isValidCurrency(p.receivedAmount)) {
              triggerError(`Valor recebido em dinheiro inválido na parcela #${i + 1}. Utilize até 2 casas decimais.`, `mixed-cash-${p.id}`);
              return;
            }
            if ((Number(p.receivedAmount) || 0) < 0) {
              triggerError(`Valor recebido em dinheiro não pode ser negativo na parcela #${i + 1}.`, `mixed-cash-${p.id}`);
              return;
            }
          }
          const received = Number(p.receivedAmount) || 0;
          if (received > 0 && received < base) {
            triggerError(`Valor recebido em dinheiro na parcela #${i + 1} é menor que a soma de venda, gorjeta e depósito.`, `mixed-cash-${p.id}`);
            return;
          }
        }
      }
      if (appliedTotal > remainingTotal + 0.009) {
        triggerError(`A soma das parcelas (R$ ${mixedTotal.toFixed(2)}) excede o total restante (R$ ${remainingTotal.toFixed(2)}).`);
        return;
      }
      if (mixedCreditTotal > customerCreditBalance + 0.009) {
        triggerError(`O total pago em crédito do cliente (R$ ${mixedCreditTotal.toFixed(2)}) excede o saldo disponível (R$ ${customerCreditBalance.toFixed(2)}).`);
        return;
      }
      if (isPartialOrZero && !canManageDebt) {
        triggerError("Apenas gerentes e proprietários podem finalizar comanda com saldo em aberto.");
        return;
      }
      if (isPartialOrZero && !confirmDebt) {
        triggerError(`É necessário confirmar que o cliente ficará com R$ ${outstanding.toFixed(2)} em aberto.`, "confirm-debt-checkbox");
        return;
      }

      const payload = mixedPayments.map((p) => ({
        method: p.method,
        amount: (Number(p.amount) || 0).toFixed(2),
      }));

      const allocations = mixedPayments.map((p) => {
        const sale = Number(p.amount) || 0;
        const tip = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.tipAmount) || 0);
        const credit = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.creditDepositAmount) || 0);
        const base = sale + tip + credit;
        let received = base;
        if (p.method === "CASH") {
          const typedCash = Number(p.receivedAmount) || 0;
          if (typedCash > base) {
            received = typedCash;
          }
        }
        return {
          method: p.method,
          receivedAmount: received,
          tipAmount: tip > 0 ? tip : undefined,
          tipMemberId: tip > 0 ? (p.tipMemberId || tipMemberId || null) : undefined,
          creditDepositAmount: credit > 0 ? credit : undefined,
        };
      });

      try {
        await onPay(payload, {
          closeWithDebt: isPartialOrZero,
          confirmOutstandingBalance: isPartialOrZero,
          allocations,
        });
      } catch (err) {
        triggerError(err instanceof Error ? err.message : "Erro ao finalizar atendimento.");
      }
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
    showDiscardConfirm ||
    isCreditInvalid ||
    (!isClosedWithDebt && isPartialOrZero && (!canManageDebt || !confirmDebt)) ||
    (!isMixed && amountNum < 0) ||
    (!isMixed && amountNum > remainingTotal + 0.009) ||
    (isMixed && mixedTotal > remainingTotal + 0.009) ||
    (isClosedWithDebt && appliedTotal <= 0);

  const displayedError = validationError || error;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="payment-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (showDiscardConfirm) {
          handleCancelDiscard();
          return;
        }
        handleAttemptClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (showDiscardConfirm) {
            handleCancelDiscard();
            return;
          }
          handleAttemptClose();
        }
      }}
      className="fixed inset-0 z-50 m-0 sm:m-auto flex items-end sm:items-center justify-center bg-transparent border-none outline-none backdrop:bg-[var(--backdrop)] backdrop:backdrop-blur-sm p-0 sm:p-4 w-full max-w-full sm:max-w-lg max-h-none h-full sm:h-auto open:flex box-border"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-t-2xl sm:rounded-xl w-full max-w-full sm:max-w-lg shadow-2xl flex flex-col max-h-[90dvh] sm:max-h-[85vh] overflow-hidden focus:outline-none box-border"
      >
        {/* Layer 1: Header fixo */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] flex justify-between items-center shrink-0 w-full box-border">
          <h2 id="payment-modal-title" className="text-base sm:text-lg font-bold text-[var(--text-primary)] truncate pr-2">
            {isClosedWithDebt ? "Receber Saldo em Aberto" : "Finalizar Atendimento - Receber"}
          </h2>
          <button
            type="button"
            onClick={handleAttemptClose}
            disabled={busy || showDiscardConfirm}
            aria-label="Fechar diálogo de pagamento"
            className="w-11 h-11 min-w-[44px] min-h-[44px] shrink-0 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 text-2xl leading-none rounded-lg hover:bg-[var(--surface-hover)] cursor-pointer transition-colors touch-manipulation"
          >
            &times;
          </button>
        </div>

        {/* Diálogo Contextual Modal de Confirmação de Descarte (BLOQUEADOR B) */}
        {showDiscardConfirm && (
          <dialog
            ref={discardDialogRef}
            role="alertdialog"
            aria-labelledby="discard-title"
            aria-describedby="discard-desc"
            onCancel={(e) => {
              e.preventDefault();
              handleCancelDiscard();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                handleCancelDiscard();
              } else if (e.key === "Tab") {
                if (e.shiftKey && document.activeElement === continueEditBtnRef.current) {
                  e.preventDefault();
                  discardBtnRef.current?.focus();
                } else if (!e.shiftKey && document.activeElement === discardBtnRef.current) {
                  e.preventDefault();
                  continueEditBtnRef.current?.focus();
                }
              }
            }}
            className="fixed inset-0 z-60 m-auto flex items-center justify-center bg-transparent border-none outline-none backdrop:bg-[var(--backdrop)] backdrop:backdrop-blur-sm p-4 w-full max-w-sm box-border open:flex"
          >
            <div className="bg-[var(--surface)] border border-[var(--border-danger)] rounded-xl w-full p-4 text-[var(--danger)] shadow-2xl flex flex-col gap-3 box-border">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <h3 id="discard-title" className="text-base font-bold text-[var(--danger)]">
                  Descartar alterações?
                </h3>
              </div>
              <p id="discard-desc" className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Você modificou valores ou formas de pagamento deste atendimento. Se fechar agora, as alterações serão perdidas.
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1 w-full box-border">
                <button
                  ref={continueEditBtnRef}
                  type="button"
                  onClick={handleCancelDiscard}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer touch-manipulation transition-colors"
                >
                  Continuar editando
                </button>
                <button
                  ref={discardBtnRef}
                  type="button"
                  onClick={executeClose}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-bold rounded-lg bg-[var(--danger)] text-white hover:bg-red-700 cursor-pointer touch-manipulation transition-colors"
                >
                  Descartar e fechar
                </button>
              </div>
            </div>
          </dialog>
        )}

        {/* Layer 2: Formulário com Corpo rolável e Footer fixo (sem noValidate para suporte a restrições nativas) */}
        <form
          onSubmit={handleSubmit}
          inert={showDiscardConfirm}
          aria-hidden={showDiscardConfirm ? "true" : undefined}
          className="flex flex-col flex-1 overflow-hidden min-h-0 w-full box-border"
        >
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-5 space-y-4 w-full box-border"
          >
            {/* Banner de Erro Contextual (Local ou API) */}
            {displayedError && (
              <div
                ref={errorBannerRef}
                tabIndex={-1}
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-[var(--border-danger)] bg-[var(--danger-subtle)] p-3.5 text-sm text-[var(--danger)] flex items-start gap-2 focus:outline-none focus:ring-2 focus:ring-[var(--danger)] shrink-0 box-border"
              >
                <span className="text-base leading-none">⚠️</span>
                <div className="flex-1 font-medium">{displayedError}</div>
                <button
                  type="button"
                  onClick={clearErrors}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs text-[var(--danger)] hover:underline ml-2 cursor-pointer touch-manipulation"
                  aria-label="Fechar mensagem de erro"
                >
                  ✕
                </button>
              </div>
            )}

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
                  onClick={() => {
                    clearErrors();
                    setIsMixed(false);
                  }}
                  className={`min-h-[44px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg border transition-colors touch-manipulation cursor-pointer flex items-center justify-center text-center ${
                    !isMixed
                      ? "border-[var(--gold)] bg-[var(--gold-subtle)] text-[var(--gold)]"
                      : "border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  Pagamento Único
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearErrors();
                    setIsMixed(true);
                  }}
                  className={`min-h-[44px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg border transition-colors touch-manipulation cursor-pointer flex items-center justify-center text-center ${
                    isMixed
                      ? "border-[var(--gold)] bg-[var(--gold-subtle)] text-[var(--gold)]"
                      : "border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  Misto / Múltiplos
                </button>
              </div>
            </div>

            {!isMixed ? (
              // Formulario Pagamento Unico
              <div className="space-y-4 pt-1">
                <div>
                  <label htmlFor="single-method-select" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Forma de Pagamento
                  </label>
                  <select
                    id="single-method-select"
                    value={singleMethod}
                    onChange={(e) => {
                      clearErrors();
                      setSingleMethod(e.target.value);
                    }}
                    disabled={busy}
                    className="w-full min-h-[44px] bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                  >
                    <option value="PIX">Pix</option>
                    <option value="CREDIT">Cartão de Crédito</option>
                    {canConsumeCredit && customerCreditBalance > 0 && (
                      <option value="CUSTOMER_CREDIT">
                        Crédito do Cliente (Saldo: R$ {customerCreditBalance.toFixed(2)})
                      </option>
                    )}
                    <option value="DEBIT">Cartão de Débito</option>
                    <option value="CASH">Dinheiro</option>
                    <option value="OTHER">Outros</option>
                  </select>
                </div>

                {singleMethod === "CUSTOMER_CREDIT" && (
                  <div className="bg-[var(--surface-raised)] p-3 rounded-lg border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1">
                    <div className="flex justify-between">
                      <span>Saldo em conta:</span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        R$ {customerCreditBalance.toFixed(2)}
                      </span>
                    </div>
                    {amountNum > customerCreditBalance && (
                      <p className="text-[var(--danger)] font-medium">
                        Saldo insuficiente para quitar o valor selecionado.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label htmlFor="single-amount-input" className="block text-sm font-medium text-[var(--text-secondary)]">
                      Valor Aplicado à Venda (R$)
                    </label>
                    <span className="text-xs text-[var(--text-muted)]">
                      Máx: R$ {remainingTotal.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id="single-amount-input"
                    type="number"
                    step="0.01"
                    min={isClosedWithDebt ? "0.01" : "0"}
                    max={remainingTotal.toFixed(2)}
                    required
                    value={singleAmount}
                    onChange={(e) => {
                      clearErrors();
                      setSingleAmount(e.target.value);
                    }}
                    disabled={busy}
                    aria-invalid={invalidField === "single-amount-input"}
                    className={`w-full min-h-[44px] bg-[var(--surface-raised)] border rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none ${
                      invalidField === "single-amount-input"
                        ? "border-[var(--border-danger)] focus:border-[var(--danger)] ring-1 ring-[var(--danger)]"
                        : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                    }`}
                  />
                </div>

                {singleMethod !== "CUSTOMER_CREDIT" ? (
                  <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="tip-amount-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                          Gorjeta (R$)
                        </label>
                        <input
                          id="tip-amount-input"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={tipAmount}
                          onChange={(e) => {
                            clearErrors();
                            setTipAmount(e.target.value);
                          }}
                          disabled={busy}
                          className="w-full min-h-[44px] bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                        />
                      </div>
                      {tipAmountNum > 0 && (
                        <div>
                          <label htmlFor="tip-member-select" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                            Profissional Favorecido <span className="text-[var(--danger)]">*</span>
                          </label>
                          <select
                            id="tip-member-select"
                            value={tipMemberId}
                            onChange={(e) => {
                              clearErrors();
                              setTipMemberId(e.target.value);
                            }}
                            disabled={busy}
                            aria-invalid={invalidField === "tip-member-select"}
                            className={`w-full min-h-[44px] bg-[var(--surface-raised)] border rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none ${
                              invalidField === "tip-member-select"
                                ? "border-[var(--border-danger)] ring-1 ring-[var(--danger)]"
                                : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                            }`}
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
                      <label htmlFor="credit-deposit-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                        Adicionar ao Crédito do Cliente (R$)
                      </label>
                      <input
                        id="credit-deposit-input"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={creditDepositAmount}
                        onChange={(e) => {
                          clearErrors();
                          setCreditDepositAmount(e.target.value);
                        }}
                        disabled={busy}
                        className="w-full min-h-[44px] bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] p-3 rounded-lg border border-[var(--border-subtle)]">
                    ℹ️ Pagamento com crédito não permite adicionar gorjeta nem depósito de crédito.
                  </div>
                )}

                {/* Bloco específico para Dinheiro: Troco */}
                {singleMethod === "CASH" && (
                  <div className="pt-2 border-t border-[var(--border-subtle)]">
                    <label htmlFor="cash-received-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                      Valor Recebido em Dinheiro (R$)
                    </label>
                    <input
                      id="cash-received-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={`Mínimo: R$ ${totalAllocatedNoChange.toFixed(2)}`}
                      value={cashReceived}
                      onChange={(e) => {
                        clearErrors();
                        setCashReceived(e.target.value);
                      }}
                      disabled={busy}
                      aria-invalid={invalidField === "cash-received-input"}
                      className={`w-full min-h-[44px] bg-[var(--surface-raised)] border rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none ${
                        invalidField === "cash-received-input"
                          ? "border-[var(--border-danger)] ring-1 ring-[var(--danger)]"
                          : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                      }`}
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
              <div className="space-y-3 pt-1">
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-medium text-[var(--text-secondary)]">
                    Parcelas / Meios Declarados
                  </label>
                  <button
                    type="button"
                    onClick={addMixedRow}
                    disabled={busy}
                    className="min-h-[44px] px-3.5 py-2 text-xs text-[var(--gold)] hover:text-[var(--gold-light)] font-semibold flex items-center gap-1 cursor-pointer transition-colors touch-manipulation rounded-lg hover:bg-[var(--surface-hover)]"
                  >
                    + Adicionar Meio
                  </button>
                </div>

                <div className="space-y-3">
                  {mixedPayments.map((p, idx) => {
                    const sale = Number(p.amount) || 0;
                    const tip = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.tipAmount) || 0);
                    const deposit = p.method === "CUSTOMER_CREDIT" ? 0 : (Number(p.creditDepositAmount) || 0);
                    const baseNeeded = sale + tip + deposit;
                    const typedCash = p.method === "CASH" ? (Number(p.receivedAmount) || 0) : 0;
                    const rowChange = p.method === "CASH" && typedCash > baseNeeded ? typedCash - baseNeeded : 0;

                    return (
                      <div key={p.id} className="p-3.5 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg space-y-2.5 box-border">
                        <div className="flex justify-between items-center pb-1.5 border-b border-[var(--border-subtle)]">
                          <span className="text-xs font-semibold text-[var(--gold)]">
                            Meio #{idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeMixedRow(p.id)}
                            disabled={busy || mixedPayments.length === 1}
                            aria-label={`Remover meio de pagamento #${idx + 1}`}
                            className="min-h-[44px] px-3 text-xs text-[var(--danger)] hover:text-red-400 disabled:opacity-30 cursor-pointer touch-manipulation flex items-center justify-center rounded-lg hover:bg-[var(--surface-hover)]"
                          >
                            Remover
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label htmlFor={`mixed-method-${p.id}`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                              Forma
                            </label>
                            <select
                              id={`mixed-method-${p.id}`}
                              value={p.method}
                              onChange={(e) => updateMixedRow(p.id, "method", e.target.value)}
                              disabled={busy}
                              className="w-full min-h-[44px] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
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
                          </div>

                          <div>
                            <label htmlFor={`mixed-amount-${p.id}`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                              Valor Venda (R$)
                            </label>
                            <input
                              id={`mixed-amount-${p.id}`}
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={remainingTotal.toFixed(2)}
                              required
                              placeholder="0.00"
                              value={p.amount}
                              onChange={(e) => updateMixedRow(p.id, "amount", e.target.value)}
                              disabled={busy}
                              aria-invalid={invalidField === `mixed-amount-${p.id}`}
                              className={`w-full min-h-[44px] bg-[var(--surface)] border rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none ${
                                invalidField === `mixed-amount-${p.id}`
                                  ? "border-[var(--border-danger)] ring-1 ring-[var(--danger)]"
                                  : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                              }`}
                            />
                          </div>
                        </div>

                        {p.method === "CUSTOMER_CREDIT" ? (
                          <div className="text-[11px] text-[var(--text-muted)] bg-[var(--surface)] p-2 rounded border border-[var(--border-subtle)]">
                            ℹ️ Crédito do cliente: restrito à venda (sem gorjeta/depósito/troco).
                          </div>
                        ) : (
                          <div className="space-y-2 pt-1 border-t border-[var(--border-subtle)]">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label htmlFor={`mixed-tip-${p.id}`} className="block text-[11px] font-medium text-[var(--text-secondary)] mb-0.5">
                                  Gorjeta (R$)
                                </label>
                                <input
                                  id={`mixed-tip-${p.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={p.tipAmount ?? ""}
                                  onChange={(e) => updateMixedRow(p.id, "tipAmount", e.target.value)}
                                  disabled={busy}
                                  className="w-full min-h-[44px] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                                />
                              </div>
                              {tip > 0 && (
                                <div>
                                  <label htmlFor={`mixed-tip-member-${p.id}`} className="block text-[11px] font-medium text-[var(--text-secondary)] mb-0.5">
                                    Profissional Favorecido <span className="text-[var(--danger)]">*</span>
                                  </label>
                                  <select
                                    id={`mixed-tip-member-${p.id}`}
                                    value={p.tipMemberId ?? ""}
                                    onChange={(e) => updateMixedRow(p.id, "tipMemberId", e.target.value)}
                                    disabled={busy}
                                    aria-invalid={invalidField === `mixed-tip-member-${p.id}`}
                                    className={`w-full min-h-[44px] bg-[var(--surface)] border rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none ${
                                      invalidField === `mixed-tip-member-${p.id}`
                                        ? "border-[var(--border-danger)] ring-1 ring-[var(--danger)]"
                                        : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                                    }`}
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
                              <label htmlFor={`mixed-credit-deposit-${p.id}`} className="block text-[11px] font-medium text-[var(--text-secondary)] mb-0.5">
                                Adicionar ao Crédito do Cliente (R$)
                              </label>
                              <input
                                id={`mixed-credit-deposit-${p.id}`}
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={p.creditDepositAmount ?? ""}
                                onChange={(e) => updateMixedRow(p.id, "creditDepositAmount", e.target.value)}
                                disabled={busy}
                                className="w-full min-h-[44px] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                              />
                            </div>

                            {p.method === "CASH" && (
                              <div className="pt-1.5 border-t border-[var(--border-subtle)] space-y-1">
                                <label htmlFor={`mixed-cash-${p.id}`} className="block text-[11px] font-medium text-[var(--text-secondary)] mb-0.5">
                                  Valor recebido em dinheiro (R$)
                                </label>
                                <input
                                  id={`mixed-cash-${p.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder={`Mínimo: R$ ${baseNeeded.toFixed(2)}`}
                                  value={p.receivedAmount ?? ""}
                                  onChange={(e) => updateMixedRow(p.id, "receivedAmount", e.target.value)}
                                  disabled={busy}
                                  aria-invalid={invalidField === `mixed-cash-${p.id}`}
                                  className={`w-full min-h-[44px] bg-[var(--surface)] border rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none ${
                                    invalidField === `mixed-cash-${p.id}`
                                      ? "border-[var(--border-danger)] ring-1 ring-[var(--danger)]"
                                      : "border-[var(--border-subtle)] focus:border-[var(--gold)]"
                                  }`}
                                />
                                {rowChange > 0 && (
                                  <p className="mt-1 text-xs text-[var(--gold)] font-serif font-medium">
                                    Troco desta parcela: R$ {rowChange.toFixed(2)}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Allocation Engine Summary Card */}
            <div className="p-3.5 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg space-y-1.5 text-xs box-border">
              <div className="font-bold text-[var(--gold)] uppercase tracking-wider mb-1">Resumo de Alocação do Checkout</div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Saldo da venda:</span>
                <span>R$ {remainingTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-primary)]">
                <span>Aplicado à venda:</span>
                <span>R$ {appliedTotal.toFixed(2)}</span>
              </div>
              {(isMixed ? mixedTipsTotal : tipAmountNum) > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Gorjeta:</span>
                  <span>R$ {(isMixed ? mixedTipsTotal : tipAmountNum).toFixed(2)}</span>
                </div>
              )}
              {(isMixed ? mixedCreditDepositTotal : creditDepositNum) > 0 && (
                <div className="flex justify-between text-blue-400">
                  <span>Crédito gerado:</span>
                  <span>R$ {(isMixed ? mixedCreditDepositTotal : creditDepositNum).toFixed(2)}</span>
                </div>
              )}
              {(isMixed ? mixedChangeTotal > 0 : (showChange && change > 0)) && (
                <div className="flex justify-between text-amber-300 font-medium">
                  <span>Troco (dinheiro):</span>
                  <span>R$ {(isMixed ? mixedChangeTotal : change).toFixed(2)}</span>
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
              <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3 bg-[var(--surface-raised)] p-3.5 rounded-lg box-border">
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
                  <label
                    htmlFor="confirm-debt-checkbox"
                    className="min-h-[44px] flex items-start gap-3 pt-2.5 border-t border-[var(--border-subtle)] text-xs text-[var(--text-primary)] cursor-pointer touch-manipulation"
                  >
                    <input
                      id="confirm-debt-checkbox"
                      type="checkbox"
                      checked={confirmDebt}
                      onChange={(e) => {
                        clearErrors();
                        setConfirmDebt(e.target.checked);
                      }}
                      disabled={busy}
                      aria-invalid={invalidField === "confirm-debt-checkbox"}
                      className="mt-0.5 w-5 h-5 rounded border-[var(--border-subtle)] text-[var(--gold)] focus:ring-[var(--gold)]"
                    />
                    <span className="font-medium leading-relaxed">
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
          </div>

          {/* Layer 3: Rodapé fixo de ações (Ordem natural no DOM e visual: Cancelar acima no mobile / à esquerda no desktop; Confirmar abaixo no mobile / à direita no desktop) */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:justify-end gap-2.5 sm:gap-3 bg-[var(--surface-raised)] p-4 sm:p-5 w-full box-border">
            <button
              type="button"
              onClick={handleAttemptClose}
              disabled={busy || showDiscardConfirm}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 cursor-pointer transition-colors text-sm font-semibold touch-manipulation text-center flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm flex items-center justify-center gap-2 touch-manipulation text-center"
            >
              {busy && (
                <svg className="animate-spin h-4 w-4 text-[var(--text-inverse)] shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              <span className="truncate">{getButtonText()}</span>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
