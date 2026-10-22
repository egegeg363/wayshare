import "server-only";

import { z } from "zod";
import {
  estimateRoute,
  formatCoords,
  nearestCity,
  roundKm,
  searchDirectory,
  type LatLng,
  type Place,
} from "@/lib/geo";

/**
 * Live map services with deterministic fallbacks:
 *  - OSRM (road distance, duration, geometry)  → falls back to Haversine × 1.22
 *  - Nominatim (forward + reverse geocoding)   → falls back to the built-in city directory
 *
 * Each service sits behind a short timeout, a TTL cache and a circuit breaker, so when the
 * machine is offline the app stays instant instead of waiting on timeouts.
 */

const OSRM_URL = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/$/, "");
const NOMINATIM_URL = (process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const OFFLINE = process.env.WAYSHARE_OFFLINE === "1";
// Nominatim's usage policy requires an identifying User-Agent.
const USER_AGENT = "WayShare/1.0 (peer-to-peer carpooling demo; self-hosted)";

class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}
  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V) {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}

type Service = "osrm" | "nominatim";
const openUntil: Record<Service, number> = { osrm: 0, nominatim: 0 };
const isAvailable = (service: Service) => !OFFLINE && Date.now() >= openUntil[service];
const tripBreaker = (service: Service, ms = 60_000) => {
  openUntil[service] = Date.now() + ms;
};

// ---------------------------------------------------------------------------------------
// Routing (OSRM)
// ---------------------------------------------------------------------------------------

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  geometry: [number, number][];
  source: "osrm" | "estimate";
};

const OsrmResponse = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }),
      }),
    )
    .optional(),
});

const routeCache = new TtlCache<RouteResult>(500, 6 * 60 * 60_000);

function estimatedRoute(points: LatLng[]): RouteResult {
  const estimate = estimateRoute(points);
  return { ...estimate, geometry: points.map((p) => [p.lat, p.lng]), source: "estimate" };
}

export async function getRoute(points: LatLng[]): Promise<RouteResult> {
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
  const cached = routeCache.get(key);
  if (cached) return cached;
  if (!isAvailable("osrm")) return estimatedRoute(points);

  try {
    const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    const response = await fetch(
      `${OSRM_URL}/route/v1/driving/${coords}?overview=simplified&geometries=geojson&alternatives=false&steps=false`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(4_000), cache: "no-store" },
    );
    if (response.status === 429) {
      tripBreaker("osrm", 30_000);
      return estimatedRoute(points);
    }
    if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
    const data = OsrmResponse.parse(await response.json());
    const best = data.routes?.[0];
    // "NoRoute" (e.g. a pin in the sea) is a valid answer, not an outage: no breaker trip.
    if (data.code !== "Ok" || !best) return estimatedRoute(points);
    const result: RouteResult = {
      distanceKm: roundKm(best.distance / 1000),
      durationMin: Math.max(1, Math.round(best.duration / 60)),
      geometry: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: "osrm",
    };
    routeCache.set(key, result);
    return result;
  } catch (error) {
    console.warn("[geo] OSRM unavailable, using Haversine estimate:", (error as Error).message);
    tripBreaker("osrm");
    return estimatedRoute(points);
  }
}

// ---------------------------------------------------------------------------------------
// Geocoding (Nominatim) — throttled to ≤ 1 request/second per the OSM usage policy
// ---------------------------------------------------------------------------------------

