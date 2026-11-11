/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-html-link-for-pages */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientNav } from "@/components/admin/clients/ClientNav";
import {
  AssistedWhatsAppQueueDrawer,
  type PendingConsentClientInfo,
  type QueueRecipientItem,
} from "@/components/admin/clients/AssistedWhatsAppQueueDrawer";
import { WHATSAPP_TEMPLATES } from "@/lib/customer-whatsapp-templates";

type ClientFilter =
  | "all"
  | "with_appointment"
  | "without_appointment"
  | "upcoming"
  | "open_comanda"
  | "club"
  | "blocked"
  | "never_contacted"
  | "no_contact_30"
  | "no_contact_60"
  | "no_contact_90"
  | "recently_contacted";

interface ClientStats {
  total: number;
  completed: number;
  cancelled: number;
  noShows: number;
  totalSpent: number;
  lastVisit: string | null;
  nextAppointmentAt: string | null;
  openComandas: number;
  closedComandas: number;
  hasClubSubscription: boolean;
  isBlocked: boolean;
  lastContactedAt: string | null;
  contactLogCount: number;
}

interface ClientWhatsappQueueInfo {
  eligible: boolean;
  consentStatus: "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";
  isValidMobilePhone: boolean;
  inCooldown14d: boolean;
  canRegisterConsentInDrawer: boolean;
  ineligibilityReason:
    | "CONSENT_UNKNOWN"
    | "CONSENT_OPTED_OUT"
    | "INVALID_PHONE"
    | "BLOCKED"
    | "UPCOMING_APPOINTMENT"
    | "RECENT_CONTACT"
    | null;
}

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  createdAt: string;
  stats: ClientStats;
  sources: {
    link: boolean;
    appointment: boolean;
    comanda: boolean;
    club: boolean;
  };
  whatsappQueue?: ClientWhatsappQueueInfo;
}

interface ContactMetrics {
  neverContacted: number;
  noContact30: number;
  recentlyContacted: number;
}

interface SummaryMetrics {
  totalClients: number;
  withoutAppointment: number;
  upcoming: number;
  openComandas: number;
  neverContacted: number;
  noContact30: number;
  noContact60: number;
  noContact90: number;
  recentlyContacted: number;
}

interface QueueSelectionMeta {
  totalFilteredCount: number;
  eligibleInFilterCount: number;
  remainingEligibleInRoundCount: number;
  excludedInRoundCount: number;
  pendingConsentInFilterCount: number;
  ineligibleInFilterCount: number;
  nextEligibleBatchIds: string[];
  hasMoreThanBatchLimit: boolean;
}

const PAGE_SIZE = 30;

const PRIMARY_FILTERS: Array<{ value: ClientFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "with_appointment", label: "Com agendamento" },
  { value: "without_appointment", label: "Sem agendamento" },
  { value: "upcoming", label: "Próximo agendamento" },
];

const SECONDARY_FILTERS: Array<{ value: ClientFilter; label: string }> = [
  { value: "open_comanda", label: "Comanda aberta" },
  { value: "club", label: "Clube" },
  { value: "blocked", label: "Bloqueados" },
  { value: "never_contacted", label: "Nunca contatados" },
  { value: "no_contact_30", label: "Sem contato há 30 dias" },
  { value: "no_contact_60", label: "Sem contato há 60 dias" },
  { value: "no_contact_90", label: "Sem contato há 90 dias" },
  { value: "recently_contacted", label: "Contatados recentemente" },
];

const INELIGIBILITY_LABELS: Record<string, string> = {
  CONSENT_UNKNOWN: "Consentimento pendente",
  CONSENT_OPTED_OUT: "Opt-out marketing",
  INVALID_PHONE: "WhatsApp inválido",
  BLOCKED: "Bloqueado",
  UPCOMING_APPOINTMENT: "Com agendamento futuro",
  RECENT_CONTACT: "Cooldown 14 dias",
};

type ImportStatus = "VALID" | "DUPLICATE" | "DUPLICATE_IN_FILE" | "INVALID";

interface ImportPreviewRow {
  rowNumber: number;
  name: string;
  phoneOriginal: string;
  status: ImportStatus;
  reason: string | null;
}

interface ImportPreview {
  totalRows: number;
  valid: number;
  duplicates: number;
  invalid: number;
  rows: ImportPreviewRow[];
}

interface ImportResult {
  totalRows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  failed: number;
}

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

