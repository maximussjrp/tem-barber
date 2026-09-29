import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServicosPage from "@/app/admin/servicos/page";

describe("Admin Serviços - Image Management UI Suite", () => {
  const mockCategories = [
    { id: "cat-1", name: "Cabelo" },
    { id: "cat-2", name: "Barba" },
  ];

  const mockServices = [
    {
      id: "svc-with-img",
      name: "Corte Degradê",
      description: "Degradê navalhado",
      price: "50.00",
      durationMin: 35,
      imageUrl: "/uploads/corte-degrade.png",
      isActive: true,
      categoryId: "cat-1",
      category: { id: "cat-1", name: "Cabelo" },
    },
    {
      id: "svc-no-img",
      name: "Barba Simples",
      description: "Apenas alinhamento",
      price: "30.00",
      durationMin: 20,
      imageUrl: null,
      isActive: true,
      categoryId: "cat-2",
      category: { id: "cat-2", name: "Barba" },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/categories")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCategories),
        });
      }
      if (url.includes("/api/admin/services")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockServices),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch;
  });

  it("renderiza thumbnail na tabela quando imageUrl existe e fallback elegante quando null", async () => {
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();
    expect(screen.getByText("Barba Simples")).toBeInTheDocument();

    const img = screen.getByRole("img", { name: "Corte Degradê" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/uploads/corte-degrade.png");

    expect(screen.getAllByText("✂️").length).toBeGreaterThanOrEqual(1);
  });

  it("abre modal de edição com foto e botões Escolher da galeria, Alterar foto e Remover foto", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    const editBtns = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editBtns[0]);

    expect(screen.getByText("Editar Serviço")).toBeInTheDocument();

    expect(screen.getByAltText("Preview do serviço")).toHaveAttribute("src", "/uploads/corte-degrade.png");
    expect(screen.getByRole("button", { name: "Escolher da galeria" })).toBeInTheDocument();
    expect(screen.getByText("Alterar foto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover foto" })).toBeInTheDocument();
  });

  it("abre modal de criação com opções Escolher da galeria e Enviar minha foto", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Novo Serviço" }));

    expect(screen.getByText("Novo Serviço")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher da galeria" })).toBeInTheDocument();
    expect(screen.getByText("Enviar minha foto")).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG ou WebP — máx. 5 MB/i)).toBeInTheDocument();
  });

  it("permite criar serviço sem imagem com sucesso", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Novo Serviço" }));

    await user.type(screen.getByPlaceholderText("Ex: Corte Masculino"), "Sobrancelha");
    await user.type(screen.getByPlaceholderText("0,00"), "25");

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/api/admin/services")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "svc-new",
              name: "Sobrancelha",
              price: "25.00",
              durationMin: 30,
              imageUrl: null,
              isActive: true,
              categoryId: "cat-1",
              category: { id: "cat-1", name: "Cabelo" },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Criar serviço" }));

    expect(await screen.findByText("Sobrancelha")).toBeInTheDocument();
  });

  it("Caso A: criação OK + upload de imagem falha => exibe aviso parcial e mantém serviço criado", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Novo Serviço" }));

    await user.type(screen.getByPlaceholderText("Ex: Corte Masculino"), "Barba Terapia");
    await user.type(screen.getByPlaceholderText("0,00"), "40");

    const file = new File(["dummy content"], "terapia.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/api/admin/services/") && url.includes("/image")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Falha no disco" }),
        });
      }
      if (opts?.method === "POST" && url.includes("/api/admin/services")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "svc-terapia",
              name: "Barba Terapia",
              price: "40.00",
              durationMin: 30,
              imageUrl: null,
              isActive: true,
              categoryId: "cat-1",
              category: { id: "cat-1", name: "Cabelo" },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Criar serviço" }));

    expect(await screen.findByText(/Serviço criado, mas não foi possível enviar a foto\./i)).toBeInTheDocument();
    expect(screen.getByText("Barba Terapia")).toBeInTheDocument();
  });

  it("Caso B: edição OK + upload falha => exibe aviso parcial e preserva foto anterior", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    const editBtns = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editBtns[0]);

    const file = new File(["new image"], "novo.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/image")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Erro upload" }),
        });
      }
      if (opts?.method === "PUT" && url.includes("/api/admin/services/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "svc-with-img",
              name: "Corte Degradê Atualizado",
              price: "55.00",
              durationMin: 35,
              imageUrl: "/uploads/corte-degrade.png",
              isActive: true,
              categoryId: "cat-1",
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText(/Serviço atualizado, mas não foi possível atualizar a foto\./i)).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "Corte Degradê Atualizado" });
    expect(img).toHaveAttribute("src", "/uploads/corte-degrade.png");
  });

  it("Caso C: remoção de foto responde erro => exibe erro e NÃO limpa imageUrl local", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    const editBtns = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editBtns[0]);

    await user.click(screen.getByRole("button", { name: "Remover foto" }));

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE" && url.includes("/image")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Erro ao deletar arquivo" }),
        });
      }
      if (opts?.method === "PUT" && url.includes("/api/admin/services/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "svc-with-img",
              name: "Corte Degradê",
              price: "50.00",
              durationMin: 35,
              imageUrl: "/uploads/corte-degrade.png",
              isActive: true,
              categoryId: "cat-1",
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText(/Não foi possível remover a foto do serviço\./i)).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "Corte Degradê" });
    expect(img).toHaveAttribute("src", "/uploads/corte-degrade.png");
  });

  it("abre modal da galeria ao clicar em Escolher da galeria e seleciona preset para preview", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Novo Serviço" }));

    await user.click(screen.getByRole("button", { name: "Escolher da galeria" }));

    expect(screen.getByText("Galeria Tem Barber")).toBeInTheDocument();
    expect(screen.getByText("Corte Clássico")).toBeInTheDocument();

    // Click on preset "Degradê Baixo"
    const degradePreset = screen.getByText("Degradê Baixo");
    await user.click(degradePreset);

    // Gallery modal closes and form shows image preview of preset
    expect(screen.queryByText("Galeria Tem Barber")).not.toBeInTheDocument();
    const previewImg = screen.getByAltText("Preview do serviço");
    expect(previewImg).toHaveAttribute("src", "/service-presets/fade/fade-baixo.webp");
  });

  it("ADENDO 4: criação OK + PATCH de preset falha => exibe aviso 'Serviço criado, mas não foi possível definir a foto da galeria.'", async () => {
    const user = userEvent.setup();
    render(<ServicosPage />);

    expect(await screen.findByText("Corte Degradê")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Novo Serviço" }));
    await user.type(screen.getByPlaceholderText("Ex: Corte Masculino"), "Corte Fade");
    await user.type(screen.getByPlaceholderText("0,00"), "45");

    // Open gallery and select Fade preset
    await user.click(screen.getByRole("button", { name: "Escolher da galeria" }));
    await user.click(screen.getByText("Degradê Baixo"));

    // Mock fetch: POST service succeeds, PATCH image preset fails
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH" && url.includes("/image")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Erro no preset" }),
        });
      }
      if (opts?.method === "POST" && url.includes("/api/admin/services")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "svc-fade",
              name: "Corte Fade",
              price: "45.00",
              durationMin: 30,
              imageUrl: null,
              isActive: true,
              categoryId: "cat-1",
              category: { id: "cat-1", name: "Cabelo" },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Criar serviço" }));

    expect(await screen.findByText(/Serviço criado, mas não foi possível definir a foto da galeria\./i)).toBeInTheDocument();
    expect(screen.getByText("Corte Fade")).toBeInTheDocument();
  });
});
