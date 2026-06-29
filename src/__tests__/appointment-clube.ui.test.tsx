import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentModal } from "@/app/admin/agendamentos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const members = [{ id: "member-a", user: { name: "Bruno Smoke" } }];
const services = [
  { id: "svc-a", name: "Corte", price: "40.00", durationMin: 30 },
  { id: "svc-b", name: "Barba", price: "30.00", durationMin: 30 }
];
const customer = { id: "customer-a", name: "Maria Souza", phone: "(17) 98888-8888" };

function renderModal(onSaved = vi.fn()) {
  return render(
    <AppointmentModal
      appointment={null}
      members={members}
      barbershopServices={services}
      currentDate="2026-07-20"
      initialState={{ memberId: "member-a", dateTime: "2026-07-20T12:00" }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />
  );
}

describe("UI Cliente Clube no Modal de Agendamentos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== "undefined" && (window as any).__clubBalanceCache) {
      for (const key in (window as any).__clubBalanceCache) {
        delete (window as any).__clubBalanceCache[key];
      }
    }
  });

  it("1. Cliente sem Clube: modal mantém preço normal e não mostra badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        if (url.includes("/api/admin/clients/search")) {
          return { ok: true, json: async () => ({ clients: [customer] }) };
        }
        if (url.includes("/balance")) {
          return { ok: true, json: async () => ({ benefits: [] }) };
        }
        return { ok: false };
      })
    );

    const user = userEvent.setup();
    renderModal();

    // Buscar e selecionar cliente
    await user.type(screen.getByTitle("Cliente"), "Maria");
    await waitFor(() => {
      expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Maria Souza"));

    // Esperar fechar busca e preencher dados
    await waitFor(() => {
      expect(screen.queryByText("Clientes encontrados")).not.toBeInTheDocument();
    });

    // Validar preço original e ausência de badge do clube
    expect(screen.queryByText(/👑 Cliente Clube/)).not.toBeInTheDocument();
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
  });

  it("2. Cliente com Clube ACTIVE: mostra badge Cliente Clube e serviço coberto R$ 0,00", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        if (url.includes("/api/admin/clients/search")) {
          return { ok: true, json: async () => ({ clients: [customer] }) };
        }
        if (url.includes("/balance")) {
          return {
            ok: true,
            json: async () => ({
              subscriptionId: "sub-1",
              clubPlan: { id: "plan-1", name: "Premium VIP" },
              cycle: { start: "2026-06-20", end: "2026-07-20" },
              benefits: [
                {
                  id: "ben-1",
                  benefitType: "INCLUDED_SERVICE",
                  serviceId: "svc-a",
                  availableQty: 2,
                  includedQty: 2,
                }
              ]
            })
          };
        }
        return { ok: false };
      })
    );

    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Cliente"), "Maria");
    await waitFor(() => {
      expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Maria Souza"));

    await waitFor(() => {
      expect(screen.getByText("👑 Cliente Clube: Premium VIP")).toBeInTheDocument();
    });

    // Serviço coberto
    expect(screen.getByText("Coberto (2 disp.)")).toBeInTheDocument();
    // Valor hoje: R$ 0,00
    expect(screen.getByText("R$ 0,00")).toBeInTheDocument();
    // Valor original riscado/secundário (strikethrough)
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
  });

  it("3. Cliente com Clube em inadimplência (PAST_DUE): exibe aviso de bloqueio e não cobre serviço", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        if (url.includes("/api/admin/clients/search")) {
          return { ok: true, json: async () => ({ clients: [customer] }) };
        }
        if (url.includes("/balance")) {
          return {
            ok: true,
            json: async () => ({
              status: "PAST_DUE",
              clubPlan: { id: "plan-1", name: "Premium VIP" },
              benefits: []
            })
          };
        }
        return { ok: false };
      })
    );

    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Cliente"), "Maria");
    await waitFor(() => {
      expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Maria Souza"));

    await waitFor(() => {
      expect(screen.getByText(/⚠️ Cliente possui plano sem cobertura ativa/)).toBeInTheDocument();
    });

    // Sem badge de ativo
    expect(screen.queryByText(/👑 Cliente Clube/)).not.toBeInTheDocument();
    // Sem badge de cobertura no serviço
    expect(screen.queryByText(/Coberto/)).not.toBeInTheDocument();
  });

  it("4. Serviço com desconto: exibe desconto e valor líquido previsto corretamente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        if (url.includes("/api/admin/clients/search")) {
          return { ok: true, json: async () => ({ clients: [customer] }) };
        }
        if (url.includes("/balance")) {
          return {
            ok: true,
            json: async () => ({
              subscriptionId: "sub-1",
              clubPlan: { id: "plan-1", name: "Premium VIP" },
              cycle: { start: "2026-06-20", end: "2026-07-20" },
              benefits: [
                {
                  id: "ben-1",
                  benefitType: "SERVICE_DISCOUNT",
                  serviceId: "svc-a",
                  discountPercent: 20
                }
              ]
            })
          };
        }
        return { ok: false };
      })
    );

    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Cliente"), "Maria");
    await waitFor(() => {
      expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Maria Souza"));

    await waitFor(() => {
      expect(screen.getByText("-20% Clube")).toBeInTheDocument();
    });

    // Preço hoje com desconto: 40 - 20% = R$ 32,00
    expect(screen.getByText("R$ 32,00")).toBeInTheDocument();
  });

  it("5. Serviço com saldo esgotado: mostra aviso de limite esgotado e mantém valor normal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        if (url.includes("/api/admin/clients/search")) {
          return { ok: true, json: async () => ({ clients: [customer] }) };
        }
        if (url.includes("/balance")) {
          return {
            ok: true,
            json: async () => ({
              subscriptionId: "sub-1",
              clubPlan: { id: "plan-1", name: "Premium VIP" },
              cycle: { start: "2026-06-20", end: "2026-07-20" },
              benefits: [
                {
                  id: "ben-1",
                  benefitType: "INCLUDED_SERVICE",
                  serviceId: "svc-a",
                  availableQty: 0,
                  includedQty: 2
                }
              ]
            })
          };
        }
        return { ok: false };
      })
    );

    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByTitle("Cliente"), "Maria");
    await waitFor(() => {
      expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Maria Souza"));

    await waitFor(() => {
      expect(screen.getByText("Limite Esgotado")).toBeInTheDocument();
    });

    // Mantém valor original
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });
});
