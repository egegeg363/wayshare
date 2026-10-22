import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "accent" | "danger" | "outline-danger";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#2a2a2a] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-canvas",
  ghost: "text-muted hover:text-ink hover:bg-black/[.04]",
  accent: "bg-accent text-white hover:bg-[#0ea371] shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]",
  danger: "bg-danger text-white hover:bg-[#c21f1f]",
  "outline-danger": "bg-surface text-danger border border-line hover:border-danger/40 hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
  icon: "size-10 rounded-xl",
  "icon-sm": "size-8 rounded-lg",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none",
    "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    variants[variant],
    sizes[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
