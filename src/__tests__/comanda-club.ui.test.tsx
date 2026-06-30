import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComandaItemCard } from "@/components/admin/comanda/ComandaItemCard";

describe("ComandaItemCard UI and Club Benefit Toggle Tests", () => {
  const defaultItem = {
    id: "item-1",
    type: "SERVICE",
    status: "PENDING",
    description: "Corte Masculino Tradicional",
    quantity: "1.000",
    unitPrice: "45.00",
    total: "45.00",
    serviceId: "svc-corte",
    executor: { id: "barber-1", user: { name: "Lucas" } },
    clubBenefitRequested: false,
    requestedClubPlanBenefitId: null,
    clubBenefitUsage: null,
  };

  const mockClubBalance = {
    status: "ACTIVE",
    clubPlan: {
      id: "plan-corte",
      name: "Corte 2.0",
      monthlyPrice: 100.00,
    },
    benefits: [
      {
        id: "ben-1",
        benefitType: "INCLUDED_SERVICE",
        serviceId: "svc-corte",
        productId: null,
        includedQty: 8,
        usedQty: 0,
        availableQty: 8,
        pointWeight: 100,
      }
    ],
  };

  it("should render item details normally when club benefit is not requested", () => {
    render(
      <ComandaItemCard
        item={defaultItem}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        clubBalance={mockClubBalance}
      />
    );

    expect(screen.getByText("Corte Masculino Tradicional")).toBeInTheDocument();
    expect(screen.getByText("R$ 45,00")).toBeInTheDocument();
    expect(screen.queryByText("(Coberto pelo Clube)")).not.toBeInTheDocument();
  });

  it("should show coberto pelo clube and price as R$ 0,00 when club benefit is requested", () => {
    const requestedItem = {
      ...defaultItem,
      clubBenefitRequested: true,
      requestedClubPlanBenefitId: "ben-1",
    };

    render(
      <ComandaItemCard
        item={requestedItem}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        clubBalance={mockClubBalance}
      />
    );

    expect(screen.getByText("(Coberto pelo Clube)")).toBeInTheDocument();
    expect(screen.getByText("R$ 0,00")).toBeInTheDocument();
  });

  it("should toggle clubBenefitRequested when clicking the checkbox", () => {
    const onUpdateMock = vi.fn();
    render(
      <ComandaItemCard
        item={defaultItem}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={onUpdateMock}
        clubBalance={mockClubBalance}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: /Usar pelo Clube/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onUpdateMock).toHaveBeenCalledWith("item-1", {
      clubBenefitRequested: true,
      requestedClubPlanBenefitId: "ben-1",
    });
  });

  it("should disable checkbox when available quantity is 0", () => {
    const exhaustedBalance = {
      ...mockClubBalance,
      benefits: [
        {
          ...mockClubBalance.benefits[0],
          availableQty: 0,
        }
      ],
    };

    render(
      <ComandaItemCard
        item={defaultItem}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
        clubBalance={exhaustedBalance}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: /Usar pelo Clube/i });
    expect(checkbox).toBeDisabled();
  });
});
