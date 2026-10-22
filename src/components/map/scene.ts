"use client";

import { nearestPointOnPath, type LatLng } from "@/lib/geo";
import type { MapPath } from "./types";

/** Dotted leg from a pickup to the nearest point of the route — the detour, visualised. */
export function detourLeg(
  id: string,
  pickup: LatLng | null,
  route: [number, number][] | null,
  within: boolean,
): MapPath[] {
  if (!pickup || !route || route.length < 2) return [];
  const nearest = nearestPointOnPath(
    pickup,
    route.map(([lat, lng]) => ({ lat, lng })),
  );
  if (!nearest) return [];
  return [
    {
      id,
      positions: [
        [pickup.lat, pickup.lng],
        [nearest.lat, nearest.lng],
      ],
      variant: within ? "detour" : "detour-muted",
    },
  ];
}
