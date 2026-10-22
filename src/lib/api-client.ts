/**
 * Browser-side API client. Every response is validated against the shared Zod contracts,
 * so a drifting backend fails loudly at the boundary instead of deep inside a component.
 */
import { z } from "zod";
import {
  ApiErrorSchema,

  CreateBookingResponseSchema,
  CreateRideResponseSchema,
  GeocodeResponseSchema,
  ReverseGeocodeResponseSchema,
  RideActionResponseSchema,
  ReleaseBookingResponseSchema,
  RideSearchResponseSchema,
  RouteResponseSchema,
  SessionResponseSchema,
  TopUpResponseSchema,
  TripsResponseSchema,
  UsersResponseSchema,
  VerifyPinResponseSchema,
  type CreateBookingRequest,
  type CreateRideRequest,
} from "./contracts";
import type { LatLng } from "./geo";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "UNKNOWN", error instanceof Error ? error.message : "Something went wrong.");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type RequestOptions = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal };

async function request<S extends z.ZodType>(schema: S, path: string, options: RequestOptions = {}): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "NETWORK", "Can't reach WayShare right now. Check your connection.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (error) {
    // The caller aborted mid-download (e.g. the search key changed): that's an abort, not a bad payload.
    if (isAbortError(error) || options.signal?.aborted) throw error;
  }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, fieldErrors } = parsed.data.error;
      throw new ApiError(response.status, code, message, fieldErrors);
    }
    throw new ApiError(response.status, "HTTP_ERROR", `Request failed (${response.status}).`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error(`[api] ${path} returned an unexpected shape:\n${z.prettifyError(parsed.error)}`);
    throw new ApiError(500, "BAD_RESPONSE", "The server sent an unexpected response.");
  }
  return parsed.data;
}

const post = <S extends z.ZodType>(schema: S, path: string, body?: unknown) =>
  request(schema, path, { method: "POST", body: body ?? {} });

export type RideSearchParams = {
  origin?: LatLng | null;
  destination?: LatLng | null;
  pickup?: (LatLng & { name?: string }) | null;
  seats: number;
  date?: string;
};

export function rideSearchQueryString(params: RideSearchParams): string {
  const qs = new URLSearchParams();
  const put = (prefix: string, p?: LatLng | null) => {
    if (!p) return;
    qs.set(`${prefix}Lat`, p.lat.toFixed(5));
    qs.set(`${prefix}Lng`, p.lng.toFixed(5));
  };
  put("origin", params.origin);
  put("dest", params.destination);
  put("pickup", params.pickup);
  if (params.pickup?.name) qs.set("pickupName", params.pickup.name);
  qs.set("seats", String(params.seats));
  if (params.date) {
    qs.set("date", params.date);
    // Interpret the calendar day in the searcher's own time zone.
    const [y, m, d] = params.date.split("-").map(Number);
    qs.set("tzOffset", String(new Date(y, m - 1, d).getTimezoneOffset()));
  }
  return qs.toString();
}

export const api = {
  users: (signal?: AbortSignal) => request(UsersResponseSchema, "/api/users", { signal }),
  switchUser: (userId: string) => post(SessionResponseSchema, "/api/session", { userId }),
  topUp: (amount = 50) => post(TopUpResponseSchema, "/api/users/topup", { amount }),

  /** `query` comes from `rideSearchQueryString`, so callers can debounce/compare it. */
  searchRides: (query: string, signal?: AbortSignal) =>
    request(RideSearchResponseSchema, `/api/rides?${query}`, { signal }),
  createRide: (body: CreateRideRequest) => post(CreateRideResponseSchema, "/api/rides", body),
  cancelRide: (rideId: string) => post(RideActionResponseSchema, `/api/rides/${rideId}/cancel`),
  completeRide: (rideId: string) => post(RideActionResponseSchema, `/api/rides/${rideId}/complete`),

  createBooking: (body: CreateBookingRequest) => post(CreateBookingResponseSchema, "/api/bookings", body),
  verifyPin: (bookingId: string, pin: string) =>
    post(VerifyPinResponseSchema, `/api/bookings/${bookingId}/verify-pin`, { pin }),
  cancelBooking: (bookingId: string) => post(ReleaseBookingResponseSchema, `/api/bookings/${bookingId}/cancel`),
  declineBooking: (bookingId: string) => post(ReleaseBookingResponseSchema, `/api/bookings/${bookingId}/decline`),

  trips: (signal?: AbortSignal) => request(TripsResponseSchema, "/api/trips", { signal }),

  geocode: (q: string, signal?: AbortSignal) =>
    request(GeocodeResponseSchema, `/api/geocode?${new URLSearchParams({ q })}`, { signal }),
  reverseGeocode: (p: LatLng, signal?: AbortSignal) =>
    request(
      ReverseGeocodeResponseSchema,
      `/api/geocode/reverse?${new URLSearchParams({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) })}`,
      { signal },
    ),
  directions: (points: LatLng[], signal?: AbortSignal) =>
    request(
      RouteResponseSchema,
      `/api/directions?${new URLSearchParams({
        points: points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";"),
      })}`,
      { signal },
    ),
};
