import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { Sheet } from "../components/ui/Sheet";
import { Dialog } from "../components/ui/Dialog";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ComandaItemCard } from "../components/admin/comanda/ComandaItemCard";

describe("Sheet Component", () => {
  it("renderiza fechado", () => {
    render(
      <Sheet isOpen={false} onClose={() => {}} title="Test Title" description="Test Desc">
        <div data-testid="sheet-content">Content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveAttribute("open");
  });

  it("abre e apresenta título e descrição", () => {
    render(
      <Sheet isOpen={true} onClose={() => {}} title="Test Title" description="Test Desc">
        <div data-testid="sheet-content">Content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Test Desc")).toBeInTheDocument();
  });

  it("botão explícito fecha", async () => {
    const onClose = vi.fn();
    render(
      <Sheet isOpen={true} onClose={onClose} title="Title">
        <div>Content</div>
      </Sheet>
    );
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape fecha quando não crítico", () => {
    const onClose = vi.fn();
    render(
      <Sheet isOpen={true} onClose={onClose} title="Title">
        <div>Content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event('cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape não fecha quando isCritical", () => {
    const onClose = vi.fn();
    render(
      <Sheet isOpen={true} onClose={onClose} title="Title" isCritical={true}>
        <div>Content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event('cancel'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("menu pode fechar após navegação", async () => {
    const onClose = vi.fn();
    render(
      <Sheet isOpen={true} onClose={onClose} title="Title">
        <button onClick={onClose}>Navigate</button>
      </Sheet>
    );
    await userEvent.click(screen.getByText("Navigate"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog Component", () => {
  it("título e descrição associados", () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} title="Test Title" description="Test Desc">
        <div>Content</div>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "dialog-title");
    expect(dialog).toHaveAttribute("aria-describedby", "dialog-description");
    expect(screen.getByText("Test Title")).toHaveAttribute("id", "dialog-title");
    expect(screen.getByText("Test Desc")).toHaveAttribute("id", "dialog-description");
  });

  it("comportamento crítico impede fechamento por clique ou escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose} title="Title" isCritical={true}>
        <div>Content</div>
      </Dialog>
    );
    
    // Tentativa de fechar pelo botão
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    expect(closeBtn).toBeDisabled();

    // Tentativa de fechar por escape
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event('cancel'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog Component", () => {
  it("cancelar não executa callback e fecha", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog isOpen={true} onClose={onClose} onConfirm={onConfirm} title="Atenção" />
    );
    await userEvent.click(screen.getByText("Cancelar"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirmar executa callback uma vez", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog isOpen={true} onClose={onClose} onConfirm={onConfirm} title="Atenção" />
    );
    await userEvent.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // Usually it handles own close or waits
  });

  it("duplo clique não duplica chamada com isLoading", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog isOpen={true} onClose={() => {}} onConfirm={onConfirm} title="Atenção" isLoading={true} />
    );
    const confirmBtn = screen.getByText("Confirmar");
    expect(confirmBtn).toBeDisabled();
    await userEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled(); // button is disabled
  });
});

describe("ComandaItemCard Component", () => {
  const mockItem = {
    id: "item123",
    type: "SERVICE",
    status: "PENDING",
    description: "Corte de Cabelo",
    quantity: "1",
    unitPrice: "50",
    total: "50"
  };

  it("abre confirmação de cancelamento e cancelar preserva item", async () => {
    const onCancel = vi.fn();
    const onConclude = vi.fn();
    render(
      <ComandaItemCard item={mockItem} busy={false} comandaClosed={false} onConclude={onConclude} onCancel={onCancel} />
    );
    
    // Abre confirmação
    await userEvent.click(screen.getByText("Cancelar"));
    const confirmDialog = screen.getByRole("dialog");
    expect(confirmDialog).toBeVisible();
    
    // Desiste de cancelar
    await userEvent.click(screen.getByText("Voltar"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("confirmar chama onCancel uma única vez", async () => {
    const onCancel = vi.fn();
    const onConclude = vi.fn();
    render(
      <ComandaItemCard item={mockItem} busy={false} comandaClosed={false} onConclude={onConclude} onCancel={onCancel} />
    );
    
    // Abre e confirma
    await userEvent.click(screen.getByText("Cancelar"));
    await userEvent.click(screen.getByText("Sim, cancelar item"));
    
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("item123");
  });

  it("loading desabilita confirmação", async () => {
    render(
      <ComandaItemCard item={mockItem} busy={true} comandaClosed={false} onConclude={() => {}} onCancel={() => {}} />
    );
    
    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
    expect(cancelBtn).toBeDisabled();
  });
});
