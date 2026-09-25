import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarGrid } from "@/components/agenda/CalendarGrid";
import { Member } from "@/components/agenda/types";

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

  it("Itens 2, 3, 4 e 5: Sticky classes, z-indexes e paridade exata de largura", () => {
    const { container } = render(<CalendarGrid {...defaultProps} />);

    // Header row deve ser sticky top-0 com z-40 e fundo opaco
    const headerRow = container.querySelector(".sticky.top-0.z-40");
    expect(headerRow).toBeInTheDocument();
    expect(headerRow?.className).toContain("bg-[var(--surface-1)]");

    // Canto superior esquerdo deve ser sticky top-0 left-0 com z-50
    const topLeftCorner = container.querySelector(".sticky.top-0.left-0.z-50");
    expect(topLeftCorner).toBeInTheDocument();

    // Time gutter deve ser sticky left-0 com z-20 e fundo opaco
    const timeGutter = container.querySelector(".sticky.left-0.z-20");
    expect(timeGutter).toBeInTheDocument();
    expect(timeGutter?.className).toContain("bg-[var(--background)]");

    // Paridade de largura entre header e coluna
    const expectedWidthClasses = ["flex-1", "min-w-[280px]", "lg:min-w-[320px]"];

    const headerDandara = screen.getByTestId("calendar-member-header-mem-dandara");
    const colDandara = screen.getByTestId("calendar-member-column-mem-dandara");

    for (const cls of expectedWidthClasses) {
      expect(headerDandara.className).toContain(cls);
      expect(colDandara.className).toContain(cls);
    }
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
