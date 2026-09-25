/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock PushNotificationControl
vi.mock("@/components/push/PushNotificationControl", () => ({
  PushNotificationControl: () => <div data-testid="push-control-mock" />,
}));

import { Avatar } from "@/components/ui/Avatar";
import PerfilPage from "@/app/member/perfil/page";

describe("Avatar Hotfix - UI & Component Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Item D: Avatar reseta error quando src muda", () => {
    it("deve carregar fallback em caso de erro e tentar carregar novamente quando src muda", () => {
      const { rerender } = render(
        <Avatar src="https://example.com/broken.png" alt="Carlos Barbeiro" fallbackText="Carlos" />
      );

      // Imagem inicial deve estar no DOM
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/broken.png");

      // Simula erro de carregamento (onError)
      fireEvent.error(img);

      // Agora deve exibir o fallback com iniciais "C"
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("C")).toBeInTheDocument();

      // Muda o src para uma imagem válida
      rerender(
        <Avatar src="https://example.com/valid.png" alt="Carlos Barbeiro" fallbackText="Carlos" />
      );

      // O useEffect deve resetar o erro e exibir a nova tag img
      const newImg = screen.getByRole("img");
      expect(newImg).toBeInTheDocument();
      expect(newImg).toHaveAttribute("src", "https://example.com/valid.png");
    });
  });

  describe("Itens A, B, C: PerfilPage Preview, Upload PASS, Upload FAIL e Remoção", () => {
    const mockInitialProfile = {
      id: "member-1",
      role: "BARBER",
      bio: "Meu resumo",
      ratingAvg: 5.0,
      user: {
        id: "user-1",
        name: "Carlos Barbeiro",
        email: "carlos@barber.com",
        phone: "11999999999",
        avatarUrl: "/uploads/initial-avatar.png",
      },
      barbershop: {
        name: "Barbearia Vip",
        logoUrl: null,
      },
    };

    beforeEach(() => {
      // Mock global URL methods
      global.URL.createObjectURL = vi.fn((file: File) => `blob:mock-url/${file.name}`);
      global.URL.revokeObjectURL = vi.fn();
    });

    it("Item A: seleção gera preview local antes da conclusão do upload", async () => {
      let resolveUploadPromise: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        resolveUploadPromise = resolve;
      });

      global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === "/api/member/perfil" && (!opts || opts.method === "GET")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockInitialProfile),
          });
        }
        if (url === "/api/member/avatar" && opts?.method === "POST") {
          return uploadPromise;
        }
        return Promise.reject(new Error(`Unhandled fetch: ${url}`));
      });

      render(<PerfilPage />);

      // Aguarda carregar dados iniciais
      await waitFor(() => {
        expect(screen.getByDisplayValue("Carlos Barbeiro")).toBeInTheDocument();
      });

      const initialImg = screen.getByRole("img");
      expect(initialImg).toHaveAttribute("src", "/uploads/initial-avatar.png");

      // Seleciona um arquivo válido
      const file = new File(["dummy-png-content"], "novo-avatar.png", { type: "image/png" });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      // Item A: O preview deve aparecer IMEDIATAMENTE antes da resolução do upload
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(file);
      const previewImg = screen.getByRole("img");
      expect(previewImg).toHaveAttribute("src", "blob:mock-url/novo-avatar.png");

      // Conclui o upload
      resolveUploadPromise!({
        ok: true,
        json: () => Promise.resolve({ url: "/uploads/new-persisted.png" }),
      });

      await waitFor(() => {
        expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/new-persisted.png");
      });
    });

    it("Item B: upload PASS troca blob URL por URL persistida e revoga blob URL", async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === "/api/member/perfil") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockInitialProfile),
          });
        }
        if (url === "/api/member/avatar" && opts?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ url: "/uploads/persisted-after-pass.png" }),
          });
        }
        return Promise.reject(new Error(`Unhandled fetch: ${url}`));
      });

      render(<PerfilPage />);

      await waitFor(() => {
        expect(screen.getByDisplayValue("Carlos Barbeiro")).toBeInTheDocument();
      });

      const file = new File(["dummy"], "avatar-pass.png", { type: "image/png" });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      // Aguarda substituição pela URL persistida
      await waitFor(() => {
        const img = screen.getByRole("img");
        expect(img).toHaveAttribute("src", "/uploads/persisted-after-pass.png");
      });

      // Confirma que revokeObjectURL foi chamado para o preview blob
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url/avatar-pass.png");
    });

    it("Item C: upload FAIL restaura avatar anterior, revoga blob e exibe erro", async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === "/api/member/perfil") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockInitialProfile),
          });
        }
        if (url === "/api/member/avatar" && opts?.method === "POST") {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "Falha de rede ao enviar avatar." }),
          });
        }
        return Promise.reject(new Error(`Unhandled fetch: ${url}`));
      });

      render(<PerfilPage />);

      await waitFor(() => {
        expect(screen.getByDisplayValue("Carlos Barbeiro")).toBeInTheDocument();
      });

      const file = new File(["dummy"], "avatar-fail.png", { type: "image/png" });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      // Aguarda erro e restauração
      await waitFor(() => {
        expect(screen.getByText("Falha de rede ao enviar avatar.")).toBeInTheDocument();
      });

      // Restaura o avatar anterior
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "/uploads/initial-avatar.png");

      // Revogou o preview blob
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url/avatar-fail.png");
    });

    it("Botão 'Remover foto' deve chamar DELETE /api/member/avatar e limpar avatarUrl", async () => {
      const deleteCalled = vi.fn();

      global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === "/api/member/perfil") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockInitialProfile),
          });
        }
        if (url === "/api/member/avatar" && opts?.method === "DELETE") {
          deleteCalled();
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, url: null }),
          });
        }
        return Promise.reject(new Error(`Unhandled fetch: ${url}`));
      });

      render(<PerfilPage />);

      await waitFor(() => {
        expect(screen.getByDisplayValue("Carlos Barbeiro")).toBeInTheDocument();
      });

      const removeBtn = screen.getByText("Remover foto");
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(deleteCalled).toHaveBeenCalled();
      });

      // Após sucesso, avatarUrl é null, exibe fallback de iniciais ("CB" para "Carlos Barbeiro")
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("CB")).toBeInTheDocument();
    });
  });
});
