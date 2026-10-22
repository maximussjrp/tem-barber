import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComandaItemCard } from "@/components/admin/comanda/ComandaItemCard";
import ComandaDetailPage from "@/app/admin/comandas/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "comanda-1" }),
}));

describe("TEMBARBER_UX1_1_SERVICE_UNCOMPLETE — ComandaItemCard & Reverter Conclusão", () => {
  const servicePending = {
    id: "item-service-1",
    type: "SERVICE",
    status: "PENDING",
    description: "Corte Degradê",
    quantity: "1.000",
    unitPrice: "50.00",
    total: "50.00",
    serviceId: "svc-1",
    executorId: "barber-1",
    executor: { id: "barber-1", user: { name: "Marcos Barbeiro" } },
    clubBenefitRequested: false,
    requestedClubPlanBenefitId: null,
    clubBenefitUsage: null,
  };

  const serviceDone = {
    ...servicePending,
    id: "item-service-2",
    status: "DONE",
    completedAt: "2026-10-22T10:00:00.000Z",
  };

  const productItemPending = {
    id: "item-prod-1",
    type: "PRODUCT",
    status: "PENDING",
    description: "Pomada Modeladora Matte",
    quantity: "1.000",
    unitPrice: "35.00",
    total: "35.00",
    productId: "prod-1",
    executorId: "barber-1",
    executor: { id: "barber-1", user: { name: "Marcos Barbeiro" } },
    clubBenefitRequested: false,
    requestedClubPlanBenefitId: null,
    clubBenefitUsage: null,
  };

  const productItemDone = {
    ...productItemPending,
    id: "item-prod-2",
    status: "DONE",
    completedAt: "2026-10-22T10:00:00.000Z",
  };

  it("1. Serviço pendente: exibe botão Concluir e botão Cancelar, sem botão de desmarcar", () => {
    const onConclude = vi.fn();
    const onCancel = vi.fn();
    const onUncomplete = vi.fn();

    render(
      <ComandaItemCard
        item={servicePending}
        busy={false}
        comandaClosed={false}
        onConclude={onConclude}
        onCancel={onCancel}
        onUncomplete={onUncomplete}
      />
    );

    expect(screen.getByRole("button", { name: /Concluir item Corte Degradê/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelar item Corte Degradê/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar como não concluído/i })).not.toBeInTheDocument();
  });

  it("2. Serviço concluído: exibe botão 'Marcar como não concluído' e não apresenta 'Cancelar' como alternativa direta", () => {
    const onConclude = vi.fn();
    const onCancel = vi.fn();
    const onUncomplete = vi.fn();

    render(
      <ComandaItemCard
        item={serviceDone}
        busy={false}
        comandaClosed={false}
        onConclude={onConclude}
        onCancel={onCancel}
        onUncomplete={onUncomplete}
      />
    );

    // Botão Marcar como não concluído deve estar visível
    const uncompleteBtn = screen.getByRole("button", { name: /Marcar como não concluído/i });
    expect(uncompleteBtn).toBeInTheDocument();

    // Botão Concluir e Cancelar não devem ser exibidos para o serviço concluído
    expect(screen.queryByRole("button", { name: /Concluir item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar item/i })).not.toBeInTheDocument();
  });

  it("3. Confirmação do usuário: abre diálogo de confirmação com título, descrição e botões obrigatórios", () => {
    const onUncomplete = vi.fn();

    render(
      <ComandaItemCard
        item={serviceDone}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUncomplete={onUncomplete}
      />
    );

    const uncompleteBtn = screen.getByRole("button", { name: /Marcar como não concluído/i });
    fireEvent.click(uncompleteBtn);

    // Diálogo de confirmação
    expect(screen.getByText("Marcar serviço como não concluído?")).toBeInTheDocument();
    expect(screen.getByText("O serviço voltará para Pendente e poderá ser ajustado antes de uma nova conclusão.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar alteração" })).toBeInTheDocument();

    // Clicar em Voltar fecha sem disparar onUncomplete
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onUncomplete).not.toHaveBeenCalled();
  });

  it("4. Confirmar alteração dispara onUncomplete com o id do item", () => {
    const onUncomplete = vi.fn();

    render(
      <ComandaItemCard
        item={serviceDone}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUncomplete={onUncomplete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Marcar como não concluído/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar alteração" }));

    expect(onUncomplete).toHaveBeenCalledTimes(1);
    expect(onUncomplete).toHaveBeenCalledWith("item-service-2");
  });

  it("5. Comanda fechada: nenhum botão de ação de conclusão ou desmarcação é exibido", () => {
    render(
      <ComandaItemCard
        item={serviceDone}
        busy={false}
        comandaClosed={true}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUncomplete={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /Marcar como não concluído/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Concluir item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar item/i })).not.toBeInTheDocument();
  });

  it("6. Item de produto PENDING: preserva botão 'Concluir' e 'Cancelar', sem 'Marcar como não concluído'", () => {
    const onConclude = vi.fn();
    const onCancel = vi.fn();

    render(
      <ComandaItemCard
        item={productItemPending}
        busy={false}
        comandaClosed={false}
        onConclude={onConclude}
        onCancel={onCancel}
        onUncomplete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Concluir item Pomada Modeladora Matte/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelar item Pomada Modeladora Matte/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar como não concluído/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Concluir item Pomada Modeladora Matte/i }));
    expect(onConclude).toHaveBeenCalledWith("item-prod-1");
  });

  it("7. Item de produto DONE: preserva botão 'Cancelar', não exibe 'Concluir' nem 'Marcar como não concluído'", () => {
    render(
      <ComandaItemCard
        item={productItemDone}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUncomplete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Cancelar item Pomada Modeladora Matte/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Concluir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar como não concluído/i })).not.toBeInTheDocument();
  });

  it("8. Acessibilidade e ergonomia mobile: botões possuem min-h-[44px] e touch-manipulation", () => {
    render(
      <ComandaItemCard
        item={serviceDone}
        busy={false}
        comandaClosed={false}
        onConclude={vi.fn()}
        onCancel={vi.fn()}
        onUncomplete={vi.fn()}
      />
    );

    const btn = screen.getByRole("button", { name: /Marcar como não concluído/i });
    expect(btn.className).toContain("min-h-[44px]");
    expect(btn.className).toContain("touch-manipulation");
  });
});

