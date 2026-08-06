"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type TemplateKey =
  | "APPOINTMENT_DIRECT"
  | "APPOINTMENT_BEST_TIMES"
  | "WEEK_OPEN"
  | "WEEK_SCARCITY"
  | "RETURN_REMINDER"
  | "RETURN_FREQUENCY"
  | "INACTIVE_CLIENT"
  | "COMEBACK_LIGHT"
  | "POST_SERVICE_FEEDBACK"
  | "POST_SERVICE_NEXT"
  | "CLUB_ACTIVE"
  | "CLUB_VALUE"
  | "AUTHORITY_CARE"
  | "AUTHORITY_PRESENCE"
  | "WEEKEND_READY"
  | "SPECIAL_DATE"
  | "CUSTOM_BASE"
  | "invite"
  | "week"
  | "return"
  | "feedback";
type ContactChannel = "WHATSAPP" | "PHONE" | "IN_PERSON" | "EMAIL" | "OTHER";
type ContactTemplateKey =
  | "APPOINTMENT_DIRECT"
  | "APPOINTMENT_BEST_TIMES"
  | "WEEK_OPEN"
  | "WEEK_SCARCITY"
  | "RETURN_REMINDER"
  | "RETURN_FREQUENCY"
  | "INACTIVE_CLIENT"
  | "COMEBACK_LIGHT"
  | "POST_SERVICE_FEEDBACK"
  | "POST_SERVICE_NEXT"
  | "CLUB_ACTIVE"
  | "CLUB_VALUE"
  | "AUTHORITY_CARE"
  | "AUTHORITY_PRESENCE"
  | "WEEKEND_READY"
  | "SPECIAL_DATE"
  | "CUSTOM_BASE"
  | "APPOINTMENT_INVITE"
  | "CUSTOM"
  | "invite"
  | "week"
  | "return"
  | "feedback";

interface ClientData {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  barbershopName: string;
  bookingUrl: string | null;
  contactHistoryConfigured: boolean;
  isBlocked?: boolean;
  blockRecord?: {
    id: string;
    reason: string;
    blockedAt: string;
  } | null;
  clubSubscription: {
    id: string;
    status: string;
    planName: string;
    currentPeriodEnd: string;
  } | null;
  comandaSummary: {
    open: number;
    closed: number;
  };
  whatsapp: {
    link: string | null;
    messages: Record<TemplateKey, string>;
  };
  metrics: {
    totalAppointments: number;
    completedVisits: number;
    cancelledCount: number;
    noShowCount: number;
    upcomingAppointments: number;
    totalSpent: number;
    averageTicket: number;
    firstCompletedVisitAt: string | null;
    lastCompletedVisitAt: string | null;
    nextAppointmentAt: string | null;
    customerSinceAt: string | null;
    averageReturnDays: number | null;
    favoriteProfessional: { id: string; name: string } | null;
    favoriteService: { id: string; name: string } | null;
    averageRatingGiven: number | null;
    noShowRate: number;
    returnStatus: "INSUFFICIENT_DATA" | "IN_CYCLE" | "DUE_SOON" | "LATE" | "AT_RISK";
    reliabilityLabel: "INSUFFICIENT_DATA" | "HIGH" | "WARNING" | "RISK";
  };
  history: Array<{
    id: string;
    dateTime: string;
    status: string;
    bookingMode: "NORMAL" | "FIT_IN";
    professional: string;
    services: string[];
    totalPrice: number;
  }>;
}

interface ContactLog {
  id: string;
  channel: ContactChannel;
  templateKey: ContactTemplateKey;
  templateLabel: string;
  note: string | null;
  contactedAt: string;
  createdBy: {
    userId: string;
    name: string;
    memberId: string | null;
    memberName: string | null;
  };
}

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  APPOINTMENT_DIRECT: "Agendamento direto",
  APPOINTMENT_BEST_TIMES: "Garantir melhores horários",
  WEEK_OPEN: "Agenda da semana aberta",
  WEEK_SCARCITY: "Poucos horários na semana",
  RETURN_REMINDER: "Lembrete de retorno",
  RETURN_FREQUENCY: "Manter frequência",
  INACTIVE_CLIENT: "Cliente parado",
  COMEBACK_LIGHT: "Volta leve",
  POST_SERVICE_FEEDBACK: "Pós-atendimento/feedback",
  POST_SERVICE_NEXT: "Pós-atendimento com próximo horário",
  CLUB_ACTIVE: "Cliente clube ativo",
  CLUB_VALUE: "Reforço de benefício do clube",
  AUTHORITY_CARE: "Cuidado profissional",
  AUTHORITY_PRESENCE: "Presença e imagem",
  WEEKEND_READY: "Final de semana chegando",
  SPECIAL_DATE: "Data especial",
  CUSTOM_BASE: "Personalizado",
  invite: "Convite/agendamento",
  week: "Agenda da semana",
  return: "Cliente sem retorno",
  feedback: "Pós-atendimento/feedback",
};

