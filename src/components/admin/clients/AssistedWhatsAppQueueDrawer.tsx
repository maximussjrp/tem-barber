/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  WHATSAPP_TEMPLATES,
  buildClientWhatsappMessage,
} from "@/lib/customer-whatsapp-templates";

export interface QueueRecipientItem {
  recipientId: string;
  queueIndex: number;
  customerId: string;
  customerName: string;
  customerPhone: string;
  dispatchStatus:
    | "READY"
    | "WHATSAPP_OPENED"
    | "SENT_CONFIRMED"
    | "EXCLUDED"
    | "OPTED_OUT"
    | "FAILED";
  failureReason?: string | null;
  dispatchError?: string | null;
  templateKey?: string;
  templateLabel?: string;
  previewMessage: string;
  openedMessageText?: string | null;
  confirmedMessageText?: string | null;
  isCustomEdited?: boolean;
  openPreparationId?: string | null;
  lease?: {
    operatorUserId: string;
    operatorName: string;
    acquiredAt: string | null;
    expiresAt: string | null;
    isExpired: boolean;
    isLockedByOtherOperator: boolean;
    requiresHumanReconciliation: boolean;
  } | null;
}

interface AssistedWhatsAppQueueDrawerProps {
  open: boolean;
  canViewClients?: boolean;
  canOperateWhatsappAssisted?: boolean;
  campaignId: string | null;
  campaignName: string;
  campaignStatus: string;
  initialTemplateKey: string;
  barbershopName?: string;
  recipients: QueueRecipientItem[];
  remainingEligibleInRoundCount: number;
  onCloseKeepProgress: () => void;
  onRecipientUpdated: (
    recipientId: string,
    updates: Partial<QueueRecipientItem>,
    campaignStatus?: string
  ) => void;
  onClientConfirmedSent: (customerId: string) => void;
  onClientSkipped: (customerId: string) => void;
  onCampaignCancelled: () => void;
  onStartNextBatchInRound: () => void;
}

