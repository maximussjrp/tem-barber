import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanosPage from "@/app/admin/clube/planos/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "plan-123" }),
  usePathname: () => "/admin/clube/planos",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const SERVICES = [
  { id: "svc-a", name: "Corte", price: "40.00" },
  { id: "svc-b", name: "Barba", price: "30.00" }
];

const PLAN = {
  id: "plan-1",
  name: "Plano Ouro",
  description: "Descrição do plano",
  monthlyPrice: "100.00",
  shopSharePercent: "50",
  barberPoolPercent: "50",
  isActive: true,
  benefits: [
    {
      id: "ben-1",
      benefitType: "INCLUDED_SERVICE",
      serviceId: "svc-a",
      includedQty: 2,
      pointWeight: "1.50"
    }
  ]
};

function mockFetch(responses: Record<string, { ok: boolean; status: number; data: any }>) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    for (const [pattern, res] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        if (pattern.includes(":")) {
          const [method, path] = pattern.split(":");
          if (init?.method !== method || !url.includes(path)) {
            continue;
          }
        }
        return {
          ok: res.ok,
          status: res.status,
          json: async () => res.data,
        };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  }) as any;
}

describe("UI de Cadastro/Edição Simplificada de Planos do Clube", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Criação de plano com múltiplos serviços inclusos e validação de peso/quantidade", async () => {
    const user = userEvent.setup();
    mockFetch({
      "/api/admin/clube/plans": { ok: true, status: 200, data: [] },
      "/api/admin/services": { ok: true, status: 200, data: SERVICES }
    });

    render(<PlanosPage />);

    await user.click(screen.getByText("Novo plano"));

    await user.type(screen.getByPlaceholderText("Ex: Plano Ouro"), "Plano Premium");
    await user.type(screen.getByPlaceholderText("0,00"), "150");
    const poolInputs = screen.getAllByPlaceholderText("50");
    await user.type(poolInputs[0], "60");
    await user.type(poolInputs[1], "40");

    expect(screen.getByText(/Este plano ainda não possui serviços inclusos/)).toBeInTheDocument();

    const corteCheckbox = screen.getByTitle("Corte");
    await user.click(corteCheckbox);

    expect(screen.queryByText(/Este plano ainda não possui serviços inclusos/)).not.toBeInTheDocument();

    const qtyInput = screen.getByTitle("Quantidade mensal");
    const weightInput = screen.getByTitle("Peso no rateio dos barbeiros");

    fireEvent.change(qtyInput, { target: { value: "3" } });
    fireEvent.change(weightInput, { target: { value: "1.25" } });

    let submittedPayload: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/clube/plans") && init?.method === "POST") {
        submittedPayload = JSON.parse(init.body as string);
        return { ok: true, status: 201, data: {} };
      }
      if (url.includes("/api/admin/services")) {
        return { ok: true, status: 200, json: async () => SERVICES };
      }
      return { ok: true, status: 200, json: async () => [] };
    }) as any;

    await user.click(screen.getByText("Criar plano"));

    await waitFor(() => {
      expect(submittedPayload).not.toBeNull();
      expect(submittedPayload.name).toBe("Plano Premium");
      expect(submittedPayload.monthlyPrice).toBe(150);
      expect(submittedPayload.benefits).toHaveLength(1);
      expect(submittedPayload.benefits[0]).toEqual({
        benefitId: null,
        serviceId: "svc-a",
        includedQty: 3,
        pointWeight: 1.25
      });
    });
  }, 20000);

  it("2. Edição de plano existente com benefícios configurados e tratamento de AUDIT_LOCK", async () => {
    const user = userEvent.setup();
    mockFetch({
      "/api/admin/clube/plans": { ok: true, status: 200, data: [PLAN] },
      "/api/admin/services": { ok: true, status: 200, data: SERVICES }
    });

    render(<PlanosPage />);

    await waitFor(() => {
      expect(screen.getByText("Plano Ouro")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Editar"));

    await waitFor(() => {
      expect(screen.getByTitle("Corte")).toBeChecked();
      expect(screen.getByTitle("Quantidade mensal")).toHaveValue(2);
      expect(screen.getByTitle("Peso no rateio dos barbeiros")).toHaveValue(1.5);
    });

    await user.click(screen.getByTitle("Corte"));

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/clube/plans/plan-1") && init?.method === "PATCH") {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: "AUDIT_LOCK",
            message: "Este benefício já foi usado por clientes assinantes e não pode ser removido. O histórico foi preservado."
          })
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }) as any;

    await user.click(screen.getByText("Salvar"));

    await waitFor(() => {
      expect(screen.getByText(/Este benefício já foi usado por clientes assinantes e não pode ser removido/)).toBeInTheDocument();
    });
  }, 20000);
});
