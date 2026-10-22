import type { ReactNode } from "react";
import type { LatLng } from "@/lib/geo";

export type MarkerKind = "origin" | "destination" | "pickup" | "pickup-muted" | "stop";

export type MapMarker = {
  id: string;
  position: LatLng;
  kind: MarkerKind;
  label?: string;
  labelTone?: "ink" | "accent" | "muted";
  draggable?: boolean;
};

export type PathVariant = "route" | "route-muted" | "detour" | "detour-muted";

export type MapPath = {
  id: string;
  /** [lat, lng] pairs */
  positions: [number, number][];
  variant: PathVariant;
};

/** Pickup band: everything within `radiusKm` of the route line. */
export type MapBand = {
  id: string;
  /** Route line as [lat, lng] pairs. */
  positions: [number, number][];
  /** Half-width of the band — the driver's pickup radius. */
  radiusKm: number;
};

export type RouteMapProps = {
  markers?: MapMarker[];
  paths?: MapPath[];
  bands?: MapBand[];
  /** Changing the key re-fits the viewport to `fitTo` (animated after the first fit). */
  fitKey?: string;
  fitTo?: LatLng[];
  onMapClick?: (point: LatLng) => void;
  onMarkerDragEnd?: (markerId: string, point: LatLng) => void;
  scrollWheelZoom?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Overlay UI rendered above the map (legends, hints). */
  children?: ReactNode;
};
