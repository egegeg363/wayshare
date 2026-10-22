"use client";

import Image from "next/image";
import { Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------------------

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface shadow-card", className)} {...props}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Avatar — image with an initials fallback (works offline / on broken URLs)
// ---------------------------------------------------------------------------------------

type AvatarProps = { src?: string | null; name: string; size?: number; className?: string; alt?: string };

export function Avatar(props: AvatarProps) {
  return <AvatarImage key={props.src ?? "none"} {...props} />;
}

function AvatarImage({ src, name, size = 32, className, alt = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        style={{ ...style, fontSize: Math.max(10, size * 0.38) }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-wash font-semibold text-ink-soft ring-1 ring-line",
          className,
        )}
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      style={style}
      className={cn("shrink-0 rounded-full bg-wash object-cover ring-1 ring-line", className)}
    />
  );
}

// ---------------------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------------------

export type BadgeTone = "accent" | "muted" | "ink" | "warn" | "danger" | "outline";

const badgeTones: Record<BadgeTone, string> = {
  accent: "bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent-line/70",
  muted: "bg-wash text-muted ring-1 ring-inset ring-line",
  ink: "bg-ink text-white",
  warn: "bg-warn-soft text-warn ring-1 ring-inset ring-amber-200",
  danger: "bg-danger-soft text-danger ring-1 ring-inset ring-red-200",
  outline: "bg-surface text-ink-soft ring-1 ring-inset ring-line",
};

export function Badge({
  tone = "muted",
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-none font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------------------

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  format = (v) => String(v),
  size = "md",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  size?: "sm" | "md";
}) {
  const button = cn(
    "inline-flex items-center justify-center rounded-lg text-ink transition-colors hover:bg-black/[.05] disabled:opacity-30 disabled:hover:bg-transparent",
    size === "sm" ? "size-7" : "size-9",
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center rounded-xl border border-line bg-surface p-0.5",
        size === "sm" ? "gap-0.5" : "gap-1",
      )}
    >
      <button
        type="button"
        className={button}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label.toLowerCase()}`}
      >
        <Minus className="size-4" />
      </button>
      <output
        aria-live="polite"
        className={cn(
          "tabular text-center font-semibold",
          size === "sm" ? "min-w-6 text-sm" : "min-w-8 text-[15px]",
        )}
      >
        {format(value)}
      </output>
      <button
        type="button"
        className={button}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label.toLowerCase()}`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-xl bg-wash p-1 ring-1 ring-inset ring-line/60", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-all",
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm",
              active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(17_17_17/0.08)] ring-1 ring-line" : "text-muted hover:text-ink",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      <span className="text-[13px] leading-tight">
        <span className="font-medium text-ink">{label}</span>
        {description ? <span className="block text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------
// Seats — filled = taken, outlined = still available
// ---------------------------------------------------------------------------------------

export function SeatIndicator({
  total,
  available,
  className,
}: {
  total: number;
  available: number;
  className?: string;
}) {
  const taken = total - available;
  return (
    <span
      role="img"
      aria-label={`${available} of ${total} seats available`}
      className={cn("inline-flex items-center gap-1", className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-3.5 w-3 rounded-[4px] border-[1.5px]",
            i < taken ? "border-ink bg-ink" : "border-accent bg-accent-soft",
          )}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// Skeleton, labels, empty states
// ---------------------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-black/[.055]", className)} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11px] font-semibold tracking-[0.08em] text-muted uppercase", className)}>{children}</p>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-wash text-ink-soft ring-1 ring-line">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-soft">
        {children}
      </label>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export const inputClasses =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-subtle transition-[border-color,box-shadow] outline-none hover:border-line-strong focus:border-ink focus:ring-4 focus:ring-ink/[.06] disabled:opacity-50";

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[13px] text-danger">{children}</p>;
}
