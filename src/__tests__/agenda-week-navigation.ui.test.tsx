import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AdminSchedulePage, { getWeekDays } from "@/app/admin/agendamentos/page";

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams("date=2026-08-05"),
  useParams: () => ({}),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "admin-1", role: "OWNER" } },
    status: "authenticated",
  }),
}));

describe("P1 UX Agenda - Navegação Rápida por Dias da Semana", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1 - getWeekDays gera 7 dias (Segunda a Domingo) contendo a data selecionada", () => {
    const days = getWeekDays("2026-08-05"); // Quarta-feira 05/08/2026

    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ iso: "2026-08-03", weekday: "Seg", dayNum: "03", label: "Seg 03" });
    expect(days[1]).toEqual({ iso: "2026-08-04", weekday: "Ter", dayNum: "04", label: "Ter 04" });
    expect(days[2]).toEqual({ iso: "2026-08-05", weekday: "Qua", dayNum: "05", label: "Qua 05" });
    expect(days[3]).toEqual({ iso: "2026-08-06", weekday: "Qui", dayNum: "06", label: "Qui 06" });
    expect(days[4]).toEqual({ iso: "2026-08-07", weekday: "Sex", dayNum: "07", label: "Sex 07" });
    expect(days[5]).toEqual({ iso: "2026-08-08", weekday: "Sáb", dayNum: "08", label: "Sáb 08" });
    expect(days[6]).toEqual({ iso: "2026-08-09", weekday: "Dom", dayNum: "09", label: "Dom 09" });
  });

  it("T2, T3, T4, T5, T6, T7, T8 - Faixa de dias renderiza no DOM, destaca o dia selecionado e permite trocar data", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/appointments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              appointments: [],
              scheduleBlocks: [],
              members: [{ id: "barber-1", user: { name: "Joao Barber" }, startTime: "09:00", endTime: "18:00" }],
              barbershopName: "Tem Barber",
              barbershopSlug: "tem-barber",
            }),
        } as Response);
      }
      if (url.startsWith("/api/admin/services")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    });

    render(<AdminSchedulePage />);

    // T1: Renderiza os 7 dias da semana
    expect(await screen.findByRole("button", { name: "Seg 03" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ter 04" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qua 05" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qui 06" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sex 07" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sáb 08" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dom 09" })).toBeInTheDocument();

    // T2: Dia selecionado (Qua 05) está destacado
    const selectedDayBtn = screen.getByRole("button", { name: "Qua 05" });
    expect(selectedDayBtn.className).toContain("bg-amber-500/20");

    // T3 & T4: Clicar em Sex 07 navega para ?date=2026-08-07
    fireEvent.click(screen.getByRole("button", { name: "Sex 07" }));
    expect(pushMock).toHaveBeenCalledWith("/admin/agendamentos?date=2026-08-07");

    // T5: Setas continuam funcionando
    fireEvent.click(screen.getByTitle("Dia anterior"));
    expect(pushMock).toHaveBeenCalledWith("/admin/agendamentos?date=2026-08-04");

    fireEvent.click(screen.getByTitle("Próximo dia"));
    expect(pushMock).toHaveBeenCalledWith("/admin/agendamentos?date=2026-08-06");

    // T6: Filtro por barbeiro
    const filterSelect = screen.getByTitle("Filtrar por barbeiro");
    fireEvent.change(filterSelect, { target: { value: "barber-1" } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("memberId=barber-1"));
    });

    // T7: Faixa tem scroll horizontal (overflow-x-auto)
    const weekStrip = screen.getByRole("button", { name: "Seg 03" }).parentElement;
    expect(weekStrip?.className).toContain("overflow-x-auto");

    // T8: Endpoint de appointments é chamado com a data
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/admin/appointments?date=2026-08-05"));
  });
});