const NominatimPlace = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  name: z.string().optional().nullable(),
  display_name: z.string(),
  address: z.record(z.string(), z.string()).optional(),
});

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + 1_100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function nominatim(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${NOMINATIM_URL}/${path}?${new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    "accept-language": "en",
    ...params,
  })}`;
  return throttled(async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (response.status === 429) {
      tripBreaker("nominatim", 30_000);
      throw new Error("Nominatim rate limit");
    }
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    return response.json();
  });
}

type NominatimRaw = z.infer<typeof NominatimPlace>;

function addressParts(raw: NominatimRaw) {
  const address = raw.address ?? {};
  const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county;
  const street = address.road ? [address.road, address.house_number].filter(Boolean).join(" ") : undefined;
  const area = address.suburb ?? address.neighbourhood ?? address.quarter;
  return { locality, street, area, country: address.country };
}

/** Search hit: the feature's own name ("Leipzig Hauptbahnhof") with its address underneath. */
function placeFromSearch(raw: NominatimRaw): Place {
  const { locality, street, country } = addressParts(raw);
  const name = raw.name?.trim() || street || locality || raw.display_name.split(",")[0].trim();
  const detail = [street !== name ? street : undefined, locality !== name ? locality : undefined, country]
    .filter(Boolean)
    .join(", ");
  return { name, detail: detail || undefined, lat: raw.lat, lng: raw.lon, source: "nominatim" };
}

/** Dropped pin: label by street address — feature names at a point are often noise ("OG", "Gate 3"). */
function placeFromReverse(raw: NominatimRaw, point: LatLng): Place {
  const { locality, street, area, country } = addressParts(raw);
  const name = street || area || locality || raw.name?.trim() || raw.display_name.split(",")[0].trim();
  const detail = [area !== name ? area : undefined, locality !== name ? locality : undefined, country]
    .filter(Boolean)
    .join(", ");
  return { name, detail: detail || formatCoords(point), lat: point.lat, lng: point.lng, source: "pin" };
}

/** Nominatim often returns several entrances of one station: keep one per name per ~300 m. */
function dedupe(places: Place[]): Place[] {
  const kept: Place[] = [];
  for (const place of places) {
    const duplicate = kept.some(
      (k) => k.name === place.name && Math.abs(k.lat - place.lat) < 0.003 && Math.abs(k.lng - place.lng) < 0.004,
    );
    if (!duplicate) kept.push(place);
  }
  return kept;
}

const geocodeCache = new TtlCache<Place[]>(500, 24 * 60 * 60_000);

export async function geocode(query: string): Promise<{ results: Place[]; source: "nominatim" | "directory" | "offline" }> {
  const key = query.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return { results: cached, source: "nominatim" };

  if (isAvailable("nominatim")) {
    try {
      const data = z.array(NominatimPlace).parse(
        await nominatim("search", {
          q: query,
          limit: "6",
          // Prefer — but do not restrict to — Central Europe.
          viewbox: "-10,60,30,35",
          bounded: "0",
        }),
      );
      const results = dedupe(data.map(placeFromSearch));
      geocodeCache.set(key, results);
      return { results, source: "nominatim" };
    } catch (error) {
      console.warn("[geo] Nominatim unavailable:", (error as Error).message);
      tripBreaker("nominatim");
    }
  }
  const directory = searchDirectory(query);
  return directory.length ? { results: directory, source: "directory" } : { results: [], source: "offline" };
}

const reverseCache = new TtlCache<Place>(1_000, 24 * 60 * 60_000);

function pinFallback(point: LatLng): Place {
  const { place, distanceKm } = nearestCity(point);
  return {
    name: distanceKm <= 25 ? `Near ${place.name}` : "Dropped pin",
    detail: formatCoords(point),
    lat: point.lat,
    lng: point.lng,
    source: "pin",
  };
}

export async function reverseGeocode(point: LatLng): Promise<{ place: Place; source: "nominatim" | "directory" }> {
  const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached) return { place: cached, source: "nominatim" };

  if (isAvailable("nominatim")) {
    try {
      const data = NominatimPlace.safeParse(
        await nominatim("reverse", { lat: String(point.lat), lon: String(point.lng), zoom: "16" }),
      );
      if (data.success) {
        // Keep the exact pin the user dropped; Nominatim only supplies the label.
        const place = placeFromReverse(data.data, point);
        reverseCache.set(key, place);
        return { place, source: "nominatim" };
      }
    } catch (error) {
      console.warn("[geo] Nominatim reverse unavailable:", (error as Error).message);
      tripBreaker("nominatim");
    }
  }
  return { place: pinFallback(point), source: "directory" };
}