const TEMPLATE_CATEGORIES = [
  {
    name: "Agendamento",
    keys: ["APPOINTMENT_DIRECT", "APPOINTMENT_BEST_TIMES"] as const,
  },
  {
    name: "Agenda da semana",
    keys: ["WEEK_OPEN", "WEEK_SCARCITY"] as const,
  },
  {
    name: "Lembrete de retorno",
    keys: ["RETURN_REMINDER", "RETURN_FREQUENCY"] as const,
  },
  {
    name: "Cliente parado",
    keys: ["INACTIVE_CLIENT", "COMEBACK_LIGHT"] as const,
  },
  {
    name: "Pós-atendimento",
    keys: ["POST_SERVICE_FEEDBACK", "POST_SERVICE_NEXT"] as const,
  },
  {
    name: "Cliente clube",
    keys: ["CLUB_ACTIVE", "CLUB_VALUE"] as const,
  },
  {
    name: "Autoridade/profissionalismo",
    keys: ["AUTHORITY_CARE", "AUTHORITY_PRESENCE"] as const,
  },
  {
    name: "Ocasiões especiais",
    keys: ["WEEKEND_READY", "SPECIAL_DATE"] as const,
  },
  {
    name: "Personalizado",
    keys: ["CUSTOM_BASE"] as const,
  },
];

const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Telefone",
  IN_PERSON: "Presencial",
  EMAIL: "E-mail",
  OTHER: "Outro",
};

const CONTACT_TEMPLATE_BY_WHATSAPP_TEMPLATE: Record<TemplateKey, ContactTemplateKey> = {
  APPOINTMENT_DIRECT: "APPOINTMENT_DIRECT",
  APPOINTMENT_BEST_TIMES: "APPOINTMENT_BEST_TIMES",
  WEEK_OPEN: "WEEK_OPEN",
  WEEK_SCARCITY: "WEEK_SCARCITY",
  RETURN_REMINDER: "RETURN_REMINDER",
  RETURN_FREQUENCY: "RETURN_FREQUENCY",
  INACTIVE_CLIENT: "INACTIVE_CLIENT",
  COMEBACK_LIGHT: "COMEBACK_LIGHT",
  POST_SERVICE_FEEDBACK: "POST_SERVICE_FEEDBACK",
  POST_SERVICE_NEXT: "POST_SERVICE_NEXT",
  CLUB_ACTIVE: "CLUB_ACTIVE",
  CLUB_VALUE: "CLUB_VALUE",
  AUTHORITY_CARE: "AUTHORITY_CARE",
  AUTHORITY_PRESENCE: "AUTHORITY_PRESENCE",
  WEEKEND_READY: "WEEKEND_READY",
  SPECIAL_DATE: "SPECIAL_DATE",
  CUSTOM_BASE: "CUSTOM_BASE",
  invite: "APPOINTMENT_DIRECT",
  week: "WEEK_OPEN",
  return: "RETURN_REMINDER",
  feedback: "POST_SERVICE_FEEDBACK",
};

