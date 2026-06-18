import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  side?: "left" | "right";
  className?: string;
  "aria-label"?: string;
}

export const Sheet = forwardRef<HTMLDialogElement, SheetProps>(
  ({ isOpen, onClose, children, side = "right", className = "", "aria-label": ariaLabel = "Menu lateral" }, ref) => {
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
        onClose();
      };

      const handleClick = (e: MouseEvent) => {
        if (e.target === dialogNode) {
          onClose(); // dialog itself is the backdrop area outside the content div
        }
      };

      dialogNode.addEventListener("cancel", handleCancel);
      dialogNode.addEventListener("click", handleClick);

      return () => {
        dialogNode.removeEventListener("cancel", handleCancel);
        dialogNode.removeEventListener("click", handleClick);
      };
    }, [onClose]);

    // Position classes
    const posClass = side === "right" 
      ? "right-0 translate-x-full open:translate-x-0" 
      : "left-0 -translate-x-full open:translate-x-0";

    return (
      <dialog
        ref={dialogRef}
        aria-label={ariaLabel}
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
        <div className="flex flex-col h-full w-full overflow-y-auto overscroll-contain">
          {children}
        </div>
      </dialog>
    );
  }
);

Sheet.displayName = "Sheet";