export default function ClientesPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [contactMetrics, setContactMetrics] = useState<ContactMetrics>({
    neverContacted: 0,
    noContact30: 0,
    recentlyContacted: 0,
  });
  const [summaryMetrics, setSummaryMetrics] = useState<SummaryMetrics | null>(null);
  const [queueSelectionMeta, setQueueSelectionMeta] =
    useState<QueueSelectionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [createError, setCreateError] = useState("");
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Assisted Queue V1 States
  interface UiClientQueuePermissions {
    canViewClients: boolean;
    canManageClients: boolean;
    canOperateWhatsappAssisted: boolean;
  }
  const DEFAULT_DENIED_PERMISSIONS: UiClientQueuePermissions = {
    canViewClients: false,
    canManageClients: false,
    canOperateWhatsappAssisted: false,
  };

  const [uiPermissions, setUiPermissions] = useState<UiClientQueuePermissions>(
    DEFAULT_DENIED_PERMISSIONS
  );
  const [clientsAccessDenied, setClientsAccessDenied] = useState<boolean>(false);
  const [currentBarbershopId, setCurrentBarbershopId] = useState<string | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [batchTemplateKey, setBatchTemplateKey] = useState<string>("RETURN_REMINDER");

  const getRoundStorageKey = useCallback((shopId?: string | null) => {
    return shopId ? `tb_crm_work_round_${shopId}` : "tb_crm_work_round";
  }, []);
  const getProcessedStorageKey = useCallback((shopId?: string | null) => {
    return shopId ? `tb_crm_round_processed_${shopId}` : "tb_crm_round_processed";
  }, []);

  const [workRoundId, setWorkRoundId] = useState<string>(() => {
    return `round_${Date.now()}`;
  });
  const [roundProcessedIds, setRoundProcessedIds] = useState<string[]>([]);
  const [activeQueueCampaignId, setActiveQueueCampaignId] = useState<string | null>(null);
  const [activeQueueName, setActiveQueueName] = useState<string>("");
  const [activeQueueStatus, setActiveQueueStatus] = useState<string>("READY");
  const [activeQueueRecipients, setActiveQueueRecipients] = useState<QueueRecipientItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [pendingConsentClient, setPendingConsentClient] =
    useState<PendingConsentClientInfo | null>(null);
  const [preparingQueue, setPreparingQueue] = useState<boolean>(false);
  const [queueBannerError, setQueueBannerError] = useState<string | null>(null);
  const checkedActiveQueueRef = useRef<boolean>(false);
  const activeBarbershopRef = useRef<string | null>(null);
  const tenantEpochRef = useRef<number>(0);
  const clientsSeqRef = useRef<number>(0);
  const clientsAbortRef = useRef<AbortController | null>(null);
  const activeQueueSeqRef = useRef<number>(0);
  const activeQueueAbortRef = useRef<AbortController | null>(null);

  // G23-03 / G24-03: Isola estado e invalida requisições concorrentes ao alternar barbearia no mesmo navegador
  const handleBarbershopSwitch = useCallback(
    (newShopId: string) => {
      activeBarbershopRef.current = newShopId;
      tenantEpochRef.current += 1;
      activeQueueAbortRef.current?.abort();
      activeQueueSeqRef.current += 1;
      checkedActiveQueueRef.current = false;

      setCurrentBarbershopId(newShopId);
      setSelectedQueueIds([]);
      setActiveQueueCampaignId(null);
      setActiveQueueName("");
      setActiveQueueStatus("READY");
      setActiveQueueRecipients([]);
      setPendingConsentClient(null);
      setSummaryMetrics(null);
      setQueueSelectionMeta(null);
      setDrawerOpen(false);
      setQueueBannerError(null);

      // Restaura ou inicializa a rodada da nova barbearia
      const roundKey = getRoundStorageKey(newShopId);
      const procKey = getProcessedStorageKey(newShopId);
      let loadedRound = `round_${Date.now()}`;
      let loadedProcessed: string[] = [];

      if (typeof window !== "undefined") {
        try {
          const savedRound = localStorage.getItem(roundKey);
          if (savedRound) {
            loadedRound = savedRound;
          } else {
            localStorage.setItem(roundKey, loadedRound);
          }
          const savedProcessed = localStorage.getItem(procKey);
          if (savedProcessed) {
            loadedProcessed = JSON.parse(savedProcessed);
          }
        } catch {
          // localStorage indisponível
        }
      }

      setWorkRoundId(loadedRound);
      setRoundProcessedIds(Array.isArray(loadedProcessed) ? loadedProcessed : []);
    },
    [getProcessedStorageKey, getRoundStorageKey]
  );

  const checkActiveAssistedCampaign = useCallback(
    async (expectedShopId?: string | null, expectedEpoch?: number) => {
      activeQueueAbortRef.current?.abort();
      const controller = new AbortController();
      activeQueueAbortRef.current = controller;
      activeQueueSeqRef.current += 1;
      const reqSeq = activeQueueSeqRef.current;

      try {
        const targetShopId = expectedShopId ?? activeBarbershopRef.current;
        let currentRound = workRoundId;
        const storageKey = getRoundStorageKey(targetShopId);
        if (typeof window !== "undefined") {
          try {
            const saved = localStorage.getItem(storageKey);
            if (saved) currentRound = saved;
          } catch {
            // localStorage indisponível
          }
        }
        const res = await fetch(
          `/api/admin/clients/reactivation/manual-campaigns/active?origin=CLIENTS_BASE_ASSISTED_QUEUE&workRoundId=${encodeURIComponent(currentRound)}`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted || reqSeq !== activeQueueSeqRef.current) {
          return;
        }
        if (expectedEpoch !== undefined && expectedEpoch !== tenantEpochRef.current) {
          return;
        }

        if (!res.ok) {
          if (res.status === 403) {
            setActiveQueueCampaignId(null);
            setActiveQueueRecipients([]);
            setDrawerOpen(false);
          }
          return;
        }

        const data = await res.json();
        if (controller.signal.aborted || reqSeq !== activeQueueSeqRef.current) {
          return;
        }
        if (expectedEpoch !== undefined && expectedEpoch !== tenantEpochRef.current) {
          return;
        }

        // G24-03: Nunca sobrescrever estado da barbearia atual com resposta tardia de outra barbearia
        if (
          data?.barbershopId &&
          activeBarbershopRef.current &&
          data.barbershopId !== activeBarbershopRef.current
        ) {
          return;
        }
        if (expectedShopId && data?.barbershopId && data.barbershopId !== expectedShopId) {
          return;
        }

        // G24-02: Fail-closed se servidor indicar ausência de permissão operacional
        if (
          data?.permissions &&
          (!data.permissions.canViewClients ||
            !data.permissions.canOperateWhatsappAssisted)
        ) {
          setActiveQueueCampaignId(null);
          setActiveQueueRecipients([]);
          setDrawerOpen(false);
          return;
        }

        const resolvedShopId = data?.barbershopId || activeBarbershopRef.current;
        const effectiveStorageKey = getRoundStorageKey(resolvedShopId);

        if (data?.activeCampaign) {
          setActiveQueueCampaignId(data.activeCampaign.id);
          setActiveQueueName(data.activeCampaign.name || "Fila Assistida");
          setActiveQueueStatus(data.activeCampaign.status || "IN_PROGRESS");
          setActiveQueueRecipients(data.activeCampaign.recipients || []);
          if (data.activeCampaign.templateKey) {
            setBatchTemplateKey(data.activeCampaign.templateKey);
          }
          if (data.activeCampaign.workRoundId) {
            setWorkRoundId(data.activeCampaign.workRoundId);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(
                  effectiveStorageKey,
                  data.activeCampaign.workRoundId
                );
              } catch {
                // localStorage indisponível
              }
            }
          }
        } else {
          setActiveQueueCampaignId(null);
          setActiveQueueRecipients([]);
        }

        // G21-03 / G22-02: Reconstitui os clientes processados na rodada persistida
        if (data?.workRound) {
          if (data.workRound.workRoundId) {
            setWorkRoundId(data.workRound.workRoundId);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(
                  effectiveStorageKey,
                  data.workRound.workRoundId
                );
              } catch {
                // localStorage indisponível
              }
            }
          }
          if (
            Array.isArray(data.workRound.processedCustomerIds) &&
            data.workRound.processedCustomerIds.length > 0
          ) {
            setRoundProcessedIds((prev) => {
              const next = Array.from(
                new Set([...prev, ...data.workRound.processedCustomerIds])
              );
              const pKey = getProcessedStorageKey(resolvedShopId);
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem(pKey, JSON.stringify(next));
                } catch {
                  // ignore
                }
              }
              return next;
            });
          }
        }
      } catch {
        // Ignore background active check or abort error
      }
    },
    [getProcessedStorageKey, getRoundStorageKey, workRoundId]
  );

  const fetchClients = useCallback(
    async (
      q: string,
      p: number,
      f: ClientFilter,
      excludedIds: string[] = roundProcessedIds
    ) => {
      clientsAbortRef.current?.abort();
      const controller = new AbortController();
      clientsAbortRef.current = controller;
      clientsSeqRef.current += 1;
      const reqSeq = clientsSeqRef.current;

      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          pageSize: String(PAGE_SIZE),
          filter: f,
        });
        if (q) params.set("search", q);
        if (excludedIds.length > 0) {
          params.set("excludeIds", excludedIds.join(","));
        }
        const res = await fetch(`/api/admin/clients?${params}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted || reqSeq !== clientsSeqRef.current) {
          return;
        }

        if (!res.ok) {
          if (res.status === 403) {
            setClientsAccessDenied(true);
            setUiPermissions({
              canViewClients: false,
              canManageClients: false,
              canOperateWhatsappAssisted: false,
            });
            setClients([]);
            setTotal(0);
            setSummaryMetrics(null);
            setQueueSelectionMeta(null);
            setSelectedQueueIds([]);
            setActiveQueueCampaignId(null);
            setActiveQueueRecipients([]);
            setPendingConsentClient(null);
            setDrawerOpen(false);
          }
          return;
        }

        const data = await res.json();
        if (controller.signal.aborted || reqSeq !== clientsSeqRef.current) {
          return;
        }

        const nextPermissions: UiClientQueuePermissions =
          data?.permissions && typeof data.permissions === "object"
            ? {
                canViewClients: Boolean(data.permissions.canViewClients),
                canManageClients: Boolean(data.permissions.canManageClients),
                canOperateWhatsappAssisted: Boolean(
                  data.permissions.canViewClients &&
                    data.permissions.canOperateWhatsappAssisted
                ),
              }
            : {
                canViewClients: false,
                canManageClients: false,
                canOperateWhatsappAssisted: false,
              };

        if (data?.barbershopId && data.barbershopId !== activeBarbershopRef.current) {
          handleBarbershopSwitch(data.barbershopId);
        }

        if (!nextPermissions.canViewClients) {
          setClientsAccessDenied(true);
          setUiPermissions(nextPermissions);
          setClients([]);
          setTotal(0);
          setSummaryMetrics(null);
          setQueueSelectionMeta(null);
          setSelectedQueueIds([]);
          setActiveQueueCampaignId(null);
          setActiveQueueRecipients([]);
          setPendingConsentClient(null);
          setDrawerOpen(false);
          return;
        }

        setClientsAccessDenied(false);
        setUiPermissions(nextPermissions);
        setClients(data.clients ?? []);
        setTotal(data.total ?? 0);
        setContactMetrics(
          data.contactMetrics ?? {
            neverContacted: 0,
            noContact30: 0,
            recentlyContacted: 0,
          }
        );
        if (data.summaryMetrics) {
          setSummaryMetrics(data.summaryMetrics);
        } else {
          setSummaryMetrics(null);
        }
        if (data.queueSelectionMeta) {
          setQueueSelectionMeta(data.queueSelectionMeta);
        } else {
          setQueueSelectionMeta(null);
        }

        if (!nextPermissions.canOperateWhatsappAssisted) {
          setSelectedQueueIds([]);
          setActiveQueueCampaignId(null);
          setActiveQueueRecipients([]);
        } else if (
          (data.queueSelectionMeta || nextPermissions.canOperateWhatsappAssisted) &&
          !checkedActiveQueueRef.current
        ) {
          checkedActiveQueueRef.current = true;
          void checkActiveAssistedCampaign(
            data?.barbershopId || activeBarbershopRef.current,
            tenantEpochRef.current
          );
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          return;
        }
      } finally {
        if (reqSeq === clientsSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [checkActiveAssistedCampaign, handleBarbershopSwitch, roundProcessedIds]
  );

  useEffect(() => {
    return () => {
      clientsAbortRef.current?.abort();
      activeQueueAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchClients(search, page, filter, roundProcessedIds);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, page, filter, roundProcessedIds, fetchClients]);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // G22-02 / G23-03: Encerramento consciente da rodada (apenas por ação deliberada do operador)
  const handleStartNewRound = useCallback(() => {
    const newRound = `round_${Date.now()}`;
    setWorkRoundId(newRound);
    setRoundProcessedIds([]);
    const key = getRoundStorageKey(currentBarbershopId);
    const procKey = getProcessedStorageKey(currentBarbershopId);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(key, newRound);
        localStorage.setItem(procKey, JSON.stringify([]));
      } catch {
        // localStorage indisponível
      }
    }
    void fetchClients(search, 1, filter, []);
  }, [currentBarbershopId, fetchClients, filter, getProcessedStorageKey, getRoundStorageKey, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // G1-C10: Concilia os 7 cards com o backend sobre toda a base da barbearia (com fallback seguro)
  const metrics = useMemo(
    () => ({
      total: summaryMetrics?.totalClients ?? total,
      manual:
        summaryMetrics?.withoutAppointment ??
        clients.filter((client) => !client.sources.appointment).length,
      upcoming:
        summaryMetrics?.upcoming ??
        clients.filter((client) => client.stats.nextAppointmentAt).length,
      openComandas:
        summaryMetrics?.openComandas ??
        clients.filter((client) => client.stats.openComandas > 0).length,
      neverContacted:
        summaryMetrics?.neverContacted ?? contactMetrics.neverContacted,
      noContact30: summaryMetrics?.noContact30 ?? contactMetrics.noContact30,
      recentlyContacted:
        summaryMetrics?.recentlyContacted ?? contactMetrics.recentlyContacted,
    }),
    [clients, contactMetrics, summaryMetrics, total]
  );

  const toggleSelectClientForQueue = (clientId: string) => {
    setQueueBannerError(null);
    setSelectedQueueIds((prev) => {
      if (prev.includes(clientId)) {
        return prev.filter((id) => id !== clientId);
      }
      if (prev.length >= 50) {
        setQueueBannerError("O limite máximo por fila é de 50 clientes.");
        return prev;
      }
      return [...prev, clientId];
    });
  };

  const prepareAndOpenQueue = async (
    customerIds: string[],
    templateToUse = batchTemplateKey,
    customQueueName?: string
  ) => {
    if (!uiPermissions.canViewClients || !uiPermissions.canOperateWhatsappAssisted) {
      setQueueBannerError(
        "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para iniciar a fila assistida."
      );
      return;
    }
    if (customerIds.length === 0) return;
    const startEpoch = tenantEpochRef.current;
    const startShopId = activeBarbershopRef.current;
    setPreparingQueue(true);
    setQueueBannerError(null);

    try {
      const requestKey = `queue_${workRoundId}_${Date.now()}_${customerIds.length}`;
      const res = await fetch(
        "/api/admin/clients/reactivation/manual-campaigns",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey,
            selectedCustomerIds: customerIds.slice(0, 50),
            templateKey: templateToUse,
            name:
              customQueueName ||
              `Fila Base de Clientes (${
                customerIds.length === 1
                  ? "Individual"
                  : `${customerIds.length} clientes`
              })`,
            origin: "CLIENTS_BASE_ASSISTED_QUEUE",
            sourceFilter: filter,
            workRoundId,
          }),
        }
      );

      const payload = await res.json();
      if (
        startEpoch !== tenantEpochRef.current ||
        startShopId !== activeBarbershopRef.current
      ) {
        return;
      }
      if (!res.ok) {
        if (
          payload.error === "ACTIVE_QUEUE_ALREADY_EXISTS" ||
          payload.code === "ACTIVE_QUEUE_ALREADY_EXISTS"
        ) {
          await checkActiveAssistedCampaign(
            activeBarbershopRef.current,
            tenantEpochRef.current
          );
          if (
            startEpoch === tenantEpochRef.current &&
            startShopId === activeBarbershopRef.current
          ) {
            setDrawerOpen(true);
          }
          return;
        }
        throw new Error(
          payload.message ||
            payload.error ||
            "Não foi possível preparar a fila assistida."
        );
      }

      if (!payload.accepted || payload.accepted.length === 0) {
        const reasonMsg =
          payload.rejected?.[0]?.reasonDetail ||
          "Nenhum cliente selecionado atende aos critérios de elegibilidade no momento.";
        throw new Error(reasonMsg);
      }

      const mappedRecipients: QueueRecipientItem[] = payload.accepted.map(
        (r: {
          recipientId: string;
          queueIndex?: number;
          customerId: string;
          customerName: string;
          customerPhone: string;
          dispatchStatus: QueueRecipientItem["dispatchStatus"];
          previewMessage: string;
        }, idx: number) => ({
          recipientId: r.recipientId,
          queueIndex: r.queueIndex ?? idx,
          customerId: r.customerId,
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          dispatchStatus: r.dispatchStatus || "READY",
          templateKey: templateToUse,
          previewMessage: r.previewMessage,
        })
      );

      setActiveQueueCampaignId(payload.campaign?.id || null);
      setActiveQueueName(payload.campaign?.name || "Fila Assistida");
      setActiveQueueStatus(payload.campaign?.status || "READY");
      setActiveQueueRecipients(mappedRecipients);
      setPendingConsentClient(null);
      setSelectedQueueIds([]);
      setDrawerOpen(true);
    } catch (err) {
      setQueueBannerError(
        err instanceof Error ? err.message : "Erro ao iniciar fila assistida."
      );
    } finally {
      setPreparingQueue(false);
    }
  };

  const handleOpenConsentGateForClient = (client: Client) => {
    if (!uiPermissions.canViewClients || !uiPermissions.canManageClients) {
      setQueueBannerError(
        "Permissão 'CLIENTS_MANAGE' necessária para registrar ou alterar consentimento de marketing."
      );
      return;
    }
    setPendingConsentClient({
      id: client.id,
      name: client.name,
      phone: client.phone,
      lastContactedAt: client.stats.lastContactedAt,
      completedVisits: client.stats.completed,
      hasClubSubscription: client.stats.hasClubSubscription,
    });
    setDrawerOpen(true);
  };

  const handleRecipientUpdated = (
    recipientId: string,
    updates: Partial<QueueRecipientItem>,
    nextCampaignStatus?: string
  ) => {
    setActiveQueueRecipients((prev) =>
      prev.map((item) =>
        item.recipientId === recipientId ? { ...item, ...updates } : item
      )
    );
    if (nextCampaignStatus) {
      setActiveQueueStatus(nextCampaignStatus);
    }
  };

  const handleClientProcessedInRound = (customerId: string) => {
    setRoundProcessedIds((prev) => {
      const next = prev.includes(customerId) ? prev : [...prev, customerId];
      void fetchClients(search, page, filter, next);
      return next;
    });
  };

  const handleStartNextBatchInRound = () => {
    const nextIds = queueSelectionMeta?.nextEligibleBatchIds ?? [];
    if (nextIds.length > 0) {
      void prepareAndOpenQueue(
        nextIds,
        batchTemplateKey,
        `Fila Base de Clientes — Lote seguinte (${nextIds.length} clientes)`
      );
    }
  };

  const pendingActiveCount = useMemo(
    () =>
      activeQueueRecipients.filter(
        (r) =>
          r.dispatchStatus === "READY" || r.dispatchStatus === "WHATSAPP_OPENED"
      ).length,
    [activeQueueRecipients]
  );

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittingCreate(true);
    setCreateError("");
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          phone: newPhone,
          email: newEmail || undefined,
          birthDate: newBirthDate || undefined,
          notes: newNotes || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message ?? payload.error ?? "Erro ao cadastrar cliente.");
      }
      setShowCreateModal(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      setNewBirthDate("");
      setNewNotes("");
      await fetchClients(search, page, filter);
      router.push(`/admin/clientes/${payload.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Erro ao cadastrar cliente.");
    } finally {
      setSubmittingCreate(false);
    }
  };

  const openImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError("");
    setShowImportModal(true);
  };

  const requestImport = async (endpoint: "preview" | "confirm") => {
    if (!importFile) throw new Error("Selecione um arquivo CSV ou XLSX.");
    const formData = new FormData();
    formData.append("file", importFile);
    const response = await fetch(`/api/admin/clients/import/${endpoint}`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Falha ao importar clientes.");
    return payload;
  };

  const loadImportPreview = async () => {
    setLoadingPreview(true);
    setImportError("");
    try {
      setImportPreview(await requestImport("preview"));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Falha ao analisar arquivo.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const confirmImport = async () => {
    if (confirmingImport || !importPreview?.valid) return;
    setConfirmingImport(true);
    setImportError("");
    try {
      setImportResult(await requestImport("confirm"));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Falha ao importar clientes.");
    } finally {
      setConfirmingImport(false);
    }
  };

  const finishImport = async () => {
    setShowImportModal(false);
    setPage(1);
    await fetchClients(search, 1, filter);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Clientes</h1>
          <p className="text-stone-500 text-sm mt-1">
            CRM base com clientes vinculados, legados e cadastro manual.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {uiPermissions.canManageClients && (
            <>
              <button
                type="button"
                onClick={openImport}
                className="px-4 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-200 text-sm font-bold hover:bg-stone-800"
              >
                Importar clientes
              </button>
            </>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu((current) => !current)}
              className="px-4 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-200 text-sm font-bold hover:bg-stone-800"
              aria-expanded={showExportMenu}
            >
              Exportar clientes
            </button>
            {showExportMenu && (
              <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-stone-700 bg-stone-900 shadow-xl">
                <a
                  href="/api/admin/clients/export?format=xlsx"
                  className="block px-4 py-3 text-sm text-stone-200 hover:bg-stone-800"
                  onClick={() => setShowExportMenu(false)}
                >
                  Excel (.xlsx)
                </a>
                <a
                  href="/api/admin/clients/export?format=csv"
                  className="block px-4 py-3 text-sm text-stone-200 hover:bg-stone-800"
                  onClick={() => setShowExportMenu(false)}
                >
                  CSV (.csv)
                </a>
              </div>
            )}
          </div>
          {uiPermissions.canManageClients && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 transition-colors"
            >
              Novo cliente
            </button>
          )}
        </div>
      </div>

      <ClientNav />

      {clientsAccessDenied && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm"
        >
          Acesso restrito aos dados da Base de Clientes. Permissão &apos;CLIENTS_VIEW&apos; necessária.
        </div>
      )}

      {/* Active Assisted Queue Resume Banner */}
      {uiPermissions.canOperateWhatsappAssisted &&
        activeQueueCampaignId &&
        pendingActiveCount > 0 &&
        activeQueueStatus !== "CANCELLED" &&
        activeQueueStatus !== "COMPLETED" && (
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                Fila de WhatsApp Assistido em andamento
              </p>
              <p className="text-sm text-stone-200 mt-0.5">
                <strong>{activeQueueName}</strong> — {pendingActiveCount} de{" "}
                {activeQueueRecipients.length} cliente(s) pendente(s) para envio.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingConsentClient(null);
                  setDrawerOpen(true);
                }}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-stone-950 text-xs font-bold hover:bg-emerald-400"
              >
                Retomar fila ({pendingActiveCount})
              </button>
            </div>
          </div>
        )}

      {/* G22-02: Banner de Rodada Persistida com opção consciente de iniciar nova rodada */}
      {uiPermissions.canOperateWhatsappAssisted &&
        (!activeQueueCampaignId ||
          pendingActiveCount === 0 ||
          activeQueueStatus === "CANCELLED" ||
          activeQueueStatus === "COMPLETED") &&
        roundProcessedIds.length > 0 && (
          <div className="p-4 rounded-xl bg-stone-900 border border-stone-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Rodada em Andamento
              </p>
              <p className="text-sm text-stone-300 mt-0.5">
                {roundProcessedIds.length} cliente(s) processado(s) neste ciclo (clientes pulados e contatados ocultados para evitar reenvio).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleStartNewRound}
                className="px-3 py-1.5 rounded-lg border border-stone-700 bg-stone-800 text-stone-200 text-xs font-semibold hover:bg-stone-700"
              >
                Iniciar nova rodada
              </button>
            </div>
          </div>
        )}

      {/* 7 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Clientes</p>
          <p className="text-xl font-bold text-stone-100">{metrics.total}</p>
          {filter !== "all" && summaryMetrics && (
            <p className="text-[10px] text-stone-500 mt-0.5">
              Filtro atual: {total}
            </p>
          )}
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Sem agendamento</p>
          <p className="text-xl font-bold text-amber-400">{metrics.manual}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Futuros</p>
          <p className="text-xl font-bold text-blue-400">{metrics.upcoming}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Comanda aberta</p>
          <p className="text-xl font-bold text-emerald-400">{metrics.openComandas}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Nunca contatados</p>
          <p className="text-xl font-bold text-red-300">{metrics.neverContacted}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Sem contato há 30 dias</p>
          <p className="text-xl font-bold text-orange-300">{metrics.noContact30}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Contatados recentemente</p>
          <p className="text-xl font-bold text-cyan-300">{metrics.recentlyContacted}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail..."
            title="Buscar clientes"
            className="w-full max-w-md bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-2.5 text-stone-100 placeholder-stone-600 focus:border-amber-500/80 focus:outline-none transition-colors text-sm"
          />

          {/* Batch Assisted Queue Action Bar */}
          {uiPermissions.canOperateWhatsappAssisted &&
            (selectedQueueIds.length > 0 ||
              (queueSelectionMeta &&
                queueSelectionMeta.remainingEligibleInRoundCount > 0)) && (
            <div className="flex flex-wrap items-center gap-2 bg-stone-900/90 border border-stone-800 rounded-lg p-2">
              <select
                aria-label="Modelo padrão da fila"
                value={batchTemplateKey}
                onChange={(e) => setBatchTemplateKey(e.target.value)}
                className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-stone-200"
              >
                {WHATSAPP_TEMPLATES.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.label}
                  </option>
                ))}
              </select>

              {selectedQueueIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    disabled={preparingQueue}
                    onClick={() => void prepareAndOpenQueue(selectedQueueIds)}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-stone-950 text-xs font-bold hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {preparingQueue
                      ? "Preparando fila..."
                      : `Iniciar fila com selecionados (${selectedQueueIds.length}/50)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedQueueIds([])}
                    className="px-2.5 py-1.5 rounded-lg bg-stone-800 text-stone-300 text-xs hover:text-white"
                  >
                    Limpar seleção
                  </button>
                </>
              ) : (
                queueSelectionMeta && (
                  <button
                    type="button"
                    disabled={preparingQueue}
                    onClick={() =>
                      void prepareAndOpenQueue(
                        queueSelectionMeta.nextEligibleBatchIds
                      )
                    }
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-stone-950 text-xs font-bold hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {preparingQueue
                      ? "Preparando fila..."
                      : queueSelectionMeta.hasMoreThanBatchLimit
                      ? `Iniciar fila WhatsApp (Lote de 50 de ${queueSelectionMeta.remainingEligibleInRoundCount} elegíveis)`
                      : `Iniciar fila WhatsApp (${queueSelectionMeta.remainingEligibleInRoundCount} elegíveis)`}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {queueBannerError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center justify-between"
          >
            <span>{queueBannerError}</span>
            <button
              type="button"
              onClick={() => setQueueBannerError(null)}
              className="text-red-300 underline ml-3"
            >
              Fechar
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {PRIMARY_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                filter === item.value
                  ? "bg-amber-500 text-stone-950 border-amber-500"
                  : "bg-stone-900 text-stone-400 border-stone-800 hover:text-stone-200"
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowMoreFilters(!showMoreFilters)}
            aria-expanded={showMoreFilters}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
              SECONDARY_FILTERS.some((f) => f.value === filter)
                ? "bg-stone-800 text-amber-400 border-amber-500/50"
                : "bg-stone-900 text-stone-400 border-stone-800 hover:text-stone-200"
            }`}
          >
            <span>Mais filtros</span>
            {SECONDARY_FILTERS.some((f) => f.value === filter) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
            <span className="text-[10px]">{showMoreFilters ? "▲" : "▼"}</span>
          </button>
        </div>

        {showMoreFilters && (
          <div className="p-3 bg-stone-950/60 border border-stone-800/80 rounded-lg flex flex-wrap gap-2 animate-in fade-in duration-150">
            {SECONDARY_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  filter === item.value
                    ? "bg-amber-500 text-stone-950 border-amber-500"
                    : "bg-stone-900 text-stone-400 border-stone-800 hover:text-stone-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-stone-600 text-sm">
            Carregando...
          </div>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <p className="text-stone-400 font-semibold">Nenhum cliente encontrado.</p>
            <p className="text-xs text-stone-600">
              Cadastre um cliente manualmente ou ajuste a busca e os filtros.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[1fr_130px_120px_110px_130px_280px] gap-3 px-5 py-3 border-b border-stone-800 text-[10px] uppercase tracking-wider text-stone-600 font-semibold">
              <span>Cliente</span>
              <span>Última visita</span>
              <span>Próximo</span>
              <span className="text-right">Total gasto</span>
              <span>Status</span>
              <span className="text-right">Ações</span>
            </div>
            <div className="divide-y divide-stone-800/60">
              {clients.map((client) => {
                const contactLabel = client.stats.lastContactedAt
                  ? `Último contato: ${formatDate(client.stats.lastContactedAt)}`
                  : "Nunca contatado";
                const queueInfo = client.whatsappQueue;
                const isSelected = selectedQueueIds.includes(client.id);
                const ineligibilityLabel = queueInfo?.ineligibilityReason
                  ? INELIGIBILITY_LABELS[queueInfo.ineligibilityReason] ||
                    queueInfo.ineligibilityReason
                  : null;

                return (
                  <div
                    key={client.id}
                    className="px-5 py-4 flex flex-col lg:grid lg:grid-cols-[1fr_130px_120px_110px_130px_280px] gap-3 lg:items-center hover:bg-stone-800/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {uiPermissions.canOperateWhatsappAssisted && queueInfo && (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${client.name} para fila`}
                          checked={isSelected}
                          disabled={
                            !queueInfo.eligible ||
                            (!isSelected && selectedQueueIds.length >= 50)
                          }
                          onChange={() => toggleSelectClientForQueue(client.id)}
                          className="rounded border-stone-700 bg-stone-950"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/clientes/${client.id}`)}
                        className="text-left flex items-center gap-3 min-w-0 flex-1"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-xs font-bold text-amber-400">
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-200 truncate">
                            {client.name}
                          </p>
                          <p className="text-xs text-stone-500">
                            {formatPhone(client.phone)}
                          </p>
                          <p
                            className={`text-[11px] ${
                              client.stats.lastContactedAt
                                ? "text-cyan-400"
                                : "text-red-300"
                            }`}
                          >
                            {contactLabel}
                          </p>
                          {client.email && (
                            <p className="text-[11px] text-stone-600 truncate">
                              {client.email}
                            </p>
                          )}
                        </div>
                      </button>
                    </div>

                    <p className="text-xs text-stone-500">{formatDate(client.stats.lastVisit)}</p>
                    <p className="text-xs text-stone-500">{formatDate(client.stats.nextAppointmentAt)}</p>
                    <p className="text-sm font-semibold text-amber-400 lg:text-right">
                      {formatCurrency(client.stats.totalSpent)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {!client.sources.appointment && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-800 text-stone-400">
                          Manual
                        </span>
                      )}
                      {client.stats.openComandas > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                          Comanda
                        </span>
                      )}
                      {client.stats.hasClubSubscription && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400">
                          Clube
                        </span>
                      )}
                      {client.stats.isBlocked && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400">
                          Bloqueado
                        </span>
                      )}
                      {ineligibilityLabel && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-800/80 text-stone-400 border border-stone-700">
                          {ineligibilityLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-start lg:justify-end gap-2">
                      {queueInfo &&
                        (uiPermissions.canOperateWhatsappAssisted ||
                          uiPermissions.canManageClients) && (
                          <>
                            {queueInfo.eligible ? (
                              uiPermissions.canOperateWhatsappAssisted ? (
                                <button
                                  type="button"
                                  disabled={preparingQueue}
                                  onClick={() =>
                                    void prepareAndOpenQueue(
                                      [client.id],
                                      batchTemplateKey,
                                      `Contato Assistido — ${client.name}`
                                    )
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/25 transition-colors"
                                >
                                  WhatsApp Assistido
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  title="Permissão WHATSAPP_ASSISTED_OPERATE necessária"
                                  className="px-3 py-1.5 rounded-lg bg-stone-900 text-stone-600 border border-stone-800 text-xs font-semibold cursor-not-allowed"
                                >
                                  Indisponível
                                </button>
                              )
                            ) : queueInfo.canRegisterConsentInDrawer ? (
                              uiPermissions.canManageClients ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenConsentGateForClient(client)
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/25 transition-colors"
                                >
                                  Autorizar WhatsApp
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  title="Permissão CLIENTS_MANAGE necessária para registrar consentimento"
                                  className="px-3 py-1.5 rounded-lg bg-stone-900 text-stone-600 border border-stone-800 text-xs font-semibold cursor-not-allowed"
                                >
                                  Indisponível
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                disabled
                                title={ineligibilityLabel || "Inelegível para fila"}
                                className="px-3 py-1.5 rounded-lg bg-stone-900 text-stone-600 border border-stone-800 text-xs font-semibold cursor-not-allowed"
                              >
                                Indisponível
                              </button>
                            )}
                          </>
                        )}
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/clientes/reativacao?search=${encodeURIComponent(client.name)}`)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold hover:bg-amber-500/20 transition-colors"
                      >
                        Reativar
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/clientes/${client.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-stone-950 text-stone-300 border border-stone-800 text-xs font-bold hover:bg-stone-800 transition-colors"
                      >
                        Ficha
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-stone-800">
                <p className="text-xs text-stone-600">
                  Página {page} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Assisted WhatsApp Queue Drawer */}
      <AssistedWhatsAppQueueDrawer
        open={drawerOpen}
        canViewClients={uiPermissions.canViewClients}
        canManageClients={uiPermissions.canManageClients}
        canOperateWhatsappAssisted={uiPermissions.canOperateWhatsappAssisted}
        campaignId={activeQueueCampaignId}
        campaignName={activeQueueName}
        campaignStatus={activeQueueStatus}
        initialTemplateKey={batchTemplateKey}
        recipients={activeQueueRecipients}
        pendingConsentClient={pendingConsentClient}
        remainingEligibleInRoundCount={
          queueSelectionMeta?.remainingEligibleInRoundCount ?? 0
        }
        onCloseKeepProgress={() => {
          setDrawerOpen(false);
          setPendingConsentClient(null);
        }}
        onRecipientUpdated={handleRecipientUpdated}
        onClientConfirmedSent={handleClientProcessedInRound}
        onClientSkipped={handleClientProcessedInRound}
        onCampaignCancelled={() => {
          setActiveQueueStatus("CANCELLED");
          setActiveQueueCampaignId(null);
          setActiveQueueRecipients([]);
          setRoundProcessedIds([]);
          setWorkRoundId(`round_${Date.now()}`);
          setDrawerOpen(false);
        }}
        onConsentRegisteredAndStartQueue={async (customerId, tplKey) => {
          await fetchClients(search, page, filter, roundProcessedIds);
          if (!uiPermissions.canOperateWhatsappAssisted) {
            setPendingConsentClient(null);
            setDrawerOpen(false);
            return;
          }
          await prepareAndOpenQueue(
            [customerId],
            tplKey,
            "Contato Assistido (Consentimento registrado)"
          );
        }}
        onStartNextBatchInRound={handleStartNextBatchInRound}
      />

      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Novo cliente</h3>
            <form onSubmit={submitCreate} className="space-y-4">
              <div>
                <label htmlFor="new-client-name" className="block text-xs font-semibold text-stone-400 mb-1">Nome</label>
                <input
                  id="new-client-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-client-phone" className="block text-xs font-semibold text-stone-400 mb-1">WhatsApp</label>
                <input
                  id="new-client-phone"
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Ex: (17) 99108-9190"
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-client-email" className="block text-xs font-semibold text-stone-400 mb-1">E-mail opcional</label>
                <input
                  id="new-client-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="new-client-birth-date" className="block text-xs font-semibold text-stone-400 mb-1">Data de nascimento opcional</label>
                <input
                  id="new-client-birth-date"
                  type="date"
                  min="1900-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={newBirthDate}
                  onChange={(e) => setNewBirthDate(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="new-client-notes" className="block text-xs font-semibold text-stone-400 mb-1">Observações opcionais</label>
                <textarea
                  id="new-client-notes"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
                <p className="mt-1 text-right text-[10px] text-stone-600">{newNotes.length}/1000</p>
              </div>

              {createError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {submittingCreate ? "Salvando..." : "Salvar cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-6">
            {!importPreview && !importResult && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-bold text-stone-100">Importar clientes</h3>
                  <p className="mt-1 text-sm text-stone-400">
                    Envie uma planilha CSV ou Excel com até 1.000 clientes.
                  </p>
                </div>
                <div className="rounded-lg border border-dashed border-stone-700 bg-stone-950/50 p-5">
                  <label htmlFor="customer-import-file" className="block text-sm font-bold text-stone-200">
                    Selecionar arquivo
                  </label>
                  <input
                    id="customer-import-file"
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(event) => {
                      setImportFile(event.target.files?.[0] ?? null);
                      setImportError("");
                    }}
                    className="mt-3 block w-full text-sm text-stone-400 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-500 file:px-4 file:py-2 file:font-bold file:text-stone-950"
                  />
                  <p className="mt-2 text-xs text-stone-500">CSV / XLSX · máx. 5 MB</p>
                  {importFile && <p className="mt-2 text-sm text-stone-300">{importFile.name}</p>}
                </div>
                <a
                  href="/api/admin/clients/export?format=template"
                  className="inline-flex text-sm font-semibold text-amber-400 hover:text-amber-300"
                >
                  Baixar planilha modelo
                </a>
                {importError && <p className="text-sm text-red-400">{importError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-stone-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={loadImportPreview}
                    disabled={!importFile || loadingPreview}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950 disabled:opacity-50"
                  >
                    {loadingPreview ? "Analisando..." : "Visualizar clientes"}
                  </button>
                </div>
              </div>
            )}

            {importPreview && !importResult && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-bold text-stone-100">Preview da importação</h3>
                  <p className="mt-1 text-xs text-stone-500">Nenhuma alteração foi feita no banco.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <ImportMetric label="Total" value={importPreview.totalRows} tone="text-stone-100" />
                  <ImportMetric label="Válidos" value={importPreview.valid} tone="text-emerald-400" />
                  <ImportMetric label="Duplicados" value={importPreview.duplicates} tone="text-amber-400" />
                  <ImportMetric label="Inválidos" value={importPreview.invalid} tone="text-red-400" />
                </div>
                <div className="max-h-80 overflow-auto rounded-lg border border-stone-800">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="sticky top-0 bg-stone-950 text-stone-500">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Telefone</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800">
                      {importPreview.rows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="px-3 py-2 text-stone-500">{row.rowNumber}</td>
                          <td className="px-3 py-2 text-stone-200">{row.name || "-"}</td>
                          <td className="px-3 py-2 text-stone-300">{row.phoneOriginal || "-"}</td>
                          <td className="px-3 py-2">
                            <span className={`font-bold ${importStatusTone(row.status)}`}>
                              {importStatusLabel(row.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-stone-500">{row.reason ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importError && <p className="text-sm text-red-400">{importError}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setImportPreview(null)}
                    disabled={confirmingImport}
                    className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-stone-300 disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    disabled={importPreview.valid === 0 || confirmingImport}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950 disabled:opacity-50"
                  >
                    {confirmingImport ? "Importando..." : `Importar ${importPreview.valid} clientes`}
                  </button>
                </div>
              </div>
            )}

            {importResult && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-bold text-stone-100">Importação concluída</h3>
                  <p className="mt-1 text-sm text-stone-400">A confirmação foi revalidada pelo servidor.</p>
                </div>
                <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/50 p-5 text-sm">
                  <p className="text-emerald-400"><strong>{importResult.imported}</strong> clientes importados</p>
                  <p className="text-amber-400"><strong>{importResult.duplicates}</strong> duplicados ignorados</p>
                  <p className="text-red-400"><strong>{importResult.invalid}</strong> linhas inválidas</p>
                  {importResult.failed > 0 && <p className="text-red-400"><strong>{importResult.failed}</strong> falhas</p>}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={finishImport}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/50 p-3">
      <p className="text-[10px] font-bold uppercase text-stone-500">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function importStatusLabel(status: ImportStatus) {
  if (status === "VALID") return "Válido";
  if (status === "INVALID") return "Inválido";
  return "Duplicado";
}

function importStatusTone(status: ImportStatus) {
  if (status === "VALID") return "text-emerald-400";
  if (status === "INVALID") return "text-red-400";
  return "text-amber-400";
}
