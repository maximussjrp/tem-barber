import React, { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

export interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  type?: string;
}

export function PromptDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  description,
  defaultValue = "",
  placeholder = "",
  submitLabel = "Confirmar",
  cancelLabel = "Cancelar",
  isLoading = false,
  type = "text",
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setValue(defaultValue);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} description={description} className="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <input
            type={type}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)] transition-colors text-sm"
            autoFocus
            disabled={isLoading}
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
