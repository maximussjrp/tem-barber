import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CalendarGrid } from "@/components/agenda/CalendarGrid";
import { Appointment, Member } from "@/components/agenda/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "admin-1", role: "OWNER" } },
    status: "authenticated",
  }),
}));

function extractZIndex(element: HTMLElement | null): number {
  if (!element) return 0;
  const match = element.className.match(/z-\[(\d+)\]/) || element.className.match(/\bz-(\d+)\b/);
  return match ? parseInt(match[1], 10) : 0;
}

describe("Agenda Appointment Overlay — Stacking & Portal Architecture", () => {
  const membersMock: Member[] = [
    {
      id: "mem-dandara",
      user: { name: "Dandara" },
      startTime: "09:00",
      endTime: "18:00",
    },
    {
      id: "mem-jesus",
      user: { name: "Jesus" },
      startTime: "10:00",
      endTime: "19:00",
    },
    {
      id: "mem-joao",
      user: { name: "João" },
      startTime: "08:00",
      endTime: "17:00",
    },
  ];

  const appointmentMock: Appointment = {
    id: "app-1",
    dateTime: "2026-09-26T10:00:00.000Z",
    durationMin: 30,
    totalPrice: "50.00",
    status: "CONFIRMED",
    notes: null,
    customer: { id: "cust-1", name: "Carlos Silva", phone: "11999999999" },
    barber: { id: "mem-dandara", user: { name: "Dandara", avatarUrl: null } },
    services: [
      {
        serviceId: "srv-1",
        priceApplied: "50.00",
        service: { id: "srv-1", name: "Corte Tradicional", durationMin: 30 },
      },
    ],
  };

  const defaultProps = {
    appointments: [appointmentMock],
    scheduleBlocks: [],
    members: membersMock,
    filterMember: "",
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    onSelectScheduleBlock: vi.fn(),
    onStatusChange: vi.fn(),
    onAppointmentUpdated: vi.fn(),
    onOpenComanda: vi.fn(),
    currentDate: "2026-09-26",
    onEmptySlotClick: vi.fn(),
    barbershopName: "Tem Barber",
    mode: "admin" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        let body: { status?: string } = {};
        try {
          body = init?.body ? JSON.parse(String(init.body)) : {};
        } catch {}
        return {
          ok: true,
          json: async () => ({ id: "app-1", status: body.status || "CONFIRMED" }),
        };
      })
    );
  });

  it("A. OVERLAY ACIMA DO HEADER: APPOINTMENT_PANEL > HEADER_STICKY e renderizado fora da árvore interna", () => {
    render(<CalendarGrid {...defaultProps} />);

    const scrollContainer = screen.getByTestId("calendar-scroll-container");
    const headerRow = screen.getByTestId("calendar-header-row");

    // Abre o agendamento
    const appCard = screen.getByText("Carlos Silva");
    fireEvent.click(appCard);

    const panel = screen.getByTestId("appointment-panel");
    expect(panel).toBeInTheDocument();

    const panelZ = extractZIndex(panel);
    const headerZ = extractZIndex(headerRow);

    expect(headerZ).toBe(40);
    expect(panelZ).toBe(80);
    expect(panelZ).toBeGreaterThan(headerZ);

    // Confirma que o painel está no document.body via Portal e não preso dentro do scroll container da agenda
    expect(document.body).toContainElement(panel);
    expect(scrollContainer).not.toContainElement(panel);
  });

  it("B. OVERLAY ACIMA DO TIME GUTTER: APPOINTMENT_PANEL > TIME_GUTTER", () => {
    render(<CalendarGrid {...defaultProps} />);

    const timeGutter = screen.getByTestId("calendar-time-gutter");
    fireEvent.click(screen.getByText("Carlos Silva"));

    const panel = screen.getByTestId("appointment-panel");
    const panelZ = extractZIndex(panel);
    const timeGutterZ = extractZIndex(timeGutter);

    expect(timeGutterZ).toBe(35);
    expect(panelZ).toBe(80);
    expect(panelZ).toBeGreaterThan(timeGutterZ);
  });

  it("C. OVERLAY ACIMA DO CORNER: APPOINTMENT_PANEL > CORNER_STICKY", () => {
    render(<CalendarGrid {...defaultProps} />);

    const corner = screen.getByTestId("calendar-top-left-corner");
    fireEvent.click(screen.getByText("Carlos Silva"));

    const panel = screen.getByTestId("appointment-panel");
    const panelZ = extractZIndex(panel);
    const cornerZ = extractZIndex(corner);

    expect(cornerZ).toBe(50);
    expect(panelZ).toBe(80);
    expect(panelZ).toBeGreaterThan(cornerZ);
  });

  it("D. BACKDROP: BACKDROP > agenda normal/sticky e PANEL > BACKDROP", () => {
    render(<CalendarGrid {...defaultProps} />);

    const normalCol = screen.getByTestId("calendar-member-column-mem-jesus");
    const targetCol = screen.getByTestId("calendar-member-column-mem-dandara");
    const timeGutter = screen.getByTestId("calendar-time-gutter");
    const headerRow = screen.getByTestId("calendar-header-row");
    const corner = screen.getByTestId("calendar-top-left-corner");

    fireEvent.click(screen.getByText("Carlos Silva"));

    const backdrop = screen.getByTestId("appointment-backdrop");
    const panel = screen.getByTestId("appointment-panel");

    const normalColZ = extractZIndex(normalCol);
    const activeColZ = extractZIndex(targetCol);
    const timeGutterZ = extractZIndex(timeGutter);
    const headerZ = extractZIndex(headerRow);
    const cornerZ = extractZIndex(corner);
    const backdropZ = extractZIndex(backdrop);
    const panelZ = extractZIndex(panel);

    expect(normalColZ).toBe(10);
    expect(activeColZ).toBe(30);
    expect(timeGutterZ).toBe(35);
    expect(headerZ).toBe(40);
    expect(cornerZ).toBe(50);
    expect(backdropZ).toBe(70);
    expect(panelZ).toBe(80);

    // Hierarquia conceitual completa:
    // COLUMN_NORMAL < COLUMN_ACTIVE < TIME_GUTTER < HEADER_STICKY < CORNER_STICKY < APPOINTMENT_BACKDROP < APPOINTMENT_PANEL
    expect(normalColZ).toBeLessThan(activeColZ);
    expect(activeColZ).toBeLessThan(timeGutterZ);
    expect(timeGutterZ).toBeLessThan(headerZ);
    expect(headerZ).toBeLessThan(cornerZ);
    expect(cornerZ).toBeLessThan(backdropZ);
    expect(backdropZ).toBeLessThan(panelZ);
  });

  it("E. FECHAMENTO: Fechar pelo backdrop, botão Fechar e tecla Escape remove overlay e restaura agenda", () => {
    const { unmount } = render(<CalendarGrid {...defaultProps} />);

    // 1. Abrir e fechar clicando no backdrop
    fireEvent.click(screen.getByText("Carlos Silva"));
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
    expect(screen.getByTestId("appointment-backdrop")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("appointment-backdrop"));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("appointment-backdrop")).not.toBeInTheDocument();

    // 2. Abrir e fechar clicando no botão Fechar
    fireEvent.click(screen.getByText("Carlos Silva"));
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
    const closeBtn = screen.getByRole("button", { name: "Fechar" });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 3. Abrir e fechar pressionando Escape
    fireEvent.click(screen.getByText("Carlos Silva"));
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 4. Confirma que os elementos da agenda continuam operacionais
    expect(screen.getByTestId("calendar-scroll-container")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-header-row")).toHaveClass("sticky top-0 z-40");
    unmount();
  });

  it("F. HEADER SYNC REGRESSION: Cabeçalho continua no mesmo container scroll e sincronizado", () => {
    render(<CalendarGrid {...defaultProps} />);

    const scrollContainer = screen.getByTestId("calendar-scroll-container");
    const headerRow = screen.getByTestId("calendar-header-row");
    const corner = screen.getByTestId("calendar-top-left-corner");

    expect(scrollContainer).toContainElement(headerRow);
    expect(scrollContainer).toContainElement(corner);

    for (const m of membersMock) {
      const headerCell = screen.getByTestId("calendar-member-header-" + m.id);
      const colCell = screen.getByTestId("calendar-member-column-" + m.id);
      expect(scrollContainer).toContainElement(headerCell);
      expect(scrollContainer).toContainElement(colCell);
    }
  });

  it("G. TIME GUTTER REGRESSION: Coluna de horários continua sticky com z-[35]", () => {
    render(<CalendarGrid {...defaultProps} />);

    const timeGutter = screen.getByTestId("calendar-time-gutter");
    expect(timeGutter).toHaveClass("sticky left-0 z-[35]");
    expect(timeGutter).toHaveTextContent("08:00");
    expect(timeGutter).toHaveTextContent("12:00");
  });

  it("H. SINGLE MEMBER: Agenda com 1 profissional abre overlay acima de tudo", () => {
    render(<CalendarGrid {...defaultProps} filterMember="mem-dandara" />);

    expect(screen.getAllByTestId(/^calendar-member-header-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^calendar-member-column-/)).toHaveLength(1);

    fireEvent.click(screen.getByText("Carlos Silva"));

    const panel = screen.getByTestId("appointment-panel");
    const backdrop = screen.getByTestId("appointment-backdrop");
    const headerRow = screen.getByTestId("calendar-header-row");

    expect(panel).toBeInTheDocument();
    expect(backdrop).toBeInTheDocument();
    expect(extractZIndex(panel)).toBe(80);
    expect(extractZIndex(headerRow)).toBe(40);
  });

  it("I. MULTI MEMBER: Agenda com múltiplos profissionais mantém alinhamento e overlay superior", () => {
    render(<CalendarGrid {...defaultProps} />);

    expect(screen.getAllByTestId(/^calendar-member-header-/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^calendar-member-column-/)).toHaveLength(3);

    fireEvent.click(screen.getByText("Carlos Silva"));

    const panel = screen.getByTestId("appointment-panel");
    expect(extractZIndex(panel)).toBe(80);
    expect(document.body).toContainElement(panel);
  });

  const mobileViewports = [330, 360, 390, 430];
  for (const width of mobileViewports) {
    it("J. MOBILE (" + width + "px): Overlay cobre a viewport e painel é renderizado acima do sticky header", () => {
      window.innerWidth = width;
      render(<CalendarGrid {...defaultProps} />);

      fireEvent.click(screen.getByText("Carlos Silva"));

      const root = screen.getByTestId("appointment-overlay-root");
      const backdrop = screen.getByTestId("appointment-backdrop");
      const panel = screen.getByTestId("appointment-panel");

      expect(root).toHaveClass("fixed inset-0 z-[70]");
      expect(backdrop).toHaveClass("fixed inset-0 z-[70]");
      expect(panel).toHaveClass("relative z-[80]");
      expect(panel.className).toContain("overflow-y-auto");
      expect(panel.className).toContain("max-h-[90vh]");
    });
  }

  it("K. DESKTOP (>=1280px): Overlay centralizado e z-index superior a todos os elementos da agenda", () => {
    window.innerWidth = 1280;
    render(<CalendarGrid {...defaultProps} />);

    fireEvent.click(screen.getByText("Carlos Silva"));

    const root = screen.getByTestId("appointment-overlay-root");
    const panel = screen.getByTestId("appointment-panel");
    const headerRow = screen.getByTestId("calendar-header-row");
    const corner = screen.getByTestId("calendar-top-left-corner");

    expect(root).toHaveClass("sm:items-center");
    expect(extractZIndex(panel)).toBe(80);
    expect(extractZIndex(corner)).toBe(50);
    expect(extractZIndex(headerRow)).toBe(40);
    expect(extractZIndex(panel)).toBeGreaterThan(extractZIndex(corner));
    expect(extractZIndex(panel)).toBeGreaterThan(extractZIndex(headerRow));
  });

  it("L. PROPAGAÇÃO: Clique dentro do painel NÃO fecha o modal por bubbling", () => {
    render(<CalendarGrid {...defaultProps} />);

    fireEvent.click(screen.getByText("Carlos Silva"));
    const panel = screen.getByTestId("appointment-panel");
    expect(panel).toBeInTheDocument();

    // Clique em elementos internos do painel não deve fechar o modal
    fireEvent.click(panel);
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();

    const serviceTitle = screen.getByText("Serviços");
    fireEvent.click(serviceTitle);
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
  });

  it("M. CICLO DE VIDA: Múltiplas aberturas e fechamentos sucessivos funcionam sem nós órfãos ou regressão", () => {
    render(<CalendarGrid {...defaultProps} />);

    for (let i = 0; i < 3; i++) {
      // Abre
      fireEvent.click(screen.getByText("Carlos Silva"));
      expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
      expect(screen.getByTestId("appointment-backdrop")).toBeInTheDocument();

      // Fecha via Escape
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("appointment-backdrop")).not.toBeInTheDocument();
    }

    // Abre novamente e fecha via clique no backdrop
    fireEvent.click(screen.getByText("Carlos Silva"));
    expect(screen.getByTestId("appointment-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("appointment-backdrop"));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // Grade permanece 100% íntegra
    expect(screen.getByTestId("calendar-header-row")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-time-gutter")).toBeInTheDocument();
  });

  it("N. AÇÕES OPERACIONAIS: Callbacks operacionais (Abrir Atendimento, Editar, Cancelar, Excluir, Falta) disparam com o mesmo appointment", async () => {
    const onOpenComanda = vi.fn();
    const onEdit = vi.fn();
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <CalendarGrid
        {...defaultProps}
        onOpenComanda={onOpenComanda}
        onEdit={onEdit}
        onCancel={onCancel}
        onDelete={onDelete}
        onStatusChange={onStatusChange}
      />
    );

    // 1. Abrir Atendimento
    fireEvent.click(screen.getByText("Carlos Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir Atendimento" }));
    expect(onOpenComanda).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 2. Editar
    fireEvent.click(screen.getByText("Carlos Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 3. Cancelar
    fireEvent.click(screen.getByText("Carlos Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 4. Excluir agendamento
    fireEvent.click(screen.getByText("Carlos Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Excluir agendamento" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(screen.queryByTestId("appointment-panel")).not.toBeInTheDocument();

    // 5. Marcar como Falta
    fireEvent.click(screen.getByText("Carlos Silva"));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como Falta" }));
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("app-1", "NO_SHOW");
    });
  });
});