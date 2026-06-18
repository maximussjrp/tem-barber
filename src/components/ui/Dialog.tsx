import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  ({ isOpen, onClose, title, description, children, className = "" }, ref) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useImperativeHandle(ref, () => dialogRef.current as HTMLDialogElement);

    useEffect(() => {
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      if (isOpen && !dialogNode.open) {
        dialogNode.showModal();
        document.body.style.overflow = "hidden";
      } else if (!isOpen && dialogNode.open) {
        dialogNode.close();
        document.body.style.overflow = "";
      }

      return () => {
        document.body.style.overflow = "";
      };
    }, [isOpen]);

    useEffect(() => {
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      const handleCancel = (e: Event) => {
        e.preventDefault();
        onClose();
      };

      const handleClick = (e: MouseEvent) => {
        // Fechar ao clicar no backdrop
        if (e.target === dialogNode) {
          const rect = dialogNode.getBoundingClientRect();
          const isInDialog =
            rect.top <= e.clientY &&
            e.clientY <= rect.top + rect.height &&
            rect.left <= e.clientX &&
            e.clientX <= rect.left + rect.width;
          if (!isInDialog) {
            onClose();
          }
        }
      };

      dialogNode.addEventListener("cancel", handleCancel);
      dialogNode.addEventListener("click", handleClick);

      return () => {
        dialogNode.removeEventListener("cancel", handleCancel);
        dialogNode.removeEventListener("click", handleClick);
      };
    }, [onClose]);

    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={title ? "dialog-title" : undefined}
        aria-describedby={description ? "dialog-description" : undefined}
        className={`
          backdrop:bg-backdrop backdrop:backdrop-blur-sm
          bg-surface border border-border-strong shadow-xl
          rounded-xl p-0 open:flex flex-col
          w-full max-w-lg m-auto
          max-h-[85vh]
          ${className}
        `}
      >
        <div className="flex flex-col h-full w-full">
          {(title || description) && (
            <div className="flex flex-col gap-1.5 p-6 pb-4 border-b border-border-subtle shrink-0 relative">
              {title && <h2 id="dialog-title" className="heading-2 text-text-primary pr-8">{title}</h2>}
              {description && <p id="dialog-description" className="body-small text-text-secondary">{description}</p>}
              <button
                type="button"
                onClick={onClose}
                className="absolute top-6 right-6 text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
                aria-label="Fechar diálogo"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}
          
          <div className="p-6 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>
      </dialog>
    );
  }
);

Dialog.displayName = "Dialog";
