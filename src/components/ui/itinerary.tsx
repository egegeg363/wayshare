"use client";

import { ArrowUpDown, CalendarDays, X } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Stacked trip stops (origin → pickup → destination) in one hairline-divided block, with a
 * dotted connector through the stop glyphs and an optional swap control.
 */
export function ItineraryFields({
  children,
  onSwap,
  swapLabel = "Swap origin and destination",
  invalid,
}: {
  children: ReactNode;
  onSwap?: () => void;
  swapLabel?: string;
  invalid?: boolean;
}) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement[];
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "relative min-w-0 flex-1 rounded-xl border bg-surface transition-[border-color,box-shadow] [&>div+div]:border-t [&>div+div]:border-line",
          "focus-within:border-ink focus-within:ring-4 focus-within:ring-ink/[.06]",
          invalid ? "border-danger/50" : "border-line hover:border-line-strong",
        )}
      >
        {rows}
        <span
          aria-hidden
          className="pointer-events-none absolute top-6 bottom-6 left-[19.5px] border-l-[1.5px] border-dotted border-line-strong"
        />
      </div>
      {onSwap ? (
        <button
          type="button"
          onClick={onSwap}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:border-line-strong hover:text-ink"
          aria-label={swapLabel}
          title={swapLabel}
        >
          <ArrowUpDown className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Corner radii for the first / last row inside <ItineraryFields>. */
export const rowRadius = { first: "rounded-t-[11px]", last: "rounded-b-[11px]", only: "rounded-[11px]" } as const;

function labelFor(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return formatDay(new Date(y, m - 1, d));
}

/** Date picker that reads "Any date" when empty and "Tomorrow" / "Fri, 23 Oct" when set. */
export function DateField({
  value,
  onChange,
  min,
  placeholder = "Any date",
  label = "Departure date",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 transition-[border-color,box-shadow] hover:border-line-strong",
        "focus-within:border-ink focus-within:ring-4 focus-within:ring-ink/[.06]",
        className,
      )}
    >
      <CalendarDays className="size-4 shrink-0 text-muted" />
      <span className={cn("min-w-0 flex-1 truncate text-sm", value ? "font-medium text-ink" : "text-muted")}>
        {value ? labelFor(value) : placeholder}
      </span>
      <input
        type="date"
        aria-label={label}
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Older browsers: the native control still opens on its own.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="relative z-10 rounded-md p-0.5 text-subtle hover:text-ink"
          aria-label="Clear date"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
