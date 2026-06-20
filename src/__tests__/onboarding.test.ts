import { describe, expect, it } from "vitest";
import { buildOnboardingSteps, countCompletedOnboardingSteps } from "@/lib/onboarding";

describe("onboarding da barbearia", () => {
  it("calcula etapas concluidas com dados existentes", () => {
    const steps = buildOnboardingSteps({
      barbershop: {
        name: "Barbearia Premium Demo",
        slug: "barbearia-premium-demo",
        city: "Sao Paulo",
        phone: "11999999999",
        logoUrl: "/uploads/logo.png",
        coverUrl: null,
      },
      activeServicesCount: 6,
      activeWorkingHoursCount: 12,
      schedulableProfessionalsCount: 2,
    });

    expect(countCompletedOnboardingSteps(steps)).toBe(6);
    expect(steps.every((step) => step.done)).toBe(true);
  });

  it("mantem owner elegivel quando atende por servicos vinculados", () => {
    const steps = buildOnboardingSteps({
      barbershop: {
        name: "Owner Agenda",
        slug: "owner-agenda",
        city: "Sao Paulo",
        phone: "11999999999",
        logoUrl: null,
        coverUrl: null,
      },
      activeServicesCount: 1,
      activeWorkingHoursCount: 6,
      schedulableProfessionalsCount: 1,
    });

    expect(steps.find((step) => step.id === "professionals")?.done).toBe(true);
  });

  it("marca pendencias sem expor termos tecnicos", () => {
    const steps = buildOnboardingSteps({
      barbershop: {
        name: "Nova Barbearia",
        slug: "nova-barbearia",
        city: null,
        phone: null,
        logoUrl: null,
        coverUrl: null,
      },
      activeServicesCount: 0,
      activeWorkingHoursCount: 0,
      schedulableProfessionalsCount: 0,
    });

    expect(countCompletedOnboardingSteps(steps)).toBe(1);
    expect(steps.map((step) => `${step.title} ${step.description} ${step.feedback}`).join(" ")).not.toMatch(
      /tenant|scopeKey|memberId|barbershopId|slug tecnico/i
    );
  });
});
