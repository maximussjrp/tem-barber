import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MetaWhatsappSettingsPage from "@/app/admin/configuracoes/whatsapp/page";

const {
  mockUseSession,
  mockLoadFacebookSdk,
  mockLaunchCoexistenceEmbeddedSignup,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockLoadFacebookSdk: vi.fn().mockResolvedValue(undefined),
  mockLaunchCoexistenceEmbeddedSignup: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("@/lib/meta/whatsapp/embedded-signup", () => ({
  loadFacebookSdk: mockLoadFacebookSdk,
  launchCoexistenceEmbeddedSignup: mockLaunchCoexistenceEmbeddedSignup,
}));

describe("Meta WhatsApp Settings Admin UI Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "user_owner", name: "Dono", role: "OWNER" },
      },
    });
  });

  it("renders SERVER_NOT_CONFIGURED when server readiness is false", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: false,
        status: "NOT_CONFIGURED",
        connection: null,
        systemReadiness: { ready: false, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("SERVIDOR NÃO CONFIGURADO")).toBeInTheDocument();
    });
    expect(screen.getByText("WhatsApp Oficial (Meta)")).toBeInTheDocument();
    expect(screen.getByText("COEXISTENCE")).toBeInTheDocument();
  });

  it("renders PRONTO PARA CONECTAR for OWNER when server is ready and not configured", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: false,
        status: "NOT_CONFIGURED",
        connection: null,
        systemReadiness: { ready: true, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("PRONTO PARA CONECTAR")).toBeInTheDocument();
    });

    const connectBtn = screen.getByRole("button", { name: "Conectar WhatsApp" });
    expect(connectBtn).toBeInTheDocument();
    expect(connectBtn).not.toBeDisabled();
  });

  it("passes the server-configured Graph API version to the SDK loader", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          configured: false,
          status: "NOT_CONFIGURED",
          connection: null,
          systemReadiness: { ready: true, activeKeyVersion: "v1" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: "session_123",
          nonce: "nonce_123",
          appId: "app_123",
          configId: "config_123",
          graphApiVersion: "v23.0",
          expiresAt: new Date().toISOString(),
        }),
      });

    render(<MetaWhatsappSettingsPage />);

    const connectBtn = await screen.findByRole("button", {
      name: "Conectar WhatsApp",
    });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(mockLoadFacebookSdk).toHaveBeenCalledWith("app_123", "v23.0");
    });
    expect(mockLaunchCoexistenceEmbeddedSignup).toHaveBeenCalledTimes(1);
  });

  it("fails safely without loading or launching the SDK when Graph API version is missing", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          configured: false,
          status: "NOT_CONFIGURED",
          connection: null,
          systemReadiness: { ready: true, activeKeyVersion: "v1" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: "session_123",
          nonce: "nonce_123",
          appId: "app_123",
          configId: "config_123",
          expiresAt: new Date().toISOString(),
        }),
      });

    render(<MetaWhatsappSettingsPage />);

    const connectBtn = await screen.findByRole("button", {
      name: "Conectar WhatsApp",
    });
    fireEvent.click(connectBtn);

    expect(
      await screen.findByText("Versão da Graph API não fornecida pelo servidor.")
    ).toBeInTheDocument();
    expect(mockLoadFacebookSdk).not.toHaveBeenCalled();
    expect(mockLaunchCoexistenceEmbeddedSignup).not.toHaveBeenCalled();
  });

  it("hides connection button and shows notice for MANAGER role", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "user_mgr", name: "Gerente", role: "MANAGER" },
      },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: false,
        status: "NOT_CONFIGURED",
        connection: null,
        systemReadiness: { ready: true, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("PRONTO PARA CONECTAR")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Conectar WhatsApp" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Apenas o proprietário \(OWNER\) pode iniciar ou reconectar/)
    ).toBeInTheDocument();
  });

  it("renders CONECTADO and connection metadata when connected", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: true,
        status: "CONNECTED",
        connection: {
          id: "conn_123",
          connectionMode: "COEXISTENCE",
          wabaId: "waba_100",
          phoneNumberId: "phone_200",
          displayPhoneNumber: "+55 17 99999-8888",
          verifiedName: "Barbearia Oficial",
          qualityRating: "GREEN",
          status: "CONNECTED",
          connectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        systemReadiness: { ready: true, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("CONECTADO")).toBeInTheDocument();
    });

    expect(screen.getByText("+55 17 99999-8888")).toBeInTheDocument();
    expect(screen.getByText("Barbearia Oficial")).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconectar Conta" })).toBeInTheDocument();
  });

  it("renders REQUER ATENÇÃO when status is DEGRADED", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: true,
        status: "DEGRADED",
        connection: {
          id: "conn_123",
          connectionMode: "COEXISTENCE",
          status: "DEGRADED",
          lastErrorMessage: "Token expired or subscription removed by admin",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        systemReadiness: { ready: true, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("REQUER ATENÇÃO")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Token expired or subscription removed by admin")
    ).toBeInTheDocument();
  });

  it("renders ERRO NA INTEGRAÇÃO when status is FAILED", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configured: false,
        status: "FAILED",
        connection: null,
        systemReadiness: { ready: true, activeKeyVersion: "v1" },
      }),
    });

    render(<MetaWhatsappSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("ERRO NA INTEGRAÇÃO")).toBeInTheDocument();
    });
  });
});