function formatDisplayPhone(phone: string) {
  const d = (phone || "").replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

export function AssistedWhatsAppQueueDrawer({
  open,
  canViewClients = false,
  canOperateWhatsappAssisted = false,
  campaignId,
  campaignName,
  campaignStatus,
  initialTemplateKey,
  barbershopName = "nossa barbearia",
  recipients,
  remainingEligibleInRoundCount,
  onCloseKeepProgress,
  onRecipientUpdated,
  onClientConfirmedSent,
  onClientSkipped,
  onCampaignCancelled,
  onStartNextBatchInRound,
}: AssistedWhatsAppQueueDrawerProps) {
  // Find active pending recipients (READY or WHATSAPP_OPENED)
  const pendingRecipients = useMemo(
    () =>
      recipients.filter(
        (r) =>
          r.dispatchStatus === "READY" || r.dispatchStatus === "WHATSAPP_OPENED"
      ),
    [recipients]
  );

  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    null
  );

  const currentRecipient = useMemo(() => {
    if (pendingRecipients.length === 0) return null;
    if (selectedRecipientId) {
      const found = pendingRecipients.find(
        (r) => r.recipientId === selectedRecipientId
      );
      if (found) return found;
    }
    const unlocked = pendingRecipients.find(
      (r) => !r.lease?.isLockedByOtherOperator
    );
    return unlocked || pendingRecipients[0];
  }, [pendingRecipients, selectedRecipientId]);

  // Message & template state for current recipient
  const [templateKey, setTemplateKey] = useState<string>(
    initialTemplateKey || "RETURN_REMINDER"
  );
  const [messageText, setMessageText] = useState<string>("");
  const [lastOpenedMessageText, setLastOpenedMessageText] = useState<
    string | null
  >(null);
  const [lastOpenedTemplateKey, setLastOpenedTemplateKey] = useState<
    string | null
  >(null);
  const [activeOpenPreparationId, setActiveOpenPreparationId] = useState<
    string | null
  >(null);
  const [lastWhatsappUrl, setLastWhatsappUrl] = useState<string | null>(null);
  const [popupBlockedWarning, setPopupBlockedWarning] = useState(false);
  const [returnedFromWhatsApp, setReturnedFromWhatsApp] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  // Action loading & errors
  const [busyAction, setBusyAction] = useState<
    "opening" | "confirming" | "skipping" | "cancelling" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // S-01 Human Reconciliation state
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [reconciliationChecked, setReconciliationChecked] = useState(false);
  const [reconciliationReason, setReconciliationReason] = useState("");

  // Sync local state only when switching to a different recipient in the queue
  const recipientSyncKey = currentRecipient ? currentRecipient.recipientId : "none";
  const [prevRecipientSyncKey, setPrevRecipientSyncKey] = useState<string>("");

  if (prevRecipientSyncKey !== recipientSyncKey) {
    setPrevRecipientSyncKey(recipientSyncKey);
    if (!currentRecipient) {
      setMessageText("");
      setLastOpenedMessageText(null);
      setLastOpenedTemplateKey(null);
      setActiveOpenPreparationId(null);
      setLastWhatsappUrl(null);
      setPopupBlockedWarning(false);
      setReturnedFromWhatsApp(false);
      setReconciliationRequired(false);
      setReconciliationChecked(false);
      setReconciliationReason("");
    } else {
      const rTemplate =
        currentRecipient.templateKey || initialTemplateKey || "RETURN_REMINDER";
      const rText =
        currentRecipient.openedMessageText ||
        currentRecipient.previewMessage ||
        buildClientWhatsappMessage({
          template: rTemplate,
          customerName: currentRecipient.customerName,
          barbershopName,
        });

      setTemplateKey(rTemplate);
      setMessageText(rText);
      setLastOpenedMessageText(
        currentRecipient.dispatchStatus === "WHATSAPP_OPENED"
          ? currentRecipient.openedMessageText || currentRecipient.previewMessage
          : null
      );
      setLastOpenedTemplateKey(
        currentRecipient.dispatchStatus === "WHATSAPP_OPENED" ? rTemplate : null
      );
      setActiveOpenPreparationId(currentRecipient.openPreparationId || null);
      setLastWhatsappUrl(null);
      setPopupBlockedWarning(false);
      setReturnedFromWhatsApp(false);
      setActionError(null);
      setReconciliationRequired(
        Boolean(currentRecipient.lease?.requiresHumanReconciliation)
      );
      setReconciliationChecked(false);
      setReconciliationReason("");
    }
  }

  // Detect return from WhatsApp Web / App
  useEffect(() => {
    if (!open || currentRecipient?.dispatchStatus !== "WHATSAPP_OPENED") return;

    const handleReturn = () => {
      if (document.visibilityState === "visible") {
        setReturnedFromWhatsApp(true);
      }
    };

    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    return () => {
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
    };
  }, [open, currentRecipient?.dispatchStatus]);

  if (!open) return null;

  const totalCount = recipients.length;
  const sentCount = recipients.filter(
    (r) => r.dispatchStatus === "SENT_CONFIRMED"
  ).length;
  const skippedCount = recipients.filter(
    (r) =>
      r.dispatchStatus === "EXCLUDED" ||
      r.dispatchStatus === "OPTED_OUT" ||
      r.dispatchStatus === "FAILED"
  ).length;
  const completedCount = sentCount + skippedCount;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const isDirtySinceLastOpen =
    currentRecipient?.dispatchStatus === "WHATSAPP_OPENED" &&
    ((lastOpenedMessageText !== null &&
      messageText.trim() !== lastOpenedMessageText.trim()) ||
      (lastOpenedTemplateKey !== null &&
        templateKey !== lastOpenedTemplateKey));

  const canConfirmSend =
    Boolean(currentRecipient) &&
    currentRecipient?.dispatchStatus === "WHATSAPP_OPENED" &&
    Boolean(activeOpenPreparationId) &&
    !isDirtySinceLastOpen &&
    busyAction === null &&
    !currentRecipient?.lease?.isLockedByOtherOperator;

  const handleSelectTemplate = (newKey: string) => {
    setTemplateKey(newKey);
    if (!currentRecipient) return;
    const defaultText = buildClientWhatsappMessage({
      template: newKey,
      customerName: currentRecipient.customerName,
      barbershopName,
    });
    setMessageText(defaultText);
  };

  const handleRestoreDefaultMessage = () => {
    if (!currentRecipient) return;
    const defaultText = buildClientWhatsappMessage({
      template: templateKey,
      customerName: currentRecipient.customerName,
      barbershopName,
    });
    setMessageText(defaultText);
  };

  const handleCopyMessage = async () => {
    if (!messageText.trim()) return;
    try {
      await navigator.clipboard?.writeText(messageText);
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 2000);
    } catch {
      setActionNotice("Não foi possível copiar automaticamente.");
    }
  };

  const buildReconciliationPayload = () => {
    if (!reconciliationRequired) return undefined;
    return {
      confirmedReconciliation: reconciliationChecked,
      reason: reconciliationReason.trim(),
    };
  };

  const handleOpenWhatsApp = async () => {
    if (!canViewClients || !canOperateWhatsappAssisted) {
      setActionError(
        "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para operar a fila assistida."
      );
      return;
    }
    if (!campaignId || !currentRecipient) return;
    const trimmed = messageText.trim();
    if (!trimmed) {
      setActionError("A mensagem não pode estar vazia.");
      return;
    }

    if (
      reconciliationRequired &&
      (!reconciliationChecked || reconciliationReason.trim().length < 10)
    ) {
      setActionError(
        "Confirme a reconciliação humana e informe o motivo (mínimo de 10 caracteres) para assumir este destinatário."
      );
      return;
    }

    setBusyAction("opening");
    setActionError(null);
    setActionNotice(null);
    setPopupBlockedWarning(false);

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${campaignId}/recipients/${currentRecipient.recipientId}/opened`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateKey,
            messageText: trimmed,
            reconciliation: buildReconciliationPayload(),
          }),
        }
      );

      const payload = await res.json();

      if (!res.ok) {
        if (payload.error === "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION") {
          setReconciliationRequired(true);
          setActionError(payload.message);
          return;
        }
        // R-09: Se o destinatário foi suprimido ao vivo (STALE_*), atualiza o estado local e avança
        if (payload.recipient?.dispatchStatus) {
          onRecipientUpdated(
            currentRecipient.recipientId,
            {
              dispatchStatus: payload.recipient.dispatchStatus,
              failureReason: payload.error,
              dispatchError: payload.message,
            },
            payload.campaignStatus
          );
          setActionNotice(
            `Cliente removido da fila pendente (${
              payload.message || payload.error
            }). Avançando para o próximo...`
          );
          return;
        }
        throw new Error(
          payload.message || payload.error || "Falha ao abrir o WhatsApp."
        );
      }

      const prepId =
        payload.openPreparationId ||
        payload.recipient?.payloadSnapshot?.openPreparationId ||
        null;

      setActiveOpenPreparationId(prepId);
      setLastOpenedMessageText(trimmed);
      setLastOpenedTemplateKey(templateKey);
      setLastWhatsappUrl(payload.whatsappUrl);
      setReconciliationRequired(false);

      onRecipientUpdated(
        currentRecipient.recipientId,
        {
          dispatchStatus: "WHATSAPP_OPENED",
          templateKey,
          openedMessageText: trimmed,
          openPreparationId: prepId,
        },
        payload.campaignStatus
      );

      if (typeof window !== "undefined" && payload.whatsappUrl) {
        const openedWin = window.open(
          payload.whatsappUrl,
          "_blank",
          "noopener,noreferrer"
        );
        if (!openedWin) {
          setPopupBlockedWarning(true);
        }
      }
    } catch (err: any) {
      setActionError(err.message || "Erro ao preparar abertura do WhatsApp.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmSent = async () => {
    if (!canViewClients || !canOperateWhatsappAssisted) {
      setActionError(
        "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para confirmar envio."
      );
      return;
    }
    if (!campaignId || !currentRecipient || !activeOpenPreparationId) return;

    setBusyAction("confirming");
    setActionError(null);
    setActionNotice(null);

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${campaignId}/recipients/${currentRecipient.recipientId}/sent-confirmed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openPreparationId: activeOpenPreparationId,
            reconciliation: buildReconciliationPayload(),
          }),
        }
      );

      const payload = await res.json();
      if (!res.ok) {
        if (payload.error === "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION") {
          setReconciliationRequired(true);
        }
        throw new Error(
          payload.message || payload.error || "Erro ao confirmar envio."
        );
      }

      onRecipientUpdated(
        currentRecipient.recipientId,
        {
          dispatchStatus: "SENT_CONFIRMED",
          confirmedMessageText: lastOpenedMessageText || messageText,
        },
        payload.campaignStatus
      );
      onClientConfirmedSent(currentRecipient.customerId);

      setActionNotice(
        payload.postOpenWarning ||
          `Envio confirmado para ${currentRecipient.customerName}!`
      );
      setSelectedRecipientId(null);
    } catch (err: any) {
      setActionError(err.message || "Falha ao confirmar envio manual.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSkipRecipient = async () => {
    if (!canViewClients || !canOperateWhatsappAssisted) {
      setActionError(
        "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para pular cliente na fila."
      );
      return;
    }
    if (!campaignId || !currentRecipient) return;

    setBusyAction("skipping");
    setActionError(null);
    setActionNotice(null);

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${campaignId}/recipients/${currentRecipient.recipientId}/skip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Pulado manualmente pelo operador na fila assistida.",
            reconciliation: buildReconciliationPayload(),
          }),
        }
      );

      const payload = await res.json();
      if (!res.ok) {
        if (payload.error === "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION") {
          setReconciliationRequired(true);
        }
        throw new Error(
          payload.message || payload.error || "Erro ao pular cliente."
        );
      }

      onRecipientUpdated(
        currentRecipient.recipientId,
        {
          dispatchStatus: "EXCLUDED",
          failureReason: "SKIPPED_BY_USER",
        },
        payload.campaignStatus
      );
      onClientSkipped(currentRecipient.customerId);
      setActionNotice(
        `${currentRecipient.customerName} foi pulado nesta fila (sem registrar envio).`
      );
      setSelectedRecipientId(null);
    } catch (err: any) {
      setActionError(err.message || "Falha ao pular destinatário.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelCampaign = async () => {
    if (!canViewClients || !canOperateWhatsappAssisted) {
      setActionError(
        "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para encerrar a fila."
      );
      return;
    }
    if (!campaignId) return;
    setBusyAction("cancelling");
    setActionError(null);

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${campaignId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Encerrada manualmente pelo operador no painel lateral.",
          }),
        }
      );
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          payload.message || payload.error || "Erro ao encerrar fila."
        );
      }
      onCampaignCancelled();
    } catch (err: any) {
      setActionError(err.message || "Falha ao encerrar fila.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex justify-end items-end md:items-stretch"
      role="dialog"
      aria-modal="true"
      aria-label="Fila Assistida de WhatsApp"
    >
      <div className="w-full md:max-w-lg bg-stone-950 border-t md:border-t-0 md:border-l border-stone-800 rounded-t-2xl md:rounded-none max-h-[92vh] md:max-h-full flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 md:p-5 border-b border-stone-800 bg-stone-900/80 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider">
                WhatsApp Assistido
              </span>
              {campaignId && (
                <span className="text-xs text-stone-400">
                  {completedCount} de {totalCount} processados
                </span>
              )}
            </div>
            <h2 className="text-base md:text-lg font-bold text-stone-100 mt-1">
              {campaignName || "Fila Inteligente WhatsApp"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onCloseKeepProgress}
            className="px-3 py-1.5 rounded-lg bg-stone-800 text-stone-300 hover:text-white text-xs font-semibold border border-stone-700"
          >
            Fechar e continuar depois
          </button>
        </div>

        {/* Progress Bar */}
        {campaignId && totalCount > 0 && (
          <div className="px-4 py-3 bg-stone-900/40 border-b border-stone-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-emerald-400 font-semibold">
                Enviados: {sentCount}
              </span>
              <span className="text-stone-400">
                Pulados/Suprimidos: {skippedCount}
              </span>
              <span className="text-amber-300 font-semibold">
                Pendentes: {pendingRecipients.length}
              </span>
            </div>
            <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
          {actionError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-950/70 border border-red-700/60 text-red-200 text-xs"
            >
              {actionError}
            </div>
          )}

          {actionNotice && (
            <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 text-xs">
              {actionNotice}
            </div>
          )}

          {!canViewClients ? (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs space-y-1"
            >
              <p className="font-bold">Acesso restrito aos dados de clientes</p>
              <p>
                Permissão &apos;CLIENTS_VIEW&apos; necessária para visualizar clientes ou operar a fila assistida.
              </p>
            </div>
          ) : currentRecipient ? (
            !canOperateWhatsappAssisted ? (
              <div
                role="alert"
                className="p-4 rounded-xl bg-amber-950/50 border border-amber-700/60 text-amber-200 text-xs space-y-1"
              >
                <p className="font-bold">Operação da fila assistida não autorizada</p>
                <p>
                  Permissão &apos;WHATSAPP_ASSISTED_OPERATE&apos; necessária para abrir WhatsApp, confirmar envios ou pular clientes na fila.
                </p>
              </div>
            ) : (
            /* Mode B: Active Recipient in Queue */
            <div className="space-y-4">
              {/* Current Client Card */}
              <div className="p-4 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-400">
                      #{currentRecipient.queueIndex + 1}
                    </span>
                    <h3 className="text-sm font-bold text-stone-100">
                      {currentRecipient.customerName}
                    </h3>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    WhatsApp:{" "}
                    {formatDisplayPhone(currentRecipient.customerPhone)}
                  </p>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    currentRecipient.dispatchStatus === "WHATSAPP_OPENED"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      : "bg-stone-800 text-stone-300 border border-stone-700"
                  }`}
                >
                  {currentRecipient.dispatchStatus === "WHATSAPP_OPENED"
                    ? "WhatsApp Aberto"
                    : "Pronto para abrir"}
                </span>
              </div>

              {/* S-01: Locked by another operator */}
              {currentRecipient.lease?.isLockedByOtherOperator && (
                <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-700/60 text-amber-200 text-xs space-y-2">
                  <p className="font-bold">
                    Destinatário reservado por{" "}
                    {currentRecipient.lease.operatorName}
                  </p>
                  <p>
                    Outro operador abriu este cliente recentemente. Aguarde a
                    conclusão ou selecione outro cliente disponível.
                  </p>
                </div>
              )}

              {/* S-01: Human Reconciliation Required when previous operator lease expired */}
              {reconciliationRequired && (
                <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-600/60 text-amber-100 text-xs space-y-3">
                  <p className="font-bold text-amber-300">
                    Reconciliação Humana Obrigatória (S-01)
                  </p>
                  <p>
                    Este cliente teve o WhatsApp aberto anteriormente e a
                    reserva expirou sem confirmação. Confirme com o operador
                    anterior antes de assumir para evitar envio duplicado.
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reconciliationChecked}
                      onChange={(e) =>
                        setReconciliationChecked(e.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Confirmo que verifiquei o status com o operador anterior
                      antes de assumir este cliente.
                    </span>
                  </label>
                  <input
                    type="text"
                    value={reconciliationReason}
                    onChange={(e) => setReconciliationReason(e.target.value)}
                    placeholder="Motivo da transferência (mín. 10 caracteres)..."
                    className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-100"
                  />
                </div>
              )}

              {/* Return from WhatsApp Banner */}
              {returnedFromWhatsApp &&
                currentRecipient.dispatchStatus === "WHATSAPP_OPENED" && (
                  <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-600/40 text-emerald-200 text-xs">
                    Você retornou ao Tem Barber. Se já enviou a mensagem no
                    WhatsApp, clique em <strong>Confirmar que enviei</strong>.
                    Caso não tenha enviado, clique em{" "}
                    <strong>Pular cliente</strong>.
                  </div>
                )}

              {/* Template Selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="queue-template-select"
                  className="block text-xs font-semibold text-stone-300"
                >
                  Modelo de mensagem
                </label>
                <select
                  id="queue-template-select"
                  value={templateKey}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-100"
                >
                  {WHATSAPP_TEMPLATES.map((tpl) => (
                    <option key={tpl.key} value={tpl.key}>
                      {tpl.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Editable Message */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="queue-message-textarea"
                    className="text-xs font-semibold text-stone-300"
                  >
                    Mensagem para {currentRecipient.customerName}
                  </label>
                  <span className="text-[11px] text-stone-500">
                    {messageText.length}/2000
                  </span>
                </div>
                <textarea
                  id="queue-message-textarea"
                  rows={5}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 rounded-lg p-3 text-xs text-stone-100 focus:border-amber-500 focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRestoreDefaultMessage}
                    className="text-xs text-stone-400 hover:text-stone-200 underline"
                  >
                    Restaurar texto padrão
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyMessage}
                    className="px-2.5 py-1 rounded bg-stone-800 border border-stone-700 text-stone-200 text-xs hover:bg-stone-700"
                  >
                    {copiedFeedback ? "Mensagem copiada!" : "Copiar mensagem"}
                  </button>
                </div>
              </div>

              {/* Dirty after open warning (S-02) */}
              {isDirtySinceLastOpen && (
                <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-700/60 text-amber-200 text-xs">
                  O texto ou modelo foi alterado após a abertura do WhatsApp.
                  Clique em <strong>Reabrir no WhatsApp</strong> para preparar a
                  nova versão antes de confirmar o envio.
                </div>
              )}

              {/* Popup blocker / Mobile direct fallback link */}
              {(popupBlockedWarning || lastWhatsappUrl) && lastWhatsappUrl && (
                <div className="p-3 rounded-lg bg-stone-900 border border-stone-700 text-xs space-y-1.5">
                  {popupBlockedWarning && (
                    <p className="text-amber-300 font-semibold">
                      O navegador bloqueou a abertura automática da janela.
                    </p>
                  )}
                  <a
                    href={lastWhatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-emerald-400 font-bold underline"
                  >
                    Toque aqui para abrir a conversa no WhatsApp
                  </a>
                </div>
              )}

              {/* Primary Action Buttons */}
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleOpenWhatsApp}
                  disabled={
                    busyAction !== null ||
                    Boolean(currentRecipient.lease?.isLockedByOtherOperator)
                  }
                  className="w-full py-2.5 px-4 rounded-lg bg-amber-500 text-stone-950 font-bold text-xs hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  {busyAction === "opening"
                    ? "Validando e abrindo..."
                    : currentRecipient.dispatchStatus === "WHATSAPP_OPENED"
                    ? "Reabrir no WhatsApp"
                    : "Abrir no WhatsApp"}
                </button>

                <button
                  type="button"
                  onClick={handleConfirmSent}
                  disabled={!canConfirmSend}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 text-stone-950 font-bold text-xs hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busyAction === "confirming"
                    ? "Registrando confirmação..."
                    : "Confirmar que enviei"}
                </button>

                <button
                  type="button"
                  onClick={handleSkipRecipient}
                  disabled={
                    busyAction !== null ||
                    Boolean(currentRecipient.lease?.isLockedByOtherOperator)
                  }
                  className="w-full py-2 px-4 rounded-lg bg-stone-900 border border-stone-700 text-stone-300 font-semibold text-xs hover:bg-stone-800 disabled:opacity-50"
                >
                  {busyAction === "skipping" ? "Pulando..." : "Pular cliente"}
                </button>
              </div>

              <p className="text-[11px] text-stone-500 text-center">
                Abrir o WhatsApp não registra envio automaticamente. Confirme
                somente após enviar manualmente a mensagem no aplicativo.
              </p>
            </div>
            )
          ) : (
            /* Mode C: Queue Completed or Cancelled */
            <div className="py-8 px-4 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-lg">
                ✓
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-100">
                  {campaignStatus === "CANCELLED"
                    ? "Fila encerrada"
                    : "Fila concluída!"}
                </h3>
                <p className="text-xs text-stone-400">
                  {sentCount} contato(s) confirmado(s) no histórico do CRM e{" "}
                  {skippedCount} pulado(s)/suprimido(s).
                </p>
              </div>

              {canOperateWhatsappAssisted &&
                remainingEligibleInRoundCount > 0 &&
                campaignStatus !== "CANCELLED" && (
                  <div className="p-4 rounded-xl bg-stone-900 border border-stone-800 space-y-3">
                    <p className="text-xs text-stone-300">
                      Ainda existem{" "}
                      <strong>{remainingEligibleInRoundCount}</strong>{" "}
                      cliente(s) elegíveis neste filtro que não foram
                      processados nesta rodada.
                    </p>
                    <button
                      type="button"
                      onClick={onStartNextBatchInRound}
                      className="w-full py-2.5 px-4 rounded-lg bg-amber-500 text-stone-950 font-bold text-xs hover:bg-amber-400"
                    >
                      Iniciar próximo lote (
                      {Math.min(50, remainingEligibleInRoundCount)} elegíveis)
                    </button>
                  </div>
                )}

              <button
                type="button"
                onClick={onCloseKeepProgress}
                className="px-4 py-2 rounded-lg bg-stone-800 text-stone-200 text-xs font-bold hover:bg-stone-700"
              >
                Voltar para Base de Clientes
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {canOperateWhatsappAssisted && campaignId && pendingRecipients.length > 0 && (
          <div className="p-3.5 border-t border-stone-800 bg-stone-900/60 flex items-center justify-between">
            <span className="text-[11px] text-stone-500">
              Progresso salvo automaticamente
            </span>
            <button
              type="button"
              onClick={handleCancelCampaign}
              disabled={busyAction !== null}
              className="text-xs text-red-400 hover:text-red-300 font-semibold"
            >
              {busyAction === "cancelling"
                ? "Encerrando..."
                : "Encerrar fila atual"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
