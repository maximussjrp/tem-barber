import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Pages under test ──────────────────────────────────────────────────────────
import ClubeDashboardPage from "@/app/admin/clube/page";
import PlanosPage from "@/app/admin/clube/planos/page";
import AssinantesPage from "@/app/admin/clube/assinantes/page";
import FechamentosPage from "@/app/admin/clube/fechamentos/page";
import RelatoriosPage from "@/app/admin/clube/relatorios/page";

// ── Next.js stubs ─────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "plan-123" }),
  usePathname: () => "/admin/clube",
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PLAN = {
  id: "plan-123",
  name: "Plano Ouro",
  description: "Benefícios premium",
  monthlyPrice: "120.00",
  shopSharePercent: "50",
  barberPoolPercent: "50",
  isActive: true,
  benefits: [],
};

const SUBSCRIPTION = {
  id: "sub-abc",
  status: "ACTIVE",
  currentPeriodStart: "2026-06-01T00:00:00.000Z",
  currentPeriodEnd: "2026-07-01T00:00:00.000Z",
  customer: { id: "cust-1", name: "João Silva", phone: "11999999999" },
  clubPlan: { id: "plan-123", name: "Plano Ouro", monthlyPrice: "120.00", shopSharePercent: "50", barberPoolPercent: "50" },
};

const SETTLEMENT = {
  id: "settle-1",
  competence: "2026-06",
  status: "CALCULATED",
  totalRevenue: "360.00",
  shopAmount: "180.00",
  barberPoolAmount: "180.00",
  carryInAmount: "0.00",
  carryOutAmount: "0.00",
  totalPoints: "3.0000",
  members: [
    { id: "m1", barbershopMemberId: "bm-1", pointsShare: "3.0000", amount: "180.00", member: { user: { name: "Carlos" } } },
  ],
};

