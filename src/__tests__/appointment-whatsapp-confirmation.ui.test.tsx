import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentBlock, AppointmentModal } from "@/app/admin/agendamentos/page";

const sessionState = {
  user: { role: "OWNER" },
};

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionState, status: "authenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const members = [{ id: "member-a", user: { name: "Bruno Smoke" } }];
const services = [{ id: "svc-a", name: "Corte", price: "40.00", durationMin: 30 }];
type ModalAppointment = NonNullable<ComponentProps<typeof AppointmentModal>["appointment"]>;
type BlockAppointment = ComponentProps<typeof AppointmentBlock>["appointment"];

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
  appointmentOverrides = {},
}: {
  appointmentOverrides?: Partial<ModalAppointment>;
} = {}) {
  return {
    ...render(
      <AppointmentModal
        appointment={appointment(appointmentOverrides)}
        members={members}
        barbershopServices={services}
        currentDate="2026-07-20"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    ),
  };
}

function renderBlock({
  appointmentOverrides = {},
}: {
  appointmentOverrides?: Partial<BlockAppointment>;
} = {}) {
  const onAppointmentUpdated = vi.fn();
  const data = appointment(appointmentOverrides) as BlockAppointment;
  return {
    onAppointmentUpdated,
    ...render(
      <AppointmentBlock
        appointment={data}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onStatusChange={vi.fn()}
        onAppointmentUpdated={onAppointmentUpdated}
        onOpenComanda={vi.fn()}
        isOpen
        onToggleOpen={vi.fn()}
        barbershopName="Tem Barber"
      />
    ),
  };
}

describe("UI de confirmação WhatsApp no modal de agendamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.user.role = "OWNER";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/admin/clube/")) {
          return { ok: false, json: async () => ({}) };
        }
        return { ok: false, json: async () => ({}) };
      })
    );
  });

  it("não exibe confirmação WhatsApp dentro de Editar Agendamento", () => {
    renderModal();

    expect(screen.queryByText("Confirmação WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Código de confirmação WhatsApp")).not.toBeInTheDocument();
  });

  it("exibe confirmação WhatsApp no modal principal com ações e badge pendente", () => {
    renderBlock();

    expect(screen.getByTitle("Código de confirmação WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar com código" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar sem código" })).toBeInTheDocument();
    expect(screen.getAllByText("Pendente WhatsApp").length).toBeGreaterThan(0);
    expect(screen.queryByText("Confirmado", { selector: "span" })).not.toBeInTheDocument();
  });

  it("token correto muda para WhatsApp confirmado", async () => {
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
              confirmationMethod: "TOKEN",
              manualConfirmationReason: null,
            },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { onAppointmentUpdated } = renderBlock();

    await user.type(screen.getByTitle("Código de confirmação WhatsApp"), "TB-123456");
    await user.click(screen.getByRole("button", { name: "Confirmar com código" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/appointments/appointment-a/confirm-whatsapp",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findAllByText("WhatsApp confirmado")).not.toHaveLength(0);
    expect(onAppointmentUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappConfirmation: expect.objectContaining({
          status: "CONFIRMED",
          confirmationMethod: "TOKEN",
        }),
      })
    );
  });

  it("confirmar sem código muda para Confirmado manualmente", async () => {
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
              confirmationMethod: "MANUAL_OVERRIDE",
              manualConfirmationReason: "Cliente validado pelo telefone/WhatsApp",
            },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderBlock();

    await user.click(screen.getByRole("button", { name: "Confirmar sem código" }));
    expect(screen.getByText("Confirmar sem código?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar manualmente" }));

    expect(await screen.findAllByText("Confirmado manualmente")).not.toHaveLength(0);
  });

  it("token errado exibe mensagem amigável", async () => {
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
    renderBlock();

    await user.type(screen.getByTitle("Código de confirmação WhatsApp"), "TB-000000");
    await user.click(screen.getByRole("button", { name: "Confirmar com código" }));

    expect(
      await screen.findByText("Código inválido. Confira a mensagem recebida no WhatsApp.")
    ).toBeInTheDocument();
  });

  it("BARBER não vê ações de confirmação no admin UI", () => {
    sessionState.user.role = "BARBER";
    renderBlock();

    expect(screen.queryByRole("button", { name: "Confirmar com código" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar sem código" })).not.toBeInTheDocument();
    expect(screen.getByText("Você não tem permissão para confirmar este agendamento.")).toBeInTheDocument();
  });

  it("agendamento antigo sem whatsappConfirmation continua renderizando", () => {
    renderBlock({ appointmentOverrides: { whatsappConfirmation: null } });

    expect(screen.queryByText("Confirmação WhatsApp")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir Atendimento" })).toBeInTheDocument();
  });
});
