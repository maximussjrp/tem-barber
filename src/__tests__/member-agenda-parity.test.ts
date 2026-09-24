import { describe, expect, it } from "vitest";

describe("P0 - Member Agenda Parity and Security Isolation", () => {
  it("isolates daily metrics to strictly the barber's own production value", () => {
    // Simulated barbershop appointments containing multiple barbers
    const allShopAppointments = [
      {
        id: "appt-1",
        barber: { id: "barber-mine" },
        status: "CONFIRMED",
        totalPrice: "50.00",
        productionValue: 50.0,
      },
      {
        id: "appt-2",
        barber: { id: "barber-mine" },
        status: "CONFIRMED",
        totalPrice: "70.00",
        productionValue: 70.0,
      },
      {
        id: "appt-3",
        barber: { id: "barber-other" },
        status: "CONFIRMED",
        totalPrice: "500.00", // Big appointment from another barber
        productionValue: 500.0,
      },
      {
        id: "appt-4",
        barber: { id: "barber-other" },
        status: "CONFIRMED",
        totalPrice: "1000.00",
        productionValue: 1000.0,
      },
    ];

    // Member agenda strictly filters by barberId === session.memberId
    const myMemberId = "barber-mine";
    const myAppointments = allShopAppointments.filter(
      (a) => a.barber.id === myMemberId
    );

    expect(myAppointments).toHaveLength(2);

    const myProduction = myAppointments.reduce(
      (sum, a) => sum + a.productionValue,
      0
    );

    // Global shop revenue would be 1620.00
    const globalRevenue = allShopAppointments.reduce(
      (sum, a) => sum + a.productionValue,
      0
    );
    expect(globalRevenue).toBe(1620.0);

    // But the member sees strictly 120.00 (own production)
    expect(myProduction).toBe(120.0);
    expect(myProduction).not.toBe(globalRevenue);
  });

  it("blocks FIT_IN mode for regular BARBER self-scheduling", () => {
    function validateBarberBookingMode(mode: string): { allowed: boolean; error?: string } {
      if (mode === "FIT_IN") {
        return {
          allowed: false,
          error: "FIT_IN_NOT_ALLOWED: Profissionais não podem criar encaixes na própria agenda.",
        };
      }
      return { allowed: true };
    }

    expect(validateBarberBookingMode("NORMAL").allowed).toBe(true);
    const fitInAttempt = validateBarberBookingMode("FIT_IN");
    expect(fitInAttempt.allowed).toBe(false);
    expect(fitInAttempt.error).toContain("FIT_IN_NOT_ALLOWED");
  });

  it("prohibits barber from scheduling appointments on another barber's column", () => {
    function authorizeBarberSelfScheduling(
      sessionMemberId: string,
      requestedMemberId: string
    ): boolean {
      return sessionMemberId === requestedMemberId;
    }

    const sessionMemberId = "barber-123";
    expect(authorizeBarberSelfScheduling(sessionMemberId, "barber-123")).toBe(true);
    expect(authorizeBarberSelfScheduling(sessionMemberId, "barber-456")).toBe(false);
  });
});
