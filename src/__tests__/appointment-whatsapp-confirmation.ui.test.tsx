import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentModal } from "@/app/admin/agendamentos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const members = [{ id: "member-a", user: { name: "Bruno Smoke" } }];
const services = [{ id: "svc-a", name: "Corte", price: "40.00", durationMin: 30 }];
type ModalAppointment = NonNullable<ComponentProps<typeof AppointmentModal>["appointment"]>;

function appointment(overrides: Partial<ModalAppointment> = {}): ModalAppointment {
  const base: ModalAppointment = {
    id: "appointment-a",
    dateTime: "2026-07-20T12:00:00.000Z",
    totalPrice: "40.00",
    durationMin: 30,
    status: "CONFIRMED",
    bookingMode: "NORMAL",
    fitInReason: null,
    fitInCreatedAt: null,
    conflictSnapshot: null,
    notes: null,
    customer: { id: "customer-a", name: "Maria Souza", phone: "5517988887777" },
    barber: { id: "member-a", user: { name: "Bruno Smoke", avatarUrl: null } },
    services: [{ service: { id: "svc-a", name: "Corte", durationMin: 30 }, priceApplied: "40.00" }],
    comandas: [],
    whatsappConfirmation: {
      status: "PENDING",
      tokenHint: "TB-****56",
      expiresAt: "2026-07-20T12:10:00.000Z",
      confirmedAt: null,
      confirmedById: null,
    },
  };

  return { ...base, ...overrides };
}

function renderModal({
  canConfirmWhatsapp = true,
  appointmentOverrides = {},
  onUpdated = vi.fn(),
}: {
  canConfirmWhatsapp?: boolean;
  appointmentOverrides?: Partial<ModalAppointment>;
  onUpdated?: (a: ModalAppointment) => void;
} = {}) {
  return {
    onUpdated,
    ...render(
      <AppointmentModal
        appointment={appointment(appointmentOverrides)}
        members={members}
        barbershopServices={services}
        currentDate="2026-07-20"
        canConfirmWhatsapp={canConfirmWhatsapp}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onUpdated={onUpdated}
      />
    ),
  };
}

describe("UI de confirmação WhatsApp no modal de agendamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );
  });

  it("exibe badge pendente, telefone e dica do token", () => {
    renderModal();

    expect(screen.getByText("Pendente WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("5517988887777")).toBeInTheDocument();
    expect(screen.getByText("TB-****56")).toBeInTheDocument();
  });

  it("OWNER/MANAGER vê input e botão de confirmação", () => {
    renderModal({ canConfirmWhatsapp: true });

    expect(screen.getByTitle("Código de confirmação WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar WhatsApp" })).toBeInTheDocument();
  });

  it("BARBER vê status, mas não vê botão de confirmação", () => {
    renderModal({ canConfirmWhatsapp: false });

    expect(screen.getByText("Pendente WhatsApp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar WhatsApp" })).not.toBeInTheDocument();
    expect(screen.getByText("Confirmação manual disponível apenas para OWNER ou MANAGER.")).toBeInTheDocument();
  });

  it("token correto chama endpoint e atualiza para confirmado", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/confirm-whatsapp")) {
        return {
          ok: true,
          json: async () => ({
            whatsappConfirmation: {
              status: "CONFIRMED",
              tokenHint: "TB-****56",
              expiresAt: "2026-07-20T12:10:00.000Z",
              confirmedAt: "2026-07-20T12:02:00.000Z",
              confirmedById: "user-owner",
            },
          }),
        };
      }

      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    renderModal({ onUpdated });

    await user.type(screen.getByTitle("Código de confirmação WhatsApp"), "TB-123456");
    await user.click(screen.getByRole("button", { name: "Confirmar WhatsApp" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/appointments/appointment-a/confirm-whatsapp",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findAllByText("WhatsApp confirmado")).not.toHaveLength(0);
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappConfirmation: expect.objectContaining({ status: "CONFIRMED" }),
      })
    );
  });

  it("token errado mostra erro específico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/confirm-whatsapp")) {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "INVALID_WHATSAPP_CONFIRMATION_TOKEN" }),
          };
        }
        return { ok: false, json: async () => ({}) };
      })
    );
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Código de confirmação WhatsApp"), "TB-000000");
    await user.click(screen.getByRole("button", { name: "Confirmar WhatsApp" }));

    expect(await screen.findByText("Código inválido. Confira a mensagem recebida no WhatsApp.")).toBeInTheDocument();
  });

  it("agendamento confirmado mostra badge e não mostra input", () => {
    renderModal({
      appointmentOverrides: {
        whatsappConfirmation: {
          status: "CONFIRMED",
          tokenHint: "TB-****56",
          expiresAt: "2026-07-20T12:10:00.000Z",
          confirmedAt: "2026-07-20T12:02:00.000Z",
          confirmedById: "user-owner",
        },
      },
    });

    expect(screen.getAllByText("WhatsApp confirmado")).not.toHaveLength(0);
    expect(screen.queryByTitle("Código de confirmação WhatsApp")).not.toBeInTheDocument();
  });

  it("agendamento antigo sem whatsappConfirmation continua renderizando", () => {
    renderModal({ appointmentOverrides: { whatsappConfirmation: null } });

    expect(screen.getByText("Sem confirmação WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Este agendamento ainda não possui confirmação WhatsApp pendente.")).toBeInTheDocument();
  });
});
