import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommissionConfigsPage from "@/app/admin/comissoes/configuracoes/page";

describe("configuracoes de comissao - UI Comissão 2.0", () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/commissions/configs")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: "config-a",
                scopeKey: "member:member-a:category:category-a",
                type: "PERCENTAGE",
                value: "40",
                active: true,
                member: { user: { name: "Max" } },
                service: null,
                category: { name: "Cabelo & Barba" },
              },
            ]),
        });
      }
      if (url.includes("/api/admin/career-levels")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: "level-1",
                name: "Barbeiro Sênior",
                description: "Experiente",
                defaultCommissionRate: "45",
                sortOrder: 1,
                active: true,
              },
            ]),
        });
      }
      if (url.includes("/api/admin/commission-rules/matrix")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              services: [{ id: "s-1", name: "Corte Social", price: "50.00", categoryId: "c-1", category: { id: "c-1", name: "Cortes" } }],
              careerLevels: [{ id: "level-1", name: "Barbeiro Sênior", defaultCommissionRate: "45", sortOrder: 1 }],
              rules: [{ id: "r-1", serviceId: "s-1", careerLevelId: "level-1", commissionRate: "50", active: true }],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;
  });

  it("1. usa rótulo legível em vez de chave técnica na aba de regras específicas", async () => {
    render(<CommissionConfigsPage />);

    expect(await screen.findByText("Max / Cabelo & Barba")).toBeInTheDocument();
    expect(screen.getByText("Profissional + categoria")).toBeInTheDocument();
    expect(screen.queryByText("member:member-a:category:category-a")).not.toBeInTheDocument();
  });

  it("2. renderiza abas de 'Regras Específicas', 'Níveis de Carreira' e 'Matriz Serviço x Nível'", async () => {
    render(<CommissionConfigsPage />);

    expect(screen.getByText("Regras Específicas")).toBeInTheDocument();
    expect(screen.getByText("Níveis de Carreira")).toBeInTheDocument();
    expect(screen.getByText("Matriz Serviço x Nível")).toBeInTheDocument();
  });

  it("3. alterna para aba de Níveis de Carreira e exibe botão + Novo Nível e níveis cadastrados", async () => {
    render(<CommissionConfigsPage />);

    const levelsTab = screen.getByText("Níveis de Carreira");
    fireEvent.click(levelsTab);

    expect(await screen.findByText("+ Novo Nível")).toBeInTheDocument();
    expect(await screen.findByText("Barbeiro Sênior")).toBeInTheDocument();
  });

  it("4. alterna para aba de Matriz Serviço x Nível e exibe aviso de fallback e botão Salvar Matriz", async () => {
    render(<CommissionConfigsPage />);

    const matrixTab = screen.getByText("Matriz Serviço x Nível");
    fireEvent.click(matrixTab);

    expect(await screen.findByText(/💡 Aviso de Fallback e Prioridade/i)).toBeInTheDocument();
    expect(await screen.findByText("Corte Social")).toBeInTheDocument();
    expect(screen.getAllByText("Salvar Matriz").length).toBeGreaterThan(0);
  });
});
