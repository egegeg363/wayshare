"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 4-digit PIN entry rendered as boxes. A single real <input> sits on top, so paste,
 * backspace, autofill (one-time-code) and mobile numeric keyboards all work natively.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label = "Passenger PIN",
  length = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
  length?: number;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <div className="relative inline-flex">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cn(
              "tabular flex size-10 items-center justify-center rounded-xl border bg-surface font-mono text-lg font-semibold transition-colors",
              invalid
                ? "border-danger/60 bg-danger-soft text-danger"
                : focused && i === active
                  ? "border-ink ring-4 ring-ink/[.06]"
                  : value[i]
                    ? "border-line-strong"
                    : "border-line",
              disabled && "opacity-50",
            )}
          >
            {value[i] ?? (focused && i === active ? <span className="h-5 w-px animate-pulse bg-ink" /> : "")}
          </span>
        ))}
      </div>
      <input
        id={id}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        className="absolute inset-0 cursor-text opacity-0"
      />
    </div>
  );
}
