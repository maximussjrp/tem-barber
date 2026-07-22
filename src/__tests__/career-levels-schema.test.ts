import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("CareerLevel and ServiceCommissionRule Schema PR #13", () => {
  it("permite instanciar objetos com os tipos do schema Prisma", () => {
    const careerLevelInput: Prisma.CareerLevelCreateInput = {
      name: "Barbeiro Sênior",
      description: "Profissional sênior com 5+ anos",
      sortOrder: 3,
      defaultCommissionRate: new Prisma.Decimal("50.00"),
      barbershop: {
        connect: { id: "barbershop-test-id" },
      },
    };

    expect(careerLevelInput.name).toBe("Barbeiro Sênior");
    expect(careerLevelInput.sortOrder).toBe(3);
    expect(careerLevelInput.defaultCommissionRate?.toString()).toBe("50");
  });

  it("permite criar regra de comissão de serviço por nível (ServiceCommissionRule)", () => {
    const ruleInput: Prisma.ServiceCommissionRuleCreateInput = {
      type: "PERCENTAGE",
      commissionRate: new Prisma.Decimal("45.00"),
      barbershop: { connect: { id: "barbershop-test-id" } },
      service: { connect: { id: "service-test-id" } },
      careerLevel: { connect: { id: "career-level-test-id" } },
    };

    expect(ruleInput.type).toBe("PERCENTAGE");
    expect(ruleInput.commissionRate.toString()).toBe("45");
  });

  it("garante que BarbershopMember pode ser instanciado com careerLevelId opcional", () => {
    const memberInputOptional: Prisma.BarbershopMemberCreateInput = {
      role: "BARBER",
      barbershop: { connect: { id: "barbershop-test-id" } },
      user: { connect: { id: "user-test-id" } },
      careerLevel: undefined,
    };

    const memberInputWithLevel: Prisma.BarbershopMemberCreateInput = {
      role: "BARBER",
      barbershop: { connect: { id: "barbershop-test-id" } },
      user: { connect: { id: "user-test-id" } },
      careerLevel: { connect: { id: "career-level-test-id" } },
    };

    expect(memberInputOptional.careerLevel).toBeUndefined();
    expect(memberInputWithLevel.careerLevel).toBeDefined();
  });
});
