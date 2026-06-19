import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
};

let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => currentParams,
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  getSession: vi.fn(),
}));

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
    }) as unknown as typeof fetch;
  });

  it("nao exibe descoberta de barbearias no fluxo Sou Barbearia", async () => {
    currentParams = new URLSearchParams("tab=admin");

    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Sou Barbearia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acessar Painel" })).toBeInTheDocument();
    expect(screen.queryByText("Encontrar minha barbearia")).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });

  it("exibe descoberta somente no fluxo de cliente", async () => {
    render(<LoginPage />);

    expect(await screen.findByText("Encontrar minha barbearia")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/public/barbershops");
  });
});