describe("TEMBARBER_UX1_1_SERVICE_UNCOMPLETE — Fluxo Completo na ComandaDetailPage", () => {
  function makeComanda(itemStatus: "DONE" | "PENDING") {
    return {
      id: "comanda-1",
      customerName: "Carlos Cliente",
      customerPhone: "11999999999",
      status: "OPEN",
      subtotal: "60.00",
      discountTotal: "0.00",
      surchargeTotal: "0.00",
      total: "60.00",
      paidTotal: "0.00",
      remainingTotal: "60.00",
      items: [
        {
          id: "item-svc-100",
          type: "SERVICE",
          status: itemStatus,
          description: "Corte Barba Completo",
          quantity: "1.000",
          unitPrice: "60.00",
          total: "60.00",
          serviceId: "svc-barba",
          executorId: "barber-1",
          executor: { id: "barber-1", user: { name: "Lucas Barbeiro" } },
          completedAt: itemStatus === "DONE" ? "2026-10-22T10:15:00.000Z" : null,
          clubBenefitRequested: false,
          requestedClubPlanBenefitId: null,
          clubBenefitUsage: null,
        },
      ],
      payments: [],
      permissions: { canManageDebt: true, canReopen: false },
    };
  }

  it("9. DONE -> PENDING: Usuário confirma desmarcação na página da comanda e UI atualiza imediatamente", async () => {
    let currentComanda = makeComanda("DONE");

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/comandas/comanda-1") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(currentComanda),
        } as Response);
      }
      if (url === "/api/admin/comandas/comanda-1/items/item-svc-100" && init?.method === "PATCH") {
        const payload = JSON.parse(init.body as string);
        expect(payload).toEqual({ status: "PENDING" });
        currentComanda = makeComanda("PENDING");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(currentComanda),
        } as Response);
      }
      if (url.startsWith("/api/admin/services")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      if (url === "/api/admin/products") return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: [] }) } as Response);
      if (url === "/api/admin/appointments") return Promise.resolve({ ok: true, json: () => Promise.resolve({ members: [] }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    render(<ComandaDetailPage />);

    // Espera carregar a comanda
    await waitFor(() => {
      expect(screen.getByText("Corte Barba Completo")).toBeInTheDocument();
    });

    // Item está Concluído e mostra botão Marcar como não concluído
    const uncompleteBtn = screen.getByRole("button", { name: /Marcar como não concluído/i });
    expect(uncompleteBtn).toBeInTheDocument();

    // Clica no botão e confirma no modal
    fireEvent.click(uncompleteBtn);
    const confirmBtn = screen.getByRole("button", { name: "Confirmar alteração" });
    fireEvent.click(confirmBtn);

    // Após sucesso do PATCH, a UI reflete status Pendente e mostra botões Concluir e Cancelar
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Concluir item/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Cancelar item/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Marcar como não concluído/i })).not.toBeInTheDocument();
  });

  it("10. PENDING -> DONE: Usuário pode concluir o serviço novamente após a correção", async () => {
    let currentComanda = makeComanda("PENDING");

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/comandas/comanda-1") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(currentComanda),
        } as Response);
      }
      if (url === "/api/admin/comandas/comanda-1/items/item-svc-100" && init?.method === "PATCH") {
        const payload = JSON.parse(init.body as string);
        expect(payload).toEqual({ status: "DONE" });
        currentComanda = makeComanda("DONE");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(currentComanda),
        } as Response);
      }
      if (url.startsWith("/api/admin/services")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      if (url === "/api/admin/products") return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: [] }) } as Response);
      if (url === "/api/admin/appointments") return Promise.resolve({ ok: true, json: () => Promise.resolve({ members: [] }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    render(<ComandaDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Concluir item/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Concluir item/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Marcar como não concluído/i })).toBeInTheDocument();
    });
  });

  it("11. PRODUCT PENDING -> DONE pela interface", async () => {
    const productComanda = {
      id: "comanda-1",
      customerName: "Carlos Cliente",
      customerPhone: "11999999999",
      status: "OPEN",
      subtotal: "35.00",
      discountTotal: "0.00",
      surchargeTotal: "0.00",
      total: "35.00",
      paidTotal: "0.00",
      remainingTotal: "35.00",
      items: [
        {
          id: "item-prod-999",
          type: "PRODUCT",
          status: "PENDING",
          description: "Gel Fixador Extra Forte",
          quantity: "1.000",
          unitPrice: "35.00",
          total: "35.00",
          productId: "prod-gel",
          executorId: "barber-1",
          executor: { id: "barber-1", user: { name: "Lucas Barbeiro" } },
          completedAt: null,
          clubBenefitRequested: false,
          requestedClubPlanBenefitId: null,
          clubBenefitUsage: null,
        },
      ],
      payments: [],
      permissions: { canManageDebt: true, canReopen: false },
    };

    let patchCalledWith: unknown = null;

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/admin/comandas/comanda-1") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(productComanda),
        } as Response);
      }
      if (url === "/api/admin/comandas/comanda-1/items/item-prod-999" && init?.method === "PATCH") {
        patchCalledWith = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ...productComanda,
            items: [{ ...productComanda.items[0], status: "DONE", completedAt: "2026-10-22T10:30:00.000Z" }],
          }),
        } as Response);
      }
      if (url.startsWith("/api/admin/services")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      if (url === "/api/admin/products") return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: [] }) } as Response);
      if (url === "/api/admin/appointments") return Promise.resolve({ ok: true, json: () => Promise.resolve({ members: [] }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });

    render(<ComandaDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Gel Fixador Extra Forte")).toBeInTheDocument();
    });

    // Produto pendente exibe botão Concluir
    const concludeBtn = screen.getByRole("button", { name: /Concluir item Gel Fixador Extra Forte/i });
    expect(concludeBtn).toBeInTheDocument();
    fireEvent.click(concludeBtn);

    await waitFor(() => {
      expect(patchCalledWith).toEqual({ status: "DONE" });
    });
  });
});
