import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientesPage from "@/app/admin/clientes/page";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useParams: () => ({ id: "c-1" }),
  usePathname: () => "/admin/clientes",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "u-owner", name: "Proprietário", role: "OWNER" } },
    status: "authenticated",
  }),
}));

const eligibleClient1 = {
  id: "c-1",
  name: "Carlos Elegível",
  email: "carlos@test.com",
  phone: "5517991089190",
  createdAt: "2026-08-01T00:00:00.000Z",
  sources: { link: true, appointment: true, comanda: false, club: false },
  stats: {
    total: 3,
    completed: 3,
    cancelled: 0,
    noShows: 0,
    totalSpent: 150,
    lastVisit: "2026-09-10T12:00:00.000Z",
    nextAppointmentAt: null,
    openComandas: 0,
    closedComandas: 3,
    hasClubSubscription: false,
    isBlocked: false,
    lastContactedAt: "2026-09-10T12:00:00.000Z",
    contactLogCount: 1,
  },
  whatsappQueue: {
    eligible: true,
    consentStatus: "OPTED_IN" as const,
    isValidMobilePhone: true,
    inCooldown14d: false,
    canRegisterConsentInDrawer: false,
    ineligibilityReason: null,
  },
};

const pendingConsentClient2 = {
  id: "c-2",
  name: "Marina Sem Consentimento",
  email: "marina@test.com",
  phone: "5517991089191",
  createdAt: "2026-08-01T00:00:00.000Z",
  sources: { link: true, appointment: false, comanda: false, club: false },
  stats: {
    total: 0,
    completed: 0,
    cancelled: 0,
    noShows: 0,
    totalSpent: 0,
    lastVisit: null,
    nextAppointmentAt: null,
    openComandas: 0,
    closedComandas: 0,
    hasClubSubscription: false,
    isBlocked: false,
    lastContactedAt: null,
    contactLogCount: 0,
  },
  whatsappQueue: {
    eligible: false,
    consentStatus: "UNKNOWN" as const,
    isValidMobilePhone: true,
    inCooldown14d: false,
    canRegisterConsentInDrawer: true,
    ineligibilityReason: "CONSENT_UNKNOWN" as const,
  },
};

