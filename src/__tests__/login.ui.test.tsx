import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { signIn } from "next-auth/react";

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
  signIn: vi.fn().mockResolvedValue({ error: null, ok: true }),
  getSession: vi.fn(),
}));

function submitClientDiscovery(phone = "(11) 99999-9999") {
  fireEvent.change(screen.getByPlaceholderText("Ex: João da Silva"), {
    target: { value: "Nome Informado" },
  });
  fireEvent.change(screen.getByPlaceholderText("Ex: (11) 99999-9999"), {
    target: { value: phone },
  });
  fireEvent.click(screen.getByRole("button", { name: "Entrar para Agendar" }));
}

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
    localStorage.clear();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/public/barbershops") {
        return {
          ok: true,
          json: async () => ([{
            id: "shop-1",
            name: "Don Brio",
            slug: "don-brio",
            logoUrl: null,
            coverUrl: null,
            city: "São Paulo",
            neighborhood: "Centro",
            latitude: null,
            longitude: null,
          }]),
        };
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }) as unknown as typeof fetch;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("nao exibe descoberta de barbearias no fluxo Sou Barbearia", async () => {
    currentParams = new URLSearchParams("tab=admin");
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Sou Barbearia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acessar Painel" })).toBeInTheDocument();
    expect(screen.queryByText("Contexto pronto para agendar")).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });

  it("nao mostra descoberta inicialmente na aba cliente", () => {
    render(<LoginPage />);

    expect(screen.queryByText("Contexto pronto para agendar")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["(11) 99999-9999", "(79) 98824-0050"])(
    "telefone válido %s segue fluxo indistinguível sem criar User ou sessão",
    async (phone) => {
      render(<LoginPage />);
      submitClientDiscovery(phone);

      expect(await screen.findByText("Contexto pronto para agendar")).toBeInTheDocument();
      expect(await screen.findByRole("link", { name: "Agendar Horário" })).toHaveAttribute(
        "href",
        "/don-brio/agendar"
      );
      expect(signIn).not.toHaveBeenCalled();
      expect(routerMock.push).not.toHaveBeenCalledWith("/minha-conta");
      expect(global.fetch).toHaveBeenCalledWith("/api/public/barbershops");
      expect(global.fetch).not.toHaveBeenCalledWith("/api/public/client-lookup", expect.anything());
    }
  );

  it("retorna ao booking salvo depois de criar o contexto", async () => {
    localStorage.setItem("lastBarbershopSlug", "don-brio");
    render(<LoginPage />);
    submitClientDiscovery();

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/don-brio/agendar"));
    expect(signIn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalledWith("/api/public/client-lookup", expect.anything());
  });

  it("aceita callbackUrl apenas quando aponta para booking local", async () => {
    currentParams = new URLSearchParams("callbackUrl=%2Fdon-brio%2Fagendar%3Fservice%3D1");
    render(<LoginPage />);
    submitClientDiscovery();

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith("/don-brio/agendar?service=1");
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("rejeita callbackUrl externo e oferece descoberta pública", async () => {
    currentParams = new URLSearchParams("callbackUrl=https%3A%2F%2Fevil.example%2Fsteal");
    render(<LoginPage />);
    submitClientDiscovery();

    expect(await screen.findByText("Contexto pronto para agendar")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("rejeita callbackUrl privado sem criar sessão phone_lookup", async () => {
    currentParams = new URLSearchParams("callbackUrl=%2Fminha-conta");
    render(<LoginPage />);
    submitClientDiscovery();

    expect(await screen.findByText("Contexto pronto para agendar")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalledWith("/minha-conta");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("slug invalido salvo nao redireciona", async () => {
    localStorage.setItem("lastBarbershopSlug", "../admin");
    render(<LoginPage />);

    await waitFor(() => expect(localStorage.getItem("lastBarbershopSlug")).toBeNull());
    expect(routerMock.replace).not.toHaveBeenCalledWith("/../admin/agendar");
  });

  it("renderiza a logo oficial do Tem Barber", () => {
    render(<LoginPage />);

    expect(screen.getByAltText("Tem Barber Logo")).toHaveAttribute("src", "/tem-barber-logo.png");
  });
});
