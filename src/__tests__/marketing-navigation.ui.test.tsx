import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ADMIN_NAV_CONFIG, getVisibleNavItems } from "@/components/admin/navigation/nav-config";
import { MobileBottomNavigation } from "@/components/admin/navigation/MobileBottomNavigation";
import { resolveSidebarActiveState } from "@/components/admin/Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/marketing/sorteios",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("Marketing Navigation — Submenus e Integridade Mobile", () => {
  it("configura exatamente os 3 submenus sob Marketing no nav-config", () => {
    const marketingItem = ADMIN_NAV_CONFIG.find((item) => item.href === "/admin/marketing");
    expect(marketingItem).toBeDefined();
    expect(marketingItem?.children.length).toBe(3);

    const labels = marketingItem?.children.map((c) => c.label);
    expect(labels).toEqual(["Visão geral", "Sorteios de clientes", "Vitrine pública"]);

    const hrefs = marketingItem?.children.map((c) => c.href);
    expect(hrefs).toEqual([
      "/admin/marketing",
      "/admin/marketing/sorteios",
      "/admin/marketing/vitrine",
    ]);
  });

  it("resolve estado ativo da Sidebar para a subrota /admin/marketing/sorteios", () => {
    const items = getVisibleNavItems({ userRole: "OWNER" });
    const resolved = resolveSidebarActiveState({
      items,
      pathname: "/admin/marketing/sorteios",
    });

    expect(resolved.activeGroupHref).toBe("/admin/marketing");
    expect(resolved.activeItemHref).toBe("/admin/marketing/sorteios");
  });

  it("preserva a barra inferior mobile com exatamente 5 botões (sem adicionar abas)", () => {
    render(<MobileBottomNavigation onOpenMenu={vi.fn()} canAccessFinancial={true} />);

    // Deve conter Início, Agenda, Comandas, Financeiro e Menu
    expect(screen.getByText("Início")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Comandas")).toBeInTheDocument();
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    expect(screen.getByText("Menu")).toBeInTheDocument();

    // Não deve conter Sorteios ou Marketing na barra inferior fixa
    expect(screen.queryByText("Sorteios")).toBeNull();
    expect(screen.queryByText("Marketing")).toBeNull();
  });
});
