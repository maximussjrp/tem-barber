import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();

    // Mock fetch for public lookup and barbershops list
    global.fetch = vi.fn().mockImplementation((url, init) => {
      const urlStr = url.toString();
      if (urlStr === "/api/public/client-lookup") {
        const body = JSON.parse(init.body);
        if (body.phone && body.phone.replace(/\D/g, "") === "11911111111") {
          // Exactly 1 linked barbershop
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              linkedBarbershops: [{ id: "1", name: "Don Brio", slug: "don-brio" }]
            }),
          });
        } else if (body.phone && body.phone.replace(/\D/g, "") === "22922222222") {
          // Multiple linked barbershops
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              linkedBarbershops: [
                { id: "1", name: "Don Brio", slug: "don-brio" },
                { id: "2", name: "Smoke Premium", slug: "smoke-premium" }
              ]
            }),
          });
        } else {
          // No linked barbershops
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ linkedBarbershops: [] }),
          });
        }
      } else if (urlStr === "/api/public/barbershops") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: "1", name: "Don Brio", slug: "don-brio", logoUrl: null, coverUrl: null, city: "São Paulo", neighborhood: "Centro" }
          ]),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    }) as unknown as typeof fetch;
  });

  it("nao exibe descoberta de barbearias no fluxo Sou Barbearia", async () => {
    currentParams = new URLSearchParams("tab=admin");

    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Sou Barbearia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acessar Painel" })).toBeInTheDocument();
    expect(screen.queryByText("Encontrar minha barbearia")).not.toBeInTheDocument();
    expect(screen.queryByText("Não encontramos uma barbearia vinculada a este telefone.")).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });

  it("nao mostra lista de barbearias inicialmente na aba cliente", async () => {
    render(<LoginPage />);

    expect(screen.queryByText("Não encontramos uma barbearia vinculada a este telefone.")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("lookup com uma barbearia vinculada realiza login e redireciona para /[slug]/agendar", async () => {
    render(<LoginPage />);

    const nameInput = screen.getByPlaceholderText("Ex: João da Silva");
    const phoneInput = screen.getByPlaceholderText("Ex: (11) 99999-9999");
    const submitBtn = screen.getByRole("button", { name: "Entrar para Agendar" });

    fireEvent.change(nameInput, { target: { value: "Cliente Um" } });
    fireEvent.change(phoneInput, { target: { value: "(11) 91111-1111" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        redirect: false,
        loginType: "client",
        name: "Cliente Um",
        phone: "(11) 91111-1111",
      });
      expect(routerMock.push).toHaveBeenCalledWith("/don-brio/agendar");
    });
  });

  it("lookup com multiplas barbearias vinculadas realiza login e redireciona para /minha-conta", async () => {
    render(<LoginPage />);

    const nameInput = screen.getByPlaceholderText("Ex: João da Silva");
    const phoneInput = screen.getByPlaceholderText("Ex: (11) 99999-9999");
    const submitBtn = screen.getByRole("button", { name: "Entrar para Agendar" });

    fireEvent.change(nameInput, { target: { value: "Cliente Dois" } });
    fireEvent.change(phoneInput, { target: { value: "(22) 92222-2222" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        redirect: false,
        loginType: "client",
        name: "Cliente Dois",
        phone: "(22) 92222-2222",
      });
      expect(routerMock.push).toHaveBeenCalledWith("/minha-conta");
    });
  });

  it("lookup sem barbearias vinculadas nao realiza login e exibe descoberta de barbearias", async () => {
    render(<LoginPage />);

    const nameInput = screen.getByPlaceholderText("Ex: João da Silva");
    const phoneInput = screen.getByPlaceholderText("Ex: (11) 99999-9999");
    const submitBtn = screen.getByRole("button", { name: "Entrar para Agendar" });

    fireEvent.change(nameInput, { target: { value: "Cliente Tres" } });
    fireEvent.change(phoneInput, { target: { value: "(33) 93333-3333" } });
    fireEvent.click(submitBtn);

    // Deve exibir a mensagem de "Não encontramos uma barbearia" e carregar a lista de barbearias
    expect(await screen.findByText("Não encontramos uma barbearia vinculada a este telefone.")).toBeInTheDocument();
    expect(screen.getByText("Escolha uma barbearia para agendar.")).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledWith("/api/public/barbershops");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("renderiza a logo oficial do Tem Barber", async () => {
    render(<LoginPage />);

    const logo = screen.getByAltText("Tem Barber Logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/tem-barber-logo.png");
  });
});
