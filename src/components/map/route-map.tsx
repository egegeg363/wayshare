"use client";

import { LeafletContext, createLeafletContext } from "@react-leaflet/core";
import L from "leaflet";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { MapBand, MapMarker, MarkerKind, PathVariant, RouteMapProps } from "./types";

const DEFAULT_CENTER: L.LatLngTuple = [50.6, 9.8];
const DEFAULT_ZOOM = 5;

const PIN = (modifier: string) =>
  `<svg class="ws-marker__pin ${modifier}" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 25.9 15 38 15 38s15-12.1 15-23.2C30 6.6 23.3 0 15 0z"/><circle cx="15" cy="14.6" r="5.6" fill="#fff"/></svg>`;

const dot = (kind: string) =>
  L.divIcon({
    className: "ws-marker",
    html: `<span class="ws-marker__${kind}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    tooltipAnchor: [0, -10],
  });

const pin = (modifier: string) =>
  L.divIcon({
    className: "ws-marker",
    html: PIN(modifier),
    iconSize: [30, 38],
    iconAnchor: [15, 37],
    tooltipAnchor: [0, -36],
  });

const ICONS: Record<MarkerKind, L.DivIcon> = {
  origin: dot("origin"),
  destination: dot("destination"),
  stop: dot("stop"),
  pickup: pin(""),
  "pickup-muted": pin("ws-marker__pin--muted"),
};

const round = { lineCap: "round", lineJoin: "round" } as const;
const PATH_STYLES: Record<PathVariant, L.PathOptions[]> = {
  route: [
    { color: "#ffffff", weight: 9, opacity: 0.95, ...round },
    { color: "#111111", weight: 4.5, opacity: 0.95, ...round },
  ],
  "route-muted": [{ color: "#6b7280", weight: 3, opacity: 0.55, ...round }],
  detour: [{ color: "#059669", weight: 4, opacity: 1, dashArray: "0.5 9", ...round }],
  "detour-muted": [{ color: "#9ca3af", weight: 4, opacity: 1, dashArray: "0.5 9", ...round }],
};

/** Pickup bands live in their own pane, multiplied onto the tiles: streets stay readable under the tint. */
const BAND_PANE = "ws-band";
const BAND_FILL = "#d3f3e4";
const BAND_EDGE = "#34d399";
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

const LABEL_CLASS = { ink: "ws-label", accent: "ws-label ws-label--accent", muted: "ws-label ws-label--muted" };

/** Leaflet instances keyed by their container, so a map survives React re-attaching it. */
const instances = new WeakMap<HTMLElement, L.Map>();

/**
 * Leaflet map that is safe under Next.js Cache Components: hidden routes are kept mounted
 * inside React <Activity>, which tears effects down and back up. react-leaflet's stock
 * MapContainer destroys its map on teardown and never recreates it; this container keeps
 * the instance alive while its DOM node is merely hidden and disposes of it only when the
 * node actually leaves the document.
 */
export default function RouteMap({
  markers = [],
  paths = [],
  bands = [],
  fitKey,
  fitTo,
  onMapClick,
  onMarkerDragEnd,
  scrollWheelZoom = true,
  ariaLabel = "Route map",
  className,
  children,
}: RouteMapProps) {
  const [map, setMap] = useState<L.Map | null>(null);

  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let instance = instances.get(node);
    if (!instance) {
      instance = L.map(node, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        // Draw vectors well beyond the visible area so routes don't pop in while panning.
        renderer: L.svg({ padding: 0.5 }),
        // Fractional zoom lets routes fill the frame instead of jumping a whole level.
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 90,
        minZoom: 3,
        maxZoom: 18,
        worldCopyJump: true,
      });
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      const bandPane = instance.createPane(BAND_PANE);
      bandPane.style.zIndex = "350"; // above tiles (200), below routes and markers (400+)
      bandPane.style.mixBlendMode = "multiply";
      bandPane.style.pointerEvents = "none";
      instance.attributionControl.setPrefix(false);
      instances.set(node, instance);
    }
    const live = instance;
    setMap(live);
    const observer = new ResizeObserver(() => live.invalidateSize({ debounceMoveend: true }));
    observer.observe(node);
    return () => {
      observer.disconnect();
      setTimeout(() => {
        if (!node.isConnected) {
          live.remove();
          instances.delete(node);
        }
      }, 0);
    };
  }, []);

  const context = useMemo(() => (map ? createLeafletContext(map) : null), [map]);

  return (
    <div className={cn("ws-map relative isolate overflow-hidden", onMapClick && "ws-map--pickable", className)}>
      <div ref={attach} className="absolute inset-0" role="region" aria-label={ariaLabel} />
      {context ? (
        <LeafletContext value={context}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          {bands.map((band) => (
            <PickupBand key={band.id} band={band} />
          ))}
          {paths.flatMap((path) =>
            PATH_STYLES[path.variant].map((style, layer) => (
              <Polyline key={`${path.id}:${layer}`} positions={path.positions} pathOptions={style} interactive={false} />
            )),
          )}
          {markers.map((marker) => (
            <MarkerView key={marker.id} marker={marker} onDragEnd={onMarkerDragEnd} />
          ))}
          <FitBounds fitKey={fitKey} fitTo={fitTo} />
          {onMapClick ? <ClickCapture onClick={onMapClick} /> : null}
          <WheelZoom enabled={scrollWheelZoom} />
        </LeafletContext>
      ) : null}
      {children}
    </div>
  );
}

function MarkerView({
  marker,
  onDragEnd,
}: {
  marker: MapMarker;
  onDragEnd?: (markerId: string, point: LatLng) => void;
}) {
  const { id, draggable } = marker;
  const handlers = useMemo<L.LeafletEventHandlerFnMap | undefined>(
    () =>
      draggable && onDragEnd
        ? {
            dragend: (event) => {
              const { lat, lng } = (event.target as L.Marker).getLatLng();
              onDragEnd(id, { lat, lng });
            },
          }
        : undefined,
    [draggable, id, onDragEnd],
  );
  const isPin = marker.kind === "pickup" || marker.kind === "pickup-muted";
  return (
    <Marker
      position={[marker.position.lat, marker.position.lng]}
      icon={ICONS[marker.kind]}
      draggable={Boolean(draggable)}
      eventHandlers={handlers}
      keyboard={false}
      zIndexOffset={isPin ? 1000 : 0}
      title={marker.label}
    >
      {marker.label ? (
        <Tooltip
          permanent
          direction="top"
          offset={[0, isPin ? 0 : -2]}
          className={LABEL_CLASS[marker.labelTone ?? "ink"]}
        >
          {marker.label}
        </Tooltip>
      ) : null}
    </Marker>
  );
}

/**
 * Everything within `radiusKm` of the route line, drawn as a round-capped stroke 2 × radius
 * wide (an exact buffer of the line) plus a slightly wider edge stroke underneath. Stroke
 * widths are in pixels, so they are recomputed from the ground resolution on every zoom.
 */
function PickupBand({ band }: { band: MapBand }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  const meanLat = band.positions.reduce((sum, [lat]) => sum + lat, 0) / Math.max(1, band.positions.length);
  const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos((meanLat * Math.PI) / 180)) / 2 ** (zoom + 8);
  const width = Math.min(6000, (2 * band.radiusKm * 1000) / metersPerPixel);
  if (!(band.radiusKm > 0) || band.positions.length < 2) return null;

  const shared = { lineCap: "round", lineJoin: "round", opacity: 1 } as const;
  return (
    <>
      <Polyline
        positions={band.positions}
        pane={BAND_PANE}
        noClip
        interactive={false}
        pathOptions={{ ...shared, color: BAND_EDGE, weight: width + 3 }}
      />
      <Polyline
        positions={band.positions}
        pane={BAND_PANE}
        noClip
        interactive={false}
        pathOptions={{ ...shared, color: BAND_FILL, weight: width }}
      />
    </>
  );
}

function FitBounds({ fitKey, fitTo }: { fitKey?: string; fitTo?: LatLng[] }) {
  const map = useMap();
  const fitted = useRef<{ key?: string; done: boolean }>({ done: false });

  const fit = useEffectEvent((): boolean => {
    if (!fitTo || fitTo.length === 0) {
      // Nothing to show any more (e.g. the search was cleared): return to the overview.
      if (fitted.current.done && fitted.current.key !== fitKey) {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
      }
      fitted.current = { key: fitKey, done: true };
      return true;
    }
    // Already showing this view (e.g. the tab was hidden and revealed): keep the user's pan/zoom.
    if (fitted.current.done && fitted.current.key === fitKey) return true;
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return false; // not laid out yet; retried on resize
    // Leaflet silently ignores a new view while a zoom animation is running; retried on zoomend.
    if ((map as unknown as { _animatingZoom?: boolean })._animatingZoom) return false;
    const bounds = L.latLngBounds(fitTo.map((p) => [p.lat, p.lng] as L.LatLngTuple));
    // Extra headroom on top: pins (38 px) and their labels sit above the coordinate.
    const side = Math.round(Math.min(56, size.x * 0.1));
    const options: L.FitBoundsOptions = {
      paddingTopLeft: L.point(side, Math.round(Math.min(72, size.y * 0.3))),
      paddingBottomRight: L.point(side, Math.round(Math.min(40, size.y * 0.14))),
      maxZoom: 13,
    };
    // Switch views instantly: Leaflet only draws vectors for the new view once a camera
    // animation ends, so any animation would show a blank (or stale-looking) map meanwhile.
    if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 200) {
      map.setView(bounds.getCenter(), 13, { animate: false });
    } else {
      map.fitBounds(bounds, { ...options, animate: false });
    }
    fitted.current = { key: fitKey, done: true };
    return true;
  });

  useEffect(() => {
    if (fit()) return;
    const retry = () => {
      if (!fit()) return;
      map.off("resize", retry);
      map.off("zoomend", retry);
    };
    map.on("resize", retry);
    map.on("zoomend", retry);
    return () => {
      map.off("resize", retry);
      map.off("zoomend", retry);
    };
  }, [map, fitKey]);

  return null;
}

function ClickCapture({ onClick }: { onClick: (point: LatLng) => void }) {
  const map = useMap();
  const handle = useEffectEvent((event: L.LeafletMouseEvent) => {
    onClick({ lat: event.latlng.lat, lng: event.latlng.lng });
  });
  useEffect(() => {
    const listener = (event: L.LeafletMouseEvent) => handle(event);
    map.on("click", listener);
    return () => {
      map.off("click", listener);
    };
  }, [map]);
  return null;
}

function WheelZoom({ enabled }: { enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
  }, [map, enabled]);
  return null;
}
