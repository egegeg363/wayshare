import { cn } from "@/lib/utils";

/** WayShare mark: a road that bends to pick someone up (the emerald dot). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill="#111111" />
      <path
        d="M8.5 23.5c0-4.5 3-6.2 7.5-6.2s7.5-1.7 7.5-6.3"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="8.5" cy="23.5" r="2.6" fill="#ffffff" />
      <circle cx="23.5" cy="11" r="2.6" fill="#ffffff" />
      <circle cx="16" cy="17.3" r="3.1" fill="#10b981" stroke="#111111" strokeWidth="1.4" />
    </svg>
  );
}