describe("G2 UI — Fila Assistida de WhatsApp na Base de Clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("exibe os 7 cards de summaryMetrics do backend, permite abrir fila de 2 clientes, exige reabrir se editar texto após abertura (S-02) e avança sem abrir WhatsApp do próximo automaticamente", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => ({ closed: false } as Window));

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/active")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ activeCampaign: null }),
        });
      }

      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/camp-g2/recipients/rec-1/opened")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const isEdited = body.messageText?.includes("Texto atualizado");
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            whatsappUrl: "https://wa.me/5517991089190?text=Oi",
            openPreparationId: isEdited ? "prep-rec1-v2" : "prep-rec1-v1",
            recipient: {
              id: "rec-1",
              dispatchStatus: "WHATSAPP_OPENED",
            },
          }),
        });
      }

      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/camp-g2/recipients/rec-1/sent-confirmed")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            recipient: { id: "rec-1", dispatchStatus: "SENT_CONFIRMED" },
            contactLog: { id: "log-1" },
            campaignStatus: "IN_PROGRESS",
            remainingPendingCount: 1,
          }),
        });
      }

      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/camp-g2/recipients/rec-2/skip")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            recipient: { id: "rec-2", dispatchStatus: "EXCLUDED", failureReason: "SKIPPED_BY_USER" },
            campaignStatus: "COMPLETED",
            remainingPendingCount: 0,
          }),
        });
      }

      if (url.includes("/api/admin/clients/reactivation/manual-campaigns") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            campaign: {
              id: "camp-g2",
              name: "Fila Assistida — Teste",
              status: "READY",
            },
            accepted: [
              {
                recipientId: "rec-1",
                customerId: "c-1",
                customerName: "Carlos Elegível",
                customerPhone: "5517991089190",
                dispatchStatus: "READY",
                previewMessage: "Oi, Carlos! Tudo certo? Já faz um tempo desde seu último atendimento.",
                queueIndex: 0,
              },
              {
                recipientId: "rec-2",
                customerId: "c-3",
                customerName: "Daniel Segundo",
                customerPhone: "5517991089199",
                dispatchStatus: "READY",
                previewMessage: "Oi, Daniel! Tudo certo?",
                queueIndex: 1,
              },
            ],
            rejected: [],
          }),
        });
      }

      // Default GET /api/admin/clients
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-owner-1",
          permissions: {
            canViewClients: true,
            canManageClients: true,
            canOperateWhatsappAssisted: true,
          },
          clients: [eligibleClient1, pendingConsentClient2],
          total: 2,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 1, noContact30: 1, recentlyContacted: 0 },
          summaryMetrics: {
            totalClients: 142,
            withoutAppointment: 35,
            upcoming: 12,
            openComandas: 4,
            neverContacted: 28,
            noContact30: 19,
            noContact60: 9,
            noContact90: 5,
            recentlyContacted: 11,
          },
          queueSelectionMeta: {
            totalFilteredCount: 2,
            eligibleInFilterCount: 1,
            remainingEligibleInRoundCount: 1,
            excludedInRoundCount: 0,
            pendingConsentInFilterCount: 1,
            ineligibleInFilterCount: 1,
            nextEligibleBatchIds: ["c-1"],
            hasMoreThanBatchLimit: false,
          },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Carlos Elegível")).toBeInTheDocument();
    // Verifica que os cards usam summaryMetrics globais (142 clientes, 35 sem agendamento)
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();

    // Clica em "WhatsApp Assistido" no cliente elegível
    await userEvent.click(screen.getByRole("button", { name: "WhatsApp Assistido" }));

    // Painel lateral abre com 0 de 2 processados
    expect(await screen.findByRole("dialog", { name: "Fila Assistida de WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/0 de 2 processados/)).toBeInTheDocument();

    // "Confirmar que enviei" está desabilitado antes de abrir o WhatsApp
    const confirmBtn = screen.getByRole("button", { name: "Confirmar que enviei" });
    expect(confirmBtn).toBeDisabled();

    // Clica em "Abrir no WhatsApp"
    await userEvent.click(screen.getByRole("button", { name: "Abrir no WhatsApp" }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));

    // Agora "Confirmar que enviei" fica habilitado
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar que enviei" })).not.toBeDisabled());

    // S-02: Edita o texto após abrir -> "Confirmar que enviei" deve desabilitar até reabrir!
    const textarea = screen.getByLabelText("Mensagem para Carlos Elegível");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Texto atualizado para Carlos");

    expect(screen.getByText(/O texto ou modelo foi alterado após a abertura do WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar que enviei" })).toBeDisabled();

    // Reabre no WhatsApp com o texto atualizado
    await userEvent.click(screen.getByRole("button", { name: "Reabrir no WhatsApp" }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar que enviei" })).not.toBeDisabled());

    // Confirma envio manual -> envia openPreparationId="prep-rec1-v2" e avança automaticamente para o cliente 2
    await userEvent.click(screen.getByRole("button", { name: "Confirmar que enviei" }));

    const confirmCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/sent-confirmed"));
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
      openPreparationId: "prep-rec1-v2",
    });

    // Avançou para Daniel Segundo (Cliente 2 de 2) SEM chamar window.open uma 3ª vez!
    expect(await screen.findByText("Daniel Segundo")).toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledTimes(2);

    // Pula o segundo cliente -> encerra a fila sem criar log de contato
    await userEvent.click(screen.getByRole("button", { name: "Pular cliente" }));
    expect(await screen.findByText("Fila concluída!")).toBeInTheDocument();

    openSpy.mockRestore();
  });

  it("permite registrar consentimento prévio no painel lateral (DEC-03 = A) exigindo declaração e evidência >= 10 caracteres", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/active")) {
        return Promise.resolve({ ok: true, json: async () => ({ activeCampaign: null }) });
      }
      if (url.includes("/api/admin/clients/c-2/marketing-consent") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            consent: { status: "OPTED_IN" },
          }),
        });
      }
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            campaign: { id: "camp-consent", name: "Fila Assistida", status: "READY" },
            accepted: [
              {
                recipientId: "rec-c2",
                customerId: "c-2",
                customerName: "Marina Sem Consentimento",
                customerPhone: "5517991089191",
                dispatchStatus: "READY",
                previewMessage: "Oi, Marina!",
                queueIndex: 0,
              },
            ],
            rejected: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-owner-1",
          permissions: {
            canViewClients: true,
            canManageClients: true,
            canOperateWhatsappAssisted: true,
          },
          clients: [pendingConsentClient2],
          total: 1,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 1, noContact30: 0, recentlyContacted: 0 },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);
    expect(await screen.findByText("Marina Sem Consentimento")).toBeInTheDocument();

    // Clica em "Autorizar WhatsApp"
    await userEvent.click(screen.getByRole("button", { name: "Autorizar WhatsApp" }));

    expect(
      await screen.findByText("Registro de Consentimento Já Obtido (DEC-03 / LGPD)")
    ).toBeInTheDocument();

    // Tenta salvar sem marcar declaração -> exibe erro
    const evidenceInput = screen.getByLabelText("Evidência da autorização (mínimo 10 caracteres)");
    await userEvent.type(evidenceInput, "Cliente pediu lembretes no balcão ontem.");
    await userEvent.click(screen.getByRole("button", { name: "Registrar consentimento e preparar mensagem" }));

    expect(
      await screen.findByText(/Confirme expressamente a declaração de que a autorização já foi obtida/i)
    ).toBeInTheDocument();

    // Marca declaração e salva -> chama POST /marketing-consent e em seguida prepara a fila
    const checkbox = screen.getByRole("checkbox", {
      name: /Declaro que a autorização de contato já foi obtida previamente/i,
    });
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: "Registrar consentimento e preparar mensagem" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/api/admin/clients/c-2/marketing-consent"))
      ).toBe(true)
    );
    expect(await screen.findByRole("button", { name: "Abrir no WhatsApp" })).toBeInTheDocument();
  });

  it("exibe banner de retomada de fila ativa, fallback de bloqueador de pop-up e botão de próximo lote da rodada (S-03)", async () => {
    // Simula navegador bloqueando window.open (retorna null)
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/active")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activeCampaign: {
              id: "camp-resume-1",
              name: "Fila Retomada",
              status: "IN_PROGRESS",
              origin: "CLIENTS_BASE_ASSISTED_QUEUE",
              templateKey: "RETURN_REMINDER",
              sourceFilter: "no_contact_30",
              workRoundId: "round-resume",
              progress: {
                totalRecipients: 1,
                pendingReady: 1,
                pendingOpened: 0,
                remainingPendingCount: 1,
                sentConfirmed: 0,
                skippedOrExcluded: 0,
              },
              recipients: [
                {
                  recipientId: "rec-r1",
                  queueIndex: 0,
                  customerId: "c-1",
                  customerName: "Carlos Elegível",
                  customerPhone: "5517991089190",
                  dispatchStatus: "READY",
                  templateKey: "RETURN_REMINDER",
                  templateLabel: "Lembrete de retorno",
                  previewMessage: "Oi, Carlos!",
                  openedMessageText: null,
                  confirmedMessageText: null,
                  isCustomEdited: false,
                  openPreparationId: null,
                  lease: null,
                },
              ],
            },
          }),
        });
      }
      if (url.includes("/recipients/rec-r1/opened")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            whatsappUrl: "https://wa.me/5517991089190?text=Oi",
            openPreparationId: "prep-r1-v1",
            recipient: { id: "rec-r1", dispatchStatus: "WHATSAPP_OPENED" },
          }),
        });
      }
      if (url.includes("/recipients/rec-r1/skip")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            recipient: { id: "rec-r1", dispatchStatus: "EXCLUDED", failureReason: "SKIPPED_BY_USER" },
            campaignStatus: "COMPLETED",
            remainingPendingCount: 0,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-owner-1",
          permissions: {
            canViewClients: true,
            canManageClients: true,
            canOperateWhatsappAssisted: true,
          },
          clients: [eligibleClient1],
          total: 65,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 0, noContact30: 65, recentlyContacted: 0 },
          queueSelectionMeta: {
            totalFilteredCount: 65,
            eligibleInFilterCount: 65,
            remainingEligibleInRoundCount: 15,
            excludedInRoundCount: 0,
            pendingConsentInFilterCount: 0,
            ineligibleInFilterCount: 0,
            nextEligibleBatchIds: ["c-next-1"],
            hasMoreThanBatchLimit: false,
          },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    // Banner de retomada aparece automaticamente
    expect(await screen.findByText("Fila de WhatsApp Assistido em andamento")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retomar fila/i }));

    // Clica em Abrir no WhatsApp -> como window.open retornou null, exibe fallback direto
    await userEvent.click(await screen.findByRole("button", { name: "Abrir no WhatsApp" }));
    expect(
      await screen.findByText("O navegador bloqueou a abertura automática da janela.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Toque aqui para abrir a conversa no WhatsApp" })
    ).toHaveAttribute("href", "https://wa.me/5517991089190?text=Oi");

    // Pula o cliente para concluir o lote atual -> exibe "Iniciar próximo lote (15 elegíveis)"
    await userEvent.click(screen.getByRole("button", { name: "Pular cliente" }));
    expect(await screen.findByText("Fila concluída!")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Iniciar próximo lote (15 elegíveis)" })
    ).toBeInTheDocument();

    openSpy.mockRestore();
  });

  it("G24-02a: sem WHATSAPP_ASSISTED_OPERATE e sem CLIENTS_MANAGE oculta fila e consentimento na UI (fail-closed)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-rbac-1",
          permissions: {
            canViewClients: true,
            canManageClients: false,
            canOperateWhatsappAssisted: false,
          },
          clients: [eligibleClient1, pendingConsentClient2],
          total: 2,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 1, noContact30: 1, recentlyContacted: 0 },
          queueSelectionMeta: {
            totalFilteredCount: 2,
            eligibleInFilterCount: 1,
            remainingEligibleInRoundCount: 1,
            excludedInRoundCount: 0,
            pendingConsentInFilterCount: 1,
            ineligibleInFilterCount: 1,
            nextEligibleBatchIds: ["c-1"],
            hasMoreThanBatchLimit: false,
          },
        }),
      })
    );

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Carlos Elegível")).toBeInTheDocument();
    expect(screen.getByText("Marina Sem Consentimento")).toBeInTheDocument();

    // Controles de fila e consentimento não podem aparecer
    expect(screen.queryByRole("button", { name: "WhatsApp Assistido" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autorizar WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Iniciar fila/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo cliente" })).not.toBeInTheDocument();
    // Também não consulta /manual-campaigns/active sem permissão
    expect(
      (fetchMock.mock.calls as unknown as [RequestInfo | URL][]).some(([url]) =>
        String(url).includes("/api/admin/clients/reactivation/manual-campaigns/active")
      )
    ).toBe(false);
  });

  it("G24-02b: WHATSAPP_ASSISTED_OPERATE=true com CLIENTS_MANAGE=false libera fila mas bloqueia Autorizar WhatsApp", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/active")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            barbershopId: "shop-rbac-2",
            permissions: {
              canViewClients: true,
              canManageClients: false,
              canOperateWhatsappAssisted: true,
            },
            activeCampaign: null,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-rbac-2",
          permissions: {
            canViewClients: true,
            canManageClients: false,
            canOperateWhatsappAssisted: true,
          },
          clients: [eligibleClient1, pendingConsentClient2],
          total: 2,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 1, noContact30: 1, recentlyContacted: 0 },
          queueSelectionMeta: {
            totalFilteredCount: 2,
            eligibleInFilterCount: 1,
            remainingEligibleInRoundCount: 1,
            excludedInRoundCount: 0,
            pendingConsentInFilterCount: 1,
            ineligibleInFilterCount: 1,
            nextEligibleBatchIds: ["c-1"],
            hasMoreThanBatchLimit: false,
          },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByRole("button", { name: "WhatsApp Assistido" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autorizar WhatsApp" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Indisponível" })).toBeDisabled();
  });

  it("G24-02c: CLIENTS_MANAGE=true com WHATSAPP_ASSISTED_OPERATE=false permite registrar consentimento sem iniciar fila WhatsApp", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/clients/c-2/marketing-consent") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, consent: { status: "OPTED_IN" } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-rbac-3",
          permissions: {
            canViewClients: true,
            canManageClients: true,
            canOperateWhatsappAssisted: false,
          },
          clients: [eligibleClient1, pendingConsentClient2],
          total: 2,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 1, noContact30: 1, recentlyContacted: 0 },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    expect(await screen.findByText("Marina Sem Consentimento")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WhatsApp Assistido" })).not.toBeInTheDocument();
    const authBtn = screen.getByRole("button", { name: "Autorizar WhatsApp" });
    await userEvent.click(authBtn);

    const evidenceInput = await screen.findByLabelText("Evidência da autorização (mínimo 10 caracteres)");
    await userEvent.type(evidenceInput, "Cliente assinou termo na recepção");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Declaro que a autorização de contato/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Registrar consentimento" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            String(u).includes("/api/admin/clients/c-2/marketing-consent") &&
            i?.method === "POST"
        )
      ).toBe(true)
    );
    // Não deve disparar POST /manual-campaigns porque WHATSAPP_ASSISTED_OPERATE é false
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) =>
          String(u).includes("/api/admin/clients/reactivation/manual-campaigns") &&
          i?.method === "POST"
      )
    ).toBe(false);
  });

  it("G24-03: resposta tardia da Barbearia A após troca para Barbearia B é descartada sem sobrescrever clientes, métricas ou fila ativa de B", async () => {
    let resolveSlowShopA!: (val: unknown) => void;
    const slowShopAPromise = new Promise((resolve) => {
      resolveSlowShopA = resolve;
    });

    let callIndex = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/clients/reactivation/manual-campaigns/active")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            barbershopId: "shop-B",
            permissions: {
              canViewClients: true,
              canManageClients: true,
              canOperateWhatsappAssisted: true,
            },
            activeCampaign: {
              id: "camp-B",
              name: "Fila Barbearia B",
              status: "IN_PROGRESS",
              workRoundId: "round-B",
              recipients: [
                {
                  recipientId: "rec-B1",
                  queueIndex: 0,
                  customerId: "c-B1",
                  customerName: "Cliente B Ativo",
                  customerPhone: "5517992223333",
                  dispatchStatus: "READY",
                  previewMessage: "Oi B!",
                },
              ],
            },
            workRound: {
              workRoundId: "round-B",
              processedCustomerIds: [],
            },
          }),
        });
      }

      callIndex += 1;
      // 1ª chamada: Barbearia A lenta (ignora AbortSignal propositalmente para provar proteção por sequence/epoch)
      if (callIndex === 1) {
        return slowShopAPromise as Promise<Response>;
      }
      // 2ª chamada (após busca/troca de tenant): Barbearia B rápida
      return Promise.resolve({
        ok: true,
        json: async () => ({
          barbershopId: "shop-B",
          permissions: {
            canViewClients: true,
            canManageClients: true,
            canOperateWhatsappAssisted: true,
          },
          clients: [
            {
              ...eligibleClient1,
              id: "c-B1",
              name: "Cliente Barbearia B",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 30,
          contactMetrics: { neverContacted: 0, noContact30: 1, recentlyContacted: 0 },
          summaryMetrics: {
            totalClients: 88,
            withoutAppointment: 10,
            upcoming: 5,
            openComandas: 1,
            neverContacted: 2,
            noContact30: 9,
            noContact60: 4,
            noContact90: 2,
            recentlyContacted: 3,
          },
          queueSelectionMeta: {
            totalFilteredCount: 1,
            eligibleInFilterCount: 1,
            remainingEligibleInRoundCount: 1,
            excludedInRoundCount: 0,
            pendingConsentInFilterCount: 0,
            ineligibleInFilterCount: 0,
            nextEligibleBatchIds: ["c-B1"],
            hasMoreThanBatchLimit: false,
          },
        }),
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ClientesPage />);

    // Aguarda a 1ª requisição (Barbearia A lenta) estar efetivamente em voo antes da troca/nova busca
    await waitFor(() => expect(callIndex).toBe(1));

    // Dispara 2ª requisição (ex.: alteração de busca quando usuário já alternou para tenant B)
    const searchInput = screen.getByPlaceholderText("Buscar por nome, telefone ou e-mail...");
    await userEvent.type(searchInput, "Cliente B");

    // Barbearia B resolve rapidamente e renderiza seu estado
    expect(await screen.findByText("Cliente Barbearia B", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(await screen.findByText(/Fila Barbearia B/)).toBeInTheDocument();

    // Agora resolve tardiamente a resposta da Barbearia A com dados distintos
    resolveSlowShopA({
      ok: true,
      json: async () => ({
        barbershopId: "shop-A",
        permissions: {
          canViewClients: true,
          canManageClients: true,
          canOperateWhatsappAssisted: true,
        },
        clients: [
          {
            ...eligibleClient1,
            id: "c-A1",
            name: "Cliente Fantasma Barbearia A",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
        contactMetrics: { neverContacted: 1, noContact30: 0, recentlyContacted: 0 },
        summaryMetrics: {
          totalClients: 15,
          withoutAppointment: 1,
          upcoming: 0,
          openComandas: 0,
          neverContacted: 1,
          noContact30: 0,
          noContact60: 0,
          noContact90: 0,
          recentlyContacted: 0,
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByText("Cliente Barbearia B")).toBeInTheDocument();
    });
    expect(screen.queryByText("Cliente Fantasma Barbearia A")).not.toBeInTheDocument();
    expect(screen.queryByText("15")).not.toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
  });
});
