import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

describe("CalendarGrid - Sincronização Horizontal do Cabeçalho e Colunas", () => {
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

  const defaultProps = {
    appointments: [],
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
    currentDate: "2026-09-25",
    onEmptySlotClick: vi.fn(),
    barbershopName: "Barbearia Modelo",
    mode: "admin" as const,
  };

  function extractZIndex(element: HTMLElement | null): number {
    if (!element) return 0;
    const match = element.className.match(/z-\[(\d+)\]/) || element.className.match(/\bz-(\d+)\b/);
    return match ? parseInt(match[1], 10) : 0;
  }

  it("Itens 1, 7 e 8: Header e colunas pertencem ao MESMO scroll container único", () => {
    render(<CalendarGrid {...defaultProps} />);

    // 1. Confirma existência do container único
    const scrollContainer = screen.getByTestId("calendar-scroll-container");
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer.className).toContain("overflow-auto");

    // 2. Confirma que os headers e as colunas estão contidos dentro dele
    const headerDandara = screen.getByTestId("calendar-member-header-mem-dandara");
    const headerJesus = screen.getByTestId("calendar-member-header-mem-jesus");
    const headerJoao = screen.getByTestId("calendar-member-header-mem-joao");

    const colDandara = screen.getByTestId("calendar-member-column-mem-dandara");
    const colJesus = screen.getByTestId("calendar-member-column-mem-jesus");
    const colJoao = screen.getByTestId("calendar-member-column-mem-joao");

    expect(scrollContainer).toContainElement(headerDandara);
    expect(scrollContainer).toContainElement(headerJesus);
    expect(scrollContainer).toContainElement(headerJoao);
    expect(scrollContainer).toContainElement(colDandara);
    expect(scrollContainer).toContainElement(colJesus);
    expect(scrollContainer).toContainElement(colJoao);

    // 3. Verifica que NÃO existe outro elemento com overflow-auto dentro do scrollContainer (único owner do scroll)
    const descendantScrollOwners = scrollContainer.querySelectorAll(
      ".overflow-auto, .overflow-x-auto, .overflow-x-scroll"
    );
    expect(descendantScrollOwners.length).toBe(0);
  });

  it("Itens 7 e 8: Ordem dos headers corresponde exatamente à ordem das colunas", () => {
    render(<CalendarGrid {...defaultProps} />);

    const headerDandara = screen.getByTestId("calendar-member-header-mem-dandara");
    const headerJesus = screen.getByTestId("calendar-member-header-mem-jesus");
    const headerJoao = screen.getByTestId("calendar-member-header-mem-joao");

    expect(headerDandara).toHaveTextContent("Dandara");
    expect(headerJesus).toHaveTextContent("Jesus");
    expect(headerJoao).toHaveTextContent("João");

    // Validação da ordem sequencial no DOM
    const allHeaders = screen.getAllByTestId(/^calendar-member-header-/);
    expect(allHeaders.map((el) => el.getAttribute("data-testid"))).toEqual([
      "calendar-member-header-mem-dandara",
      "calendar-member-header-mem-jesus",
      "calendar-member-header-mem-joao",
    ]);

    const allColumns = screen.getAllByTestId(/^calendar-member-column-/);
    expect(allColumns.map((el) => el.getAttribute("data-testid"))).toEqual([
      "calendar-member-column-mem-dandara",
      "calendar-member-column-mem-jesus",
      "calendar-member-column-mem-joao",
    ]);
  });

  it("Itens 2, 3, 4 e 5: Sticky classes e paridade exata de largura", () => {
    render(<CalendarGrid {...defaultProps} />);

    // Header row deve ser sticky top-0 com z-40 e fundo opaco
    const headerRow = screen.getByTestId("calendar-header-row");
    expect(headerRow).toBeInTheDocument();
    expect(headerRow.className).toContain("sticky");
    expect(headerRow.className).toContain("top-0");
    expect(headerRow.className).toContain("z-40");
    expect(headerRow.className).toContain("bg-[var(--surface-1)]");

    // Canto superior esquerdo deve ser sticky top-0 left-0 com z-50
    const topLeftCorner = screen.getByTestId("calendar-top-left-corner");
    expect(topLeftCorner).toBeInTheDocument();
    expect(topLeftCorner.className).toContain("sticky");
    expect(topLeftCorner.className).toContain("top-0");
    expect(topLeftCorner.className).toContain("left-0");
    expect(topLeftCorner.className).toContain("z-50");

    // Time gutter deve ser sticky left-0 com z-[35] e fundo opaco
    const timeGutter = screen.getByTestId("calendar-time-gutter");
    expect(timeGutter).toBeInTheDocument();
    expect(timeGutter.className).toContain("sticky");
    expect(timeGutter.className).toContain("left-0");
    expect(timeGutter.className).toContain("z-[35]");
    expect(timeGutter.className).toContain("bg-[var(--background)]");

    // Paridade de largura entre header e coluna
    const expectedWidthClasses = ["flex-1", "min-w-[280px]", "lg:min-w-[320px]"];

    const headerDandara = screen.getByTestId("calendar-member-header-mem-dandara");
    const colDandara = screen.getByTestId("calendar-member-column-mem-dandara");

    for (const cls of expectedWidthClasses) {
      expect(headerDandara.className).toContain(cls);
      expect(colDandara.className).toContain(cls);
    }
  });

  it("Item 1 e 2: Hierarquia estrita de z-index: ACTIVE_MEMBER_COLUMN_Z < TIME_GUTTER_Z < HEADER_Z < CORNER_Z", () => {
    const appointmentMock: Appointment = {
      id: "app-active-1",
      dateTime: "2026-09-25T10:00:00.000Z",
      durationMin: 30,
      totalPrice: "50.00",
      status: "CONFIRMED",
      notes: null,
      customer: { id: "cust-1", name: "Cliente Teste", phone: "11999999999" },
      barber: { id: "mem-dandara", user: { name: "Dandara", avatarUrl: null } },
      services: [],
    };

    render(<CalendarGrid {...defaultProps} appointments={[appointmentMock]} />);

    const headerRow = screen.getByTestId("calendar-header-row");
    const topLeftCorner = screen.getByTestId("calendar-top-left-corner");
    const timeGutter = screen.getByTestId("calendar-time-gutter");
    const normalCol = screen.getByTestId("calendar-member-column-mem-jesus");
    const targetCol = screen.getByTestId("calendar-member-column-mem-dandara");

    // Coluna normal possui z-10
    expect(extractZIndex(normalCol)).toBe(10);

    // Clica no appointment para torná-lo ativo (isOpen)
    const appElement = screen.getByText("Cliente Teste");
    fireEvent.click(appElement);

    // Coluna com bloco ativo é promovida para z-30
    expect(targetCol.className).toContain("z-30");

    const activeColZ = extractZIndex(targetCol);
    const timeGutterZ = extractZIndex(timeGutter);
    const headerZ = extractZIndex(headerRow);
    const cornerZ = extractZIndex(topLeftCorner);

    expect(activeColZ).toBe(30);
    expect(timeGutterZ).toBe(35);
    expect(headerZ).toBe(40);
    expect(cornerZ).toBe(50);

    // Validação estrita da ordem requisitada:
    // ACTIVE_MEMBER_COLUMN_Z < TIME_GUTTER_Z < HEADER_Z < CORNER_Z
    expect(activeColZ).toBeLessThan(timeGutterZ);
    expect(timeGutterZ).toBeLessThan(headerZ);
    expect(headerZ).toBeLessThan(cornerZ);
  });

  it("Item 6: Com apenas 1 profissional (cenário /member/agenda), mantém estrutura sem quebras", () => {
    render(<CalendarGrid {...defaultProps} filterMember="mem-dandara" />);

    const scrollContainer = screen.getByTestId("calendar-scroll-container");
    expect(scrollContainer).toBeInTheDocument();

    const headers = screen.getAllByTestId(/^calendar-member-header-/);
    const cols = screen.getAllByTestId(/^calendar-member-column-/);

    expect(headers.length).toBe(1);
    expect(cols.length).toBe(1);
    expect(headers[0]).toHaveTextContent("Dandara");
    expect(cols[0]).toHaveAttribute("data-testid", "calendar-member-column-mem-dandara");
  });
});