const CONTACT_TEMPLATE_OPTIONS: Array<{ value: ContactTemplateKey; label: string }> = [
  { value: "APPOINTMENT_DIRECT", label: "Agendamento direto" },
  { value: "APPOINTMENT_BEST_TIMES", label: "Garantir melhores horários" },
  { value: "WEEK_OPEN", label: "Agenda da semana aberta" },
  { value: "WEEK_SCARCITY", label: "Poucos horários na semana" },
  { value: "RETURN_REMINDER", label: "Lembrete de retorno" },
  { value: "RETURN_FREQUENCY", label: "Manter frequência" },
  { value: "INACTIVE_CLIENT", label: "Cliente parado" },
  { value: "COMEBACK_LIGHT", label: "Volta leve" },
  { value: "POST_SERVICE_FEEDBACK", label: "Pós-atendimento/feedback" },
  { value: "POST_SERVICE_NEXT", label: "Pós-atendimento com próximo horário" },
  { value: "CLUB_ACTIVE", label: "Cliente clube ativo" },
  { value: "CLUB_VALUE", label: "Reforço de benefício do clube" },
  { value: "AUTHORITY_CARE", label: "Cuidado profissional" },
  { value: "AUTHORITY_PRESENCE", label: "Presença e imagem" },
  { value: "WEEKEND_READY", label: "Final de semana chegando" },
  { value: "SPECIAL_DATE", label: "Data especial" },
  { value: "CUSTOM_BASE", label: "Personalizado" },
  { value: "APPOINTMENT_INVITE", label: "Convite/agendamento" },
  { value: "CUSTOM", label: "Personalizado" },
  { value: "invite", label: "Agendamento direto" },
  { value: "week", label: "Agenda da semana aberta" },
  { value: "return", label: "Lembrete de retorno" },
  { value: "feedback", label: "Pós-atendimento/feedback" },
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Faltou",
};

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${date} às ${time}`;
}

function toDatetimeLocalValue(date = new Date()) {
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export default function Cliente360Page() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockError, setBlockError] = useState("");
  const [submittingBlock, setSubmittingBlock] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("APPOINTMENT_DIRECT");
  const [copyNotice, setCopyNotice] = useState("");
  const [contactLogs, setContactLogs] = useState<ContactLog[]>([]);
  const [loadingContactLogs, setLoadingContactLogs] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactChannel, setContactChannel] = useState<ContactChannel>("WHATSAPP");
  const [contactTemplateKey, setContactTemplateKey] = useState<ContactTemplateKey>("APPOINTMENT_DIRECT");
  const [contactNote, setContactNote] = useState("");
  const [contactedAt, setContactedAt] = useState(() => toDatetimeLocalValue());
  const [contactError, setContactError] = useState("");
  const [submittingContact, setSubmittingContact] = useState(false);

  const loadContactLogs = useCallback(async () => {
    setLoadingContactLogs(true);
    try {
      const res = await fetch(`/api/admin/clients/${id}/contact-logs`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Erro ao carregar historico de contato.");
      setContactLogs(payload.logs ?? []);
    } catch {
      setContactLogs([]);
    } finally {
      setLoadingContactLogs(false);
    }
  }, [id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/clients/${id}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Erro ao carregar dados do cliente.");
      setData(payload);
      await loadContactLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [id, loadContactLogs]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason || blockReason.trim().length < 5) {
      setBlockError("O motivo deve ter no mínimo 5 caracteres.");
      return;
    }
    setSubmittingBlock(true);
    setBlockError("");
    try {
      const res = await fetch("/api/admin/customers/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, phone: data?.phone, reason: blockReason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao bloquear cliente.");
      setShowBlockModal(false);
      setBlockReason("");
      await loadData();
    } catch (err: unknown) {
      setBlockError(err instanceof Error ? err.message : "Erro ao bloquear cliente.");
    } finally {
      setSubmittingBlock(false);
    }
  };

  const handleUnblock = async () => {
    if (!data?.blockRecord?.id) return;
    const reason = prompt("Motivo do desbloqueio (mínimo 5 caracteres):");
    if (!reason || reason.trim().length < 5) return;

    try {
      const res = await fetch("/api/admin/customers/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: data.blockRecord.id, reason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao desbloquear cliente.");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao desbloquear cliente.");
    }
  };

  const copyWhatsappMessage = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.whatsapp.messages[selectedTemplate]);
    setCopyNotice("Mensagem copiada.");
    window.setTimeout(() => setCopyNotice(""), 2500);
  };

  const handleSendWhatsapp = () => {
    if (!data) return;
    const message = data.whatsapp.messages[selectedTemplate];
    const digits = data.phone.replace(/\D/g, "");
    const intl = digits.startsWith("55") ? digits : `55${digits}`;
    const link = `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
    window.open(link, "_blank", "noopener,noreferrer");
  };

  const openContactModal = () => {
    setContactChannel("WHATSAPP");
    setContactTemplateKey(CONTACT_TEMPLATE_BY_WHATSAPP_TEMPLATE[selectedTemplate]);
    setContactNote("");
    setContactedAt(toDatetimeLocalValue());
    setContactError("");
    setShowContactModal(true);
  };

  const submitContactLog = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittingContact(true);
    setContactError("");
    try {
      const res = await fetch(`/api/admin/clients/${id}/contact-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: contactChannel,
          templateKey: contactTemplateKey,
          note: contactNote || undefined,
          contactedAt: contactedAt ? new Date(contactedAt).toISOString() : undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? payload.error ?? "Erro ao registrar contato.");
      setShowContactModal(false);
      await loadContactLogs();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : "Erro ao registrar contato.");
    } finally {
      setSubmittingContact(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6 text-center py-24 text-stone-500">
        Carregando perfil do cliente...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Link href="/admin/clientes" className="text-sm text-stone-400 hover:text-stone-200 transition-colors">
          ← Voltar para Clientes
        </Link>
        <div className="bg-red-950/20 border border-red-900 rounded-lg p-6 text-red-400 text-sm">
          {error || "Cliente não encontrado."}
        </div>
      </div>
    );
  }

  const lastApptId = data.history.length > 0 ? data.history[0].id : null;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">
      <Link href="/admin/clientes" className="text-sm text-stone-400 hover:text-stone-200 transition-colors">
        ← Clientes
      </Link>

      <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center text-xl font-bold text-amber-400 shrink-0">
            {data.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-stone-100">{data.name}</h1>
              {data.isBlocked && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                  Bloqueado
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 mt-0.5">{formatPhone(data.phone)}</p>
            {data.email && <p className="text-xs text-stone-600 mt-0.5">{data.email}</p>}
            <p className="text-xs text-stone-600 mt-0.5">Cliente desde {formatDate(data.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/admin/agendamentos?customerId=${data.id}`}
            className="px-4 py-2.5 rounded-lg bg-amber-500 text-stone-950 font-bold hover:bg-amber-400 transition-colors text-sm"
          >
            Agendar
          </Link>
          {lastApptId && (
            <Link
              href={`/admin/agendamentos?customerId=${data.id}&sourceAppointmentId=${lastApptId}`}
              className="px-4 py-2.5 rounded-lg bg-stone-800 border border-stone-700 text-stone-200 font-semibold hover:bg-stone-700 transition-colors text-sm"
            >
              Repetir último
            </Link>
          )}
          {data.whatsapp.link && (
            <a
              href={data.whatsapp.link}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-lg bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 font-semibold hover:bg-[#25D366]/20 transition-colors text-sm"
            >
              WhatsApp
            </a>
          )}
          {data.isBlocked ? (
            <button
              type="button"
              onClick={handleUnblock}
              className="px-4 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold hover:bg-emerald-500/20 transition-colors text-sm"
            >
              Desbloquear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowBlockModal(true)}
              className="px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 font-semibold hover:bg-red-500/20 transition-colors text-sm"
            >
              Bloquear Cliente
            </button>
          )}
        </div>
      </div>

      {copyNotice && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {copyNotice}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total gasto" value={formatCurrency(data.metrics.totalSpent)} tone="text-emerald-400" />
        <MetricCard label="Agendamentos" value={String(data.metrics.totalAppointments)} tone="text-stone-200" />
        <MetricCard label="Concluídos" value={String(data.metrics.completedVisits)} tone="text-amber-400" />
        <MetricCard label="Última visita" value={formatDate(data.metrics.lastCompletedVisitAt)} tone="text-stone-200" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard label="Próximo agendamento" value={formatDate(data.metrics.nextAppointmentAt)} tone="text-blue-400" />
        <MetricCard label="Comandas abertas" value={String(data.comandaSummary.open)} tone="text-emerald-400" />
        <MetricCard
          label="Clube"
          value={data.clubSubscription ? `${data.clubSubscription.planName} (${data.clubSubscription.status})` : "Sem assinatura ativa"}
          tone="text-blue-400"
        />
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-bold text-stone-200">WhatsApp manual</h2>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as TemplateKey)}
            className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
          >
            {TEMPLATE_CATEGORIES.map((cat) => (
              <optgroup key={cat.name} label={cat.name}>
                {cat.keys.map((key) => (
                  <option key={key} value={key}>
                    {TEMPLATE_LABELS[key]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <p className="rounded-lg bg-stone-950/60 border border-stone-800 p-3 text-sm text-stone-300 whitespace-pre-wrap">
          {data.whatsapp.messages[selectedTemplate]}
        </p>
        <div className="flex justify-start">
          <button
            type="button"
            onClick={handleSendWhatsapp}
            className="px-4 py-2 rounded-lg bg-[#25D366] text-stone-950 text-sm font-bold hover:bg-[#20ba5a] transition-colors"
          >
            Enviar mensagem
          </button>
        </div>
        <p className="text-xs text-stone-500">
          Abrir WhatsApp não registra contato automaticamente.
        </p>
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-lg p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-base font-bold text-stone-200">Histórico de contato</h2>
          </div>
          <button
            type="button"
            onClick={openContactModal}
            className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 transition-colors"
          >
            Registrar contato feito
          </button>
        </div>

        {loadingContactLogs ? (
          <p className="text-sm text-stone-500">Carregando histórico de contato...</p>
        ) : contactLogs.length === 0 ? (
          <p className="text-sm text-stone-500">Nenhum contato registrado ainda.</p>
        ) : (
          <div className="divide-y divide-stone-800/60">
            {contactLogs.map((log) => (
              <div key={log.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-200">{formatDateTime(log.contactedAt)}</span>
                    <span className="px-2 py-0.5 rounded-full bg-stone-800 text-stone-300 text-[10px] font-bold">
                      {CONTACT_CHANNEL_LABELS[log.channel] ?? log.channel}
                    </span>
                  </div>
                  <p className="text-xs text-stone-400">{log.templateLabel}</p>
                  {log.note && <p className="text-sm text-stone-300">{log.note}</p>}
                </div>
                <p className="text-xs text-stone-500 sm:text-right">
                  Registrado por {log.createdBy.memberName ?? log.createdBy.name}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-800">
          <h2 className="text-base font-bold text-stone-200">Histórico de atendimentos</h2>
        </div>

        {data.history.length === 0 ? (
          <div className="p-8 text-center text-stone-600 text-sm">
            Nenhum agendamento registrado para este cliente.
          </div>
        ) : (
          <div className="divide-y divide-stone-800/50">
            {data.history.map((h) => (
              <div key={h.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-800/10 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-200">{formatDateTime(h.dateTime)}</span>
                    <span className="text-[10px] px-2 py-0.5 font-bold rounded-full uppercase tracking-wider bg-stone-800 text-stone-400">
                      {STATUS_LABEL[h.status] ?? h.status}
                    </span>
                    {h.bookingMode === "FIT_IN" && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold border border-amber-500/30 uppercase tracking-widest">
                        Encaixe
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500">
                    <span className="font-semibold text-stone-400">Barbeiro:</span> {h.professional}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-stone-300 truncate max-w-[260px]">{h.services.join(", ")}</p>
                  <p className="text-[10px] text-stone-500 font-semibold">{formatCurrency(h.totalPrice)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showBlockModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Bloquear Cliente</h3>
            <p className="text-xs text-stone-400">
              Ao bloquear, o cliente e seu número não conseguirão realizar agendamentos públicos nesta barbearia.
            </p>
            <form onSubmit={handleBlockSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-400 mb-1">
                  Motivo do bloqueio
                </label>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Informe o motivo..."
                  rows={3}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-red-500 focus:outline-none"
                  required
                />
              </div>
              {blockError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {blockError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 rounded-lg bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingBlock}
                  className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {submittingBlock ? "Bloqueando..." : "Confirmar Bloqueio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showContactModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Registrar contato feito</h3>
            <form onSubmit={submitContactLog} className="space-y-4">
              <div>
                <label htmlFor="contact-channel" className="block text-xs font-semibold text-stone-400 mb-1">Canal</label>
                <select
                  id="contact-channel"
                  value={contactChannel}
                  onChange={(e) => setContactChannel(e.target.value as ContactChannel)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {Object.entries(CONTACT_CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="contact-template" className="block text-xs font-semibold text-stone-400 mb-1">Template</label>
                <select
                  id="contact-template"
                  value={contactTemplateKey}
                  onChange={(e) => setContactTemplateKey(e.target.value as ContactTemplateKey)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {CONTACT_TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="contacted-at" className="block text-xs font-semibold text-stone-400 mb-1">Data e hora</label>
                <input
                  id="contacted-at"
                  type="datetime-local"
                  value={contactedAt}
                  onChange={(e) => setContactedAt(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="contact-note" className="block text-xs font-semibold text-stone-400 mb-1">Observação opcional</label>
                <textarea
                  id="contact-note"
                  value={contactNote}
                  onChange={(e) => setContactNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>

              {contactError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {contactError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  className="px-4 py-2 rounded-lg bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingContact}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {submittingContact ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">{label}</p>
      <p className={`text-base font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
