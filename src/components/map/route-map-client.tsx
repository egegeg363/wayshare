"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { RouteMapProps } from "./types";

// Leaflet touches `window` at import time, so the map is only ever loaded in the browser.
const LeafletRouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#eef0f2]">
      <div className="size-6 animate-spin rounded-full border-2 border-ink/15 border-t-ink/60" />
    </div>
  ),
});

export function RouteMap({ className, ...props }: RouteMapProps) {
  return (
    <div className={cn("relative overflow-hidden bg-[#eef0f2]", className)}>
      <LeafletRouteMap {...props} className="absolute inset-0" />
    </div>
  );
}

export type { MapBand, MapMarker, MapPath } from "./types";
