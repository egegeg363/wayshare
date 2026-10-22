"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { api, isAbortError, toApiError, type ApiError } from "./api-client";
import type { RouteResponse } from "./contracts";
import { estimateRoute, type LatLng } from "./geo";

type Settled<T> = { key: string; data?: T; error?: ApiError };

/**
 * Keyed async data. Change `key` to refetch; `null` pauses. Keeps the previous data while a
 * new key loads (stale-while-revalidate) and ignores responses for superseded keys.
 * Loading state is derived (key ≠ settled key) rather than set inside the effect.
 */
export function useResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ key, data });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSettled((prev) => ({ key, data: prev?.data, error: toApiError(error) }));
      },
    );
    return () => controller.abort();
  }, [key]);

  const isCurrent = settled !== null && settled.key === key;
  return {
    data: settled?.data,
    error: isCurrent ? settled.error : undefined,
    isLoading: key !== null && !isCurrent,
    /** True when `data` belongs to a previous key. */
    isStale: settled !== null && !isCurrent,
  };
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards — for time- or locale-dependent UI. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const directionsCache = new Map<string, RouteResponse>();

function directionsKey(points: LatLng[]) {
  return points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
}

/**
 * Road geometry for a list of points via OSRM (proxied by /api/directions). Until it
 * arrives — or if routing is offline — returns the deterministic straight-line estimate.
 */
export function useDirections(points: LatLng[] | null) {
  const key = points && points.length >= 2 ? directionsKey(points) : null;
  const { data, error, isLoading } = useResource<RouteResponse>(key, async (signal) => {
    const hit = directionsCache.get(key!);
    if (hit) return hit;
    const route = await api.directions(points!, signal);
    directionsCache.set(key!, route);
    return route;
  });

  if (!key || !points) return null;
  // Only trust `data` once it is settled for *this* key (it may still hold the previous route).
  if (data && !isLoading && !error) return { ...data, loading: false };
  const estimate = estimateRoute(points);
  return {
    ...estimate,
    geometry: points.map((p) => [p.lat, p.lng] as [number, number]),
    source: "estimate" as const,
    loading: isLoading,
  };
}