const USAGE = {
  id: "usage-1",
  barbershopId: "bs-1",
  subscriptionId: "sub-abc",
  competence: "2026-06",
  benefitType: "INCLUDED_SERVICE",
  status: "APPLIED",
  usedAt: "2026-06-15T10:00:00.000Z",
  originalAmount: "50.00",
  coveredAmount: "50.00",
  discountAmount: null,
  reversedAt: null,
  reversalReason: null,
  subscription: {
    customer: { name: "João Silva" },
    clubPlan: { name: "Plano Ouro" },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function mockFetch(map: Record<string, unknown>) {
  // Ordena por comprimento decrescente: padrões mais longos (mais específicos) têm prioridade
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [pattern, data] of entries) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
        });
      }
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  }) as unknown as typeof fetch;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("Fase 4 — UI do Plano Clube", () => {

  // 1. Dashboard
  it("1. renderiza dashboard com métricas do clube", async () => {
    mockFetch({
      "/api/admin/clube/plans":        [PLAN],
      "/api/admin/clube/subscriptions":[SUBSCRIPTION],
      "/api/admin/clube/settlements":  [SETTLEMENT],
    });

    render(<ClubeDashboardPage />);

    // Hão aguarda as métricas carregarem
    expect(await screen.findByText("Clube de Assinatura")).toBeInTheDocument();
    expect(await screen.findByText("Planos Ativos")).toBeInTheDocument();
    expect(await screen.findByText("Assinantes Ativos")).toBeInTheDocument();
    // Plano ativo = 1
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThan(0);
  });

  // 2. Lista planos
  it("2. lista planos com nome e preço", async () => {
    mockFetch({ "/api/admin/clube/plans": [PLAN] });

    render(<PlanosPage />);

    expect(await screen.findByText("Plano Ouro")).toBeInTheDocument();
    expect(screen.getByText(/120/)).toBeInTheDocument(); // preço
  });

  // 3. Cria plano via UI — valida campos
  it("3. abre modal de criação de plano ao clicar em Novo plano", async () => {
    mockFetch({ "/api/admin/clube/plans": [] });

    render(<PlanosPage />);

    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Novo plano")[0]);

    // O ClubModal renderiza o title como h2 com id="club-modal-title"
    expect(await screen.findByRole("heading", { name: "Novo plano" })).toBeInTheDocument();
  });

  // 4. Valida erro quando percentuais não somam 100%
  it("4. exibe aviso quando percentuais não somam 100%", async () => {
    mockFetch({ "/api/admin/clube/plans": [] });

    render(<PlanosPage />);

    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Novo plano")[0]);

    await screen.findByRole("heading", { name: "Novo plano" });

    // Preenche shopShare=60 e barberPool=20 (soma = 80, não 100)
    const allNumberInputs = document.querySelectorAll('input[type="number"]');
    // Os últimos dois inputs numéricos são shopShare e barberPool
    const shopInput = allNumberInputs[allNumberInputs.length - 2];
    const barberInput = allNumberInputs[allNumberInputs.length - 1];

    fireEvent.change(shopInput, { target: { value: "60" } });
    fireEvent.change(barberInput, { target: { value: "20" } });

    expect(await screen.findByText(/Soma deve ser 100%/i)).toBeInTheDocument();
  });

  // 5. Lista assinantes
  it("5. lista assinantes com nome e status ATIVO", async () => {
    mockFetch({
      "/api/admin/clube/subscriptions": [SUBSCRIPTION],
      "/api/admin/clube/plans":         [PLAN],
    });

    render(<AssinantesPage />);

    expect(await screen.findByText("João Silva")).toBeInTheDocument();
    // "Ativo" aparece tanto no botão de filtro quanto no badge — usa getAllByText
    const ativos = screen.getAllByText("Ativo");
    // Verifica que ao menos um é o badge (tag SPAN)
    const badge = ativos.find((el) => el.tagName === "SPAN" && el.className.includes("badge"));
    expect(badge).toBeInTheDocument();
  });

  // 6. Abre modal de vincular cliente
  it("6. abre modal de vincular cliente ao clube", async () => {
    mockFetch({
      "/api/admin/clube/subscriptions": [],
      "/api/admin/clube/plans":         [PLAN],
    });

    render(<AssinantesPage />);

    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Vincular cliente"));

    expect(await screen.findByText("Vincular cliente ao clube")).toBeInTheDocument();
  });

  // 7. Consulta saldo ao expandir assinante
  it("7. consulta saldo da assinatura ao expandir linha", async () => {
    mockFetch({
      "/api/admin/clube/subscriptions/sub-abc/balance": { benefits: [{ benefitType: "INCLUDED_SERVICE", used: 1, included: 2, remaining: 1 }] },
      "/api/admin/clube/subscriptions/sub-abc/payments": [],
      "/api/admin/clube/subscriptions":                  [SUBSCRIPTION],
      "/api/admin/clube/plans":                          [PLAN],
    });

    render(<AssinantesPage />);

    // Expande clicando na linha do assinante — o div expandível contém o nome
    const nameEl = await screen.findByText("João Silva");
    const rowEl = nameEl.closest('[class*="cursor-pointer"]');
    expect(rowEl).toBeInTheDocument();
    fireEvent.click(rowEl!);

    expect(await screen.findByText("Saldo de benefícios")).toBeInTheDocument();
  });

  // 8. Registra pagamento manual
  it("8. abre modal de pagamento manual ao clicar em registrar pagamento", async () => {
    mockFetch({
      "/api/admin/clube/subscriptions/sub-abc/balance": { benefits: [] },
      "/api/admin/clube/subscriptions/sub-abc/payments": [],
      "/api/admin/clube/subscriptions":                  [SUBSCRIPTION],
      "/api/admin/clube/plans":                          [PLAN],
    });

    render(<AssinantesPage />);

    fireEvent.click(await screen.findByText("João Silva"));
    fireEvent.click(await screen.findByText("+ Registrar pagamento"));

    expect(await screen.findByText("Registrar pagamento manual")).toBeInTheDocument();
  });

  // 9. Dashboard de fechamentos — carrega lista
  it("9. carrega lista de fechamentos com competência e status", async () => {
    mockFetch({ "/api/admin/clube/settlements": [SETTLEMENT] });

    render(<FechamentosPage />);

    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("Calculado")).toBeInTheDocument();
    expect(screen.getByText("Aprovar")).toBeInTheDocument();
  });

  // 10. Calcular fechamento via UI
  it("10. chama POST /calculate ao clicar em Calcular fechamento", async () => {
    const postFn = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SETTLEMENT) })
    );
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/settlements") && !url.includes("calculate") && (!init || init.method !== "POST")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url.includes("calculate")) return postFn();
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    render(<FechamentosPage />);

    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Calcular fechamento"));

    await waitFor(() => expect(postFn).toHaveBeenCalled());
  });

  // 11. Aprovar fechamento via UI
  it("11. mostra diálogo de aprovação ao clicar em Aprovar", async () => {
    mockFetch({ "/api/admin/clube/settlements": [SETTLEMENT] });

    render(<FechamentosPage />);

    fireEvent.click(await screen.findByText("Aprovar"));

    expect(await screen.findByText("Aprovar fechamento")).toBeInTheDocument();
    expect(screen.getByText(/pontos serão liquidados/i)).toBeInTheDocument();
  });

  // 12. Marcar como pago
  it("12. exibe diálogo de Marcar como pago para fechamento APPROVED", async () => {
    mockFetch({
      "/api/admin/clube/settlements": [{ ...SETTLEMENT, status: "APPROVED" }],
    });

    render(<FechamentosPage />);

    expect(await screen.findByText("Marcar como pago")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Marcar como pago"));
    expect(await screen.findByText("Confirmar pagamento")).toBeInTheDocument();
  });

  // 13. Relatório de uso
  it("13. carrega relatório de uso com benefício APPLIED", async () => {
    mockFetch({ "/api/admin/clube/usage": [USAGE] });

    render(<RelatoriosPage />);

    expect(await screen.findByText("João Silva")).toBeInTheDocument();
    // Usa getAllByText pois "Aplicado" aparece no select option E no badge
    const aplicados = screen.getAllByText("Aplicado");
    expect(aplicados.length).toBeGreaterThanOrEqual(1);
    // Verifica que o badge específico está presente
    const badge = aplicados.find((el) => el.tagName === "SPAN");
    expect(badge).toBeInTheDocument();
    expect(screen.getByText("Serviço incluso")).toBeInTheDocument();
  });

  // 14. UI não chama rotas de comanda ou comissão
  it("14. UI do clube nunca chama rotas de comanda ou comissão", async () => {
    const calledUrls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    render(<ClubeDashboardPage />);
    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    render(<PlanosPage />);
    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    render(<FechamentosPage />);
    await waitFor(() => expect(screen.queryByText("Carregando...")).not.toBeInTheDocument());

    const forbidden = calledUrls.filter(
      (url) =>
        url.includes("/api/admin/comandas") ||
        url.includes("/api/admin/commissions") ||
        url.includes("/api/member/") ||
        url.includes("/api/client/")
    );

    expect(forbidden).toHaveLength(0);
  });
});
