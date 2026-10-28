import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  isCritical?: boolean;
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  (
    {
      isOpen,
      onClose,
      title,
      description,
      children,
      footer,
      className = "",
      contentClassName = "",
      isCritical = false,
    },
    ref
  ) => {
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
        if (!isCritical) {
          onClose();
        }
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
          if (!isInDialog && !isCritical) {
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
    }, [onClose, isCritical]);

    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={title ? "dialog-title" : undefined}
        aria-describedby={description ? "dialog-description" : undefined}
        className={`
          backdrop:bg-backdrop backdrop:backdrop-blur-sm
          bg-surface border border-border-strong shadow-xl
          rounded-xl p-0 open:flex flex-col
          w-[calc(100vw-1.5rem)] sm:w-full max-w-lg
          my-auto mx-auto
          max-h-[calc(100vh-1rem)] max-h-[calc(100dvh-1rem)] sm:max-h-[85vh]
          overflow-hidden
          ${className}
        `}
        style={{
          maxHeight: "min(85vh, calc(100dvh - 1rem))",
        }}
      >
        <div className="flex flex-col h-full w-full min-h-0 flex-1 overflow-hidden">
          {(title || description) && (
            <div className="flex flex-col gap-1.5 p-4 sm:p-6 pb-3 sm:pb-4 border-b border-border-subtle shrink-0 relative bg-surface">
              {title && <h2 id="dialog-title" className="heading-2 text-text-primary pr-8">{title}</h2>}
              {description && <p id="dialog-description" className="body-small text-text-secondary">{description}</p>}
              <button
                type="button"
                onClick={() => !isCritical && onClose()}
                className="absolute top-3.5 sm:top-5 right-3.5 sm:right-5 text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                aria-label="Fechar diálogo"
                disabled={isCritical}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}
          
          <div className={`overflow-y-auto overscroll-contain flex-1 min-h-0 touch-pan-y ${contentClassName ? contentClassName : "p-4 sm:p-6"}`}>
            {children}
          </div>

          {footer && (
            <div className="p-3 sm:p-4 border-t border-border-subtle bg-surface shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      </dialog>
    );
  }
);

Dialog.displayName = "Dialog";
