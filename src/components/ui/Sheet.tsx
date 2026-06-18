import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  description?: string;
  side?: "left" | "right";
  className?: string;
  isCritical?: boolean;
}

export const Sheet = forwardRef<HTMLDialogElement, SheetProps>(
  ({ isOpen, onClose, children, title, description, side = "right", className = "", isCritical = false }, ref) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useImperativeHandle(ref, () => dialogRef.current as HTMLDialogElement);

    useEffect(() => {
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      if (isOpen && !dialogNode.open) {
        dialogNode.showModal();
        document.body.style.overflow = "hidden";
      } else if (!isOpen && dialogNode.open) {
        // Para animação, poderíamos aguardar um pouco, mas com dialog nativo é síncrono.
        // O tailwind pode usar classes open: para animar.
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
        if (!isCritical) {
          onClose();
        }
      };

      const handleClick = (e: MouseEvent) => {
        if (e.target === dialogNode && !isCritical) {
          onClose(); // dialog itself is the backdrop area outside the content div
        }
      };

      dialogNode.addEventListener("cancel", handleCancel);
      dialogNode.addEventListener("click", handleClick);

      return () => {
        dialogNode.removeEventListener("cancel", handleCancel);
        dialogNode.removeEventListener("click", handleClick);
      };
    }, [onClose, isCritical]);

    // Position classes
    const posClass = side === "right" 
      ? "right-0 translate-x-full open:translate-x-0" 
      : "left-0 -translate-x-full open:translate-x-0";

    return (
      <dialog
        ref={dialogRef}
        aria-labelledby="sheet-title"
        aria-describedby={description ? "sheet-description" : undefined}
        className={`
          backdrop:bg-backdrop backdrop:backdrop-blur-sm
          fixed top-0 bottom-0 m-0 h-full max-h-none
          bg-surface border-border-strong shadow-2xl
          ${side === "right" ? "border-l ml-auto" : "border-r mr-auto"}
          transition-transform duration-300 ease-in-out
          w-full max-w-xs
          p-0 open:flex flex-col
          ${posClass}
          ${className}
        `}
      >
        <div className="flex flex-col h-full w-full overflow-hidden">
          <div className="flex flex-col gap-1.5 p-6 pb-4 border-b border-border-subtle shrink-0 relative">
            <h2 id="sheet-title" className="heading-2 text-text-primary pr-8">{title}</h2>
            {description && <p id="sheet-description" className="body-small text-text-secondary">{description}</p>}
            <button
              type="button"
              onClick={() => !isCritical && onClose()}
              className="absolute top-6 right-6 text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
              aria-label="Fechar menu"
              disabled={isCritical}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">
            {children}
          </div>
        </div>
      </dialog>
    );
  }
);

Sheet.displayName = "Sheet";
