"use client";

import { ChevronDown, Map as MapIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { BookingStatus, RideStatus } from "@/lib/domain";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  if (status === "CONFIRMED_IN_ESCROW") return <Badge tone="accent">Confirmed · in escrow</Badge>;
  if (status === "PICKED_UP_PAID") return <Badge tone="ink">Picked up · paid</Badge>;
  if (status === "DECLINED") return <Badge tone="danger">Declined by driver · refunded</Badge>;
  return <Badge tone="muted">Cancelled · refunded</Badge>;
}

export function RideStatusBadge({ status }: { status: RideStatus }) {
  switch (status) {
    case "OPEN":
      return <Badge tone="accent">Open for bookings</Badge>;
    case "FULL":
      return <Badge tone="ink">Full</Badge>;
    case "COMPLETED":
      return <Badge tone="outline">Completed</Badge>;
    default:
      return <Badge tone="muted">Cancelled</Badge>;
  }
}

/** Compact origin → (pickup) → destination timeline. */
export function TripTimeline({
  departure,
  arrival,
  originName,
  destName,
  pickup,
}: {
  departure: string;
  arrival: string;
  originName: string;
  destName: string;
  pickup?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">{formatDay(departure)}</p>
      <div className="grid grid-cols-[3.25rem_14px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <time className="tabular text-[15px] font-semibold">{formatTime(departure)}</time>
        <span className="flex justify-center">
          <span className="size-2.5 rounded-full border-[2.5px] border-ink bg-white" />
        </span>
        <span className="truncate text-[15px] font-semibold">{originName}</span>

        <span />
        <span className="flex h-full justify-center">
          <span className={cn("w-px bg-line-strong", pickup ? "h-full" : "h-4")} />
        </span>
        {pickup ? <div className="min-w-0 py-1">{pickup}</div> : <span />}

        <time className="tabular text-[15px] font-semibold">{formatTime(arrival)}</time>
        <span className="flex justify-center">
          <span className="size-2.5 rounded-[3px] bg-ink" />
        </span>
        <span className="truncate text-[15px] font-semibold">{destName}</span>
      </div>
    </div>
  );
}

export function MapToggle({ open, onToggle, label = "Route & pickups" }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-black/[.04] hover:text-ink"
    >
      <MapIcon className="size-4" />
      {open ? "Hide map" : label}
      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
    </button>
  );
}
