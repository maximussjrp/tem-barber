import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routerMock } = vi.hoisted(() => ({
  routerMock: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/admin/configuracoes/plano-cobranca",
  useSearchParams: () => new URLSearchParams(),
}));

import PlanoCobrancaPage from "@/app/admin/configuracoes/plano-cobranca/page";

const EMPTY_PROFILE = {
  completed: false,
  personType: null,
  legalName: null,
  billingEmail: null,
  billingPhone: null,
  documentConfigured: false,
  cpfCnpjMasked: null,
};

const COMPLETE_PROFILE = {
  completed: true,
  personType: "INDIVIDUAL",
  legalName: "Barbearia Teste Ltda",
  billingEmail: "financeiro@example.com",
  billingPhone: "11999999999",
  documentConfigured: true,
  cpfCnpjMasked: "***.***.***-25",
};

const OWNER_STATUS = {
  hasSubscription: false,
  accessStatus: "TRIAL",
  permissions: { canEditProfile: true, canSubscribe: true },
};

function mockFetch(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (handler) {
      const result = await handler(url, init);
      if (result) return result;
    }

    if (url.includes("/api/admin/billing/profile")) {
      return Response.json(EMPTY_PROFILE);
    }

    if (url.includes("/api/admin/billing/asaas/status")) {
      return Response.json(OWNER_STATUS);
    }

    if (url.includes("/api/admin/billing/asaas/current-payment")) {
      return Response.json({ exists: false });
    }

    return Response.json({});
  }) as unknown as typeof fetch;
}

describe("Plano e cobranca Asaas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch();
  });

  it("apresenta somente o Plano Tem Barber sem comparacao de planos", async () => {
    render(<PlanoCobrancaPage />);

    expect((await screen.findAllByText("Plano Tem Barber")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 49,90").length).toBeGreaterThan(0);
    expect(screen.getByText(/Tudo o que sua barbearia precisa em um único plano/i)).toBeInTheDocument();
    expect(screen.queryByText("Plano Pro")).not.toBeInTheDocument();
    expect(screen.queryByText("Plano Premium")).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/downgrade/i)).not.toBeInTheDocument();
  });

  it("salva perfil sem criar customer ou assinatura", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];

    mockFetch((url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      if (url.includes("/api/admin/billing/profile") && init?.method === "PUT") {
        return Response.json(COMPLETE_PROFILE);
      }

      return undefined as unknown as Response;
    });

    render(<PlanoCobrancaPage />);

    const nameInput = await screen.findByLabelText(/Nome completo ou razão social/i);
    fireEvent.change(nameInput, { target: { value: "Barbearia Teste Ltda" } });
    fireEvent.change(screen.getByLabelText(/CPF|CNPJ/i), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText(/E-mail financeiro/i), { target: { value: "financeiro@example.com" } });
    fireEvent.change(screen.getByLabelText(/Telefone financeiro/i), { target: { value: "11999999999" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar dados de faturamento/i }));

    await waitFor(() => {
      expect(screen.getByText(/Dados de faturamento salvos/i)).toBeInTheDocument();
    });

    expect(calls.some((call) => call.url.includes("/api/admin/billing/asaas/subscription"))).toBe(false);
    expect(calls.find((call) => call.url.includes("/api/admin/billing/profile") && call.body)?.body).toMatchObject({
      personType: "INDIVIDUAL",
      legalName: "Barbearia Teste Ltda",
      cpfCnpj: "52998224725",
      billingEmail: "financeiro@example.com",
      billingPhone: "11999999999",
    });
    expect(screen.getByDisplayValue("***.***.***-25")).toBeInTheDocument();
  });

  it("cancelar modal nao cria assinatura", async () => {
    const user = userEvent.setup();
    const subscriptionCalls: RequestInit[] = [];

    mockFetch((url, init) => {
      if (url.includes("/api/admin/billing/profile")) return Response.json(COMPLETE_PROFILE);
      if (url.includes("/api/admin/billing/asaas/subscription")) subscriptionCalls.push(init ?? {});
      return undefined as unknown as Response;
    });

    render(<PlanoCobrancaPage />);

    await user.click(await screen.findByRole("button", { name: /Assinar plano por R\$ 49,90/i }));
    expect(screen.getByText(/R\$ 49,90 por mês/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar" }));

    expect(subscriptionCalls).toHaveLength(0);
  });

  it("nao envia value nem cycle ao confirmar assinatura", async () => {
    const user = userEvent.setup();
    let submittedPayload: Record<string, unknown> | null = null;

    mockFetch((url, init) => {
      if (url.includes("/api/admin/billing/profile")) return Response.json(COMPLETE_PROFILE);
      if (url.includes("/api/admin/billing/asaas/subscription")) {
        submittedPayload = JSON.parse(String(init?.body));
        return Response.json(
          { subscription: { planCode: "pro_monthly", value: "49.9", cycle: "MONTHLY" } },
          { status: 201 }
        );
      }
      return undefined as unknown as Response;
    });

    render(<PlanoCobrancaPage />);

    await user.click(await screen.findByLabelText("Boleto"));
    await user.click(screen.getByRole("button", { name: /Assinar plano por R\$ 49,90/i }));

    expect(screen.getByText(/R\$ 49,90 por mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Forma de pagamento escolhida: Boleto/i)).toBeInTheDocument();
    expect(screen.getByText(/Cobrança mensal recorrente/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar assinatura" }));

    await waitFor(() => {
      expect(submittedPayload).toEqual({
        planCode: "pro_monthly",
        billingType: "BOLETO",
      });
    });
  });
});
