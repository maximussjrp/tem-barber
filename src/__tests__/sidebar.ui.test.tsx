import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdminSidebar } from "../components/admin/Sidebar";
import { MemberNav } from "../components/member/MemberNav";

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/admin/agendamentos",
}));

describe("Sidebar Logo Fallback", () => {
  it("sidebar usa logo da barbearia quando existe", () => {
    render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo="http://example.com/logo.png"
        subtitle="Painel"
        userName="Admin"
      />
    );

    const img = screen.getAllByAltText("Don Brio")[0] as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("http://example.com/logo.png");
    expect(img).toHaveClass("object-contain");
  });

  it("sidebar exibe fallback quando logo falha ou nao existe", () => {
    // case 1: empty logo
    const { rerender } = render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo=""
        subtitle="Painel"
        userName="Admin"
      />
    );

    expect(screen.getAllByText("DB").length).toBeGreaterThan(0);

    // case 2: logo image load error
    rerender(
      <AdminSidebar
        barbershopName="Barbearia Smoke Premium"
        barbershopLogo="http://example.com/logo-broken.png"
        subtitle="Painel"
        userName="Admin"
      />
    );

    const img = screen.getAllByAltText("Barbearia Smoke Premium")[0] as HTMLImageElement;
    expect(img).toBeInTheDocument();

    // Trigger image error
    fireEvent.error(img);

    expect(screen.getAllByText("BSP").length).toBeGreaterThan(0);
    expect(screen.queryByAltText("Barbearia Smoke Premium")).toBeNull();
  });

  it("não substitui logo da barbearia por Tem Barber, mantendo white-label", () => {
    render(
      <AdminSidebar
        barbershopName="Smoke Premium"
        barbershopLogo="http://example.com/logo.png"
        subtitle="Painel"
        userName="Admin"
      />
    );

    expect(screen.getAllByText("Smoke Premium").length).toBeGreaterThan(0);
  });

  it("oculta o submenu de plano e cobranca para BARBER", () => {
    render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo=""
        subtitle="Painel"
        userName="Barbeiro"
        userRole="BARBER"
      />
    );

    expect(screen.getAllByText("Configurações").length).toBeGreaterThan(0);
    expect(screen.queryByText("Plano e cobranca")).toBeNull();
  });

  it("exibe Marketing no sidebar para OWNER", () => {
    render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo=""
        subtitle="Painel"
        userName="Admin"
        userRole="OWNER"
      />
    );

    expect(screen.getAllByText("Marketing").length).toBeGreaterThan(0);
  });

  it("exibe subitem Vitrine pública dentro de Marketing para OWNER", () => {
    render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo=""
        subtitle="Painel"
        userName="Admin"
        userRole="OWNER"
      />
    );

    // Click Marketing to expand it
    const marketingButtons = screen.getAllByText("Marketing");
    fireEvent.click(marketingButtons[0]);

    expect(screen.getAllByText("Vitrine pública").length).toBeGreaterThan(0);
  });

  it("oculta Marketing no sidebar para BARBER", () => {
    render(
      <AdminSidebar
        barbershopName="Don Brio"
        barbershopLogo=""
        subtitle="Painel"
        userName="Barbeiro"
        userRole="BARBER"
      />
    );

    expect(screen.queryByText("Marketing")).toBeNull();
  });
});

describe("MemberNav Logo Fallback", () => {
  it("member nav usa logo da barbearia quando existe", () => {
    render(
      <MemberNav
        barbershopName="Don Brio"
        barbershopLogo="http://example.com/logo.png"
        subtitle="Membro"
        memberName="Bruno"
        avatarUrl={null}
        role="BARBER"
      />
    );

    const img = screen.getAllByAltText("Don Brio")[0] as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("http://example.com/logo.png");
    expect(img).toHaveClass("object-contain");
  });

  it("member nav exibe fallback quando logo falha", () => {
    render(
      <MemberNav
        barbershopName="Don Brio"
        barbershopLogo="http://example.com/logo-broken.png"
        subtitle="Membro"
        memberName="Bruno"
        avatarUrl={null}
        role="BARBER"
      />
    );

    const img = screen.getAllByAltText("Don Brio")[0] as HTMLImageElement;
    fireEvent.error(img);

    expect(screen.getAllByText("DB").length).toBeGreaterThan(0);
    expect(screen.queryByAltText("Don Brio")).toBeNull();
  });
});
