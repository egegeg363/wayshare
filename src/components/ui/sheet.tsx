"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Right-hand drawer on desktop, bottom sheet on mobile. Escape / backdrop close it. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-end sm:items-stretch">
      <div
        className="absolute inset-0 animate-fade-in bg-[rgb(17_17_17/0.28)] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-pop outline-none sm:m-3 sm:max-h-none sm:w-[460px] sm:rounded-3xl",
          "animate-rise-in sm:animate-sheet-in",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex size-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-black/[.05] hover:text-ink"
            aria-label="Close"
          >
            <X className="size-[18px]" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer ? <footer className="border-t border-line px-6 py-4">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
