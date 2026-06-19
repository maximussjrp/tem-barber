import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommissionConfigsPage from "@/app/admin/comissoes/configuracoes/page";

describe("configuracoes de comissao", () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/commissions/configs")) {
        return Promise.resolve({
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
      return Promise.resolve({ json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;
  });

  it("usa rotulo legivel em vez de chave tecnica como regra visivel", async () => {
    render(<CommissionConfigsPage />);

    expect(await screen.findByText("Max / Cabelo & Barba")).toBeInTheDocument();
    expect(screen.getByText("Profissional + categoria")).toBeInTheDocument();
    expect(screen.queryByText("member:member-a:category:category-a")).not.toBeInTheDocument();
  });
});
