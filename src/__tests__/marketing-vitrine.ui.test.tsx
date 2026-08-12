import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/marketing/vitrine",
}));

const mockBarbershop = {
  id: "barber-1",
  name: "Don Brio",
  slug: "don-brio",
  description: "A melhor barbearia da cidade",
  phone: "11999887766",
  logoUrl: "https://example.com/logo.png",
  coverUrl: "https://example.com/cover.jpg",
  zipCode: "01310100",
  street: "Av. Paulista",
  number: "1000",
  complement: "Sala 5",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

function mockFetch(overrides: Partial<typeof mockBarbershop> = {}) {
  const data = { ...mockBarbershop, ...overrides };
  return vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url === "/api/admin/barbershop" && (!options || options.method !== "PUT")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }
    if (url === "/api/admin/barbershop" && options?.method === "PUT") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
}

describe("Marketing Vitrine Page", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalClipboard: Clipboard;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalClipboard = navigator.clipboard;

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("renderiza título e subtítulo da vitrine", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    expect(await screen.findByText("Vitrine pública")).toBeInTheDocument();
    expect(
      screen.getByText("Configure como sua barbearia aparece para clientes no link público.")
    ).toBeInTheDocument();
  });

  it("mostra link público da vitrine com slug", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    expect(
      await screen.findByText("https://app.tembarber.com.br/don-brio")
    ).toBeInTheDocument();
  });

  it("mostra link de agendamento com slug", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    expect(
      await screen.findByText("https://app.tembarber.com.br/don-brio/agendar")
    ).toBeInTheDocument();
  });

  it("copia link público ao clicar em Copiar", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByText("https://app.tembarber.com.br/don-brio");

    const copyButtons = screen.getAllByText("Copiar");
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://app.tembarber.com.br/don-brio"
      );
    });
  });

  it("carrega dados existentes da barbearia no formulário", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    const nameInput = await screen.findByDisplayValue("Don Brio");
    expect(nameInput).toBeInTheDocument();

    expect(screen.getByDisplayValue("A melhor barbearia da cidade")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Av. Paulista")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bela Vista")).toBeInTheDocument();
    expect(screen.getByDisplayValue("São Paulo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SP")).toBeInTheDocument();
  });

  it("exibe slug como somente leitura", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByText("don-brio");

    // Slug should not be in an editable input
    const slugInput = screen.queryByDisplayValue("don-brio");
    expect(slugInput).toBeNull();
  });

  it("salvar envia PUT com campos corretos sem slug", async () => {
    const fetchMock = mockFetch();
    globalThis.fetch = fetchMock;
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByDisplayValue("Don Brio");

    const saveButton = screen.getByText("Salvar alterações");
    fireEvent.click(saveButton);

    await waitFor(() => {
      const putCall = (fetchMock.mock.calls as Array<[string, RequestInit?]>).find(
        (c) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1]!.body as string);
      expect(body.name).toBe("Don Brio");
      expect(body.description).toBe("A melhor barbearia da cidade");
      // slug should NOT be in the body
      expect(body.slug).toBeUndefined();
    });
  });

  it("mostra feedback de sucesso após salvar", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByDisplayValue("Don Brio");

    const saveButton = screen.getByText("Salvar alterações");
    fireEvent.click(saveButton);

    expect(await screen.findByText(/Vitrine atualizada com sucesso/)).toBeInTheDocument();
  });

  it("exibe preview com logo e dados", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByText("Prévia da vitrine");

    const logos = screen.getAllByAltText("Logo da barbearia");
    expect(logos.length).toBeGreaterThan(0);
  });

  it("mostra orientação sobre alteração de imagens", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    expect(
      await screen.findByText("Para alterar imagens, use Configurações > Geral.")
    ).toBeInTheDocument();
  });

  it("mostra estado de loading enquanto carrega", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    expect(screen.getByText("Carregando vitrine...")).toBeInTheDocument();
  });

  it("exibe botão Visualizar que linka para a vitrine pública", async () => {
    globalThis.fetch = mockFetch();
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByText("https://app.tembarber.com.br/don-brio");

    const viewLinks = screen.getAllByText("Visualizar");
    const link = viewLinks.find((el) => el.closest("a"));
    expect(link).toBeInTheDocument();
    expect(link!.closest("a")!.href).toContain("/don-brio");
    expect(link!.closest("a")!.target).toBe("_blank");
  });

  it("não envia campos whatsapp ou instagram no payload", async () => {
    const fetchMock = mockFetch();
    globalThis.fetch = fetchMock;
    const MarketingVitrinePage = (await import("../app/admin/marketing/vitrine/page")).default;
    render(<MarketingVitrinePage />);

    await screen.findByDisplayValue("Don Brio");

    fireEvent.click(screen.getByText("Salvar alterações"));

    await waitFor(() => {
      const putCall = (fetchMock.mock.calls as Array<[string, RequestInit?]>).find(
        (c) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1]!.body as string);
      expect(body.whatsapp).toBeUndefined();
      expect(body.instagram).toBeUndefined();
    });
  });
});
