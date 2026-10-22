/**
 * Domain vocabulary shared by the API, the UI and the seed script.
 * Status columns are stored as plain strings (portable across SQLite/PostgreSQL);
 * these unions are the single source of truth for their allowed values.
 */

export const RIDE_STATUSES = ["OPEN", "FULL", "COMPLETED", "CANCELLED"] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const BOOKING_STATUSES = ["CONFIRMED_IN_ESCROW", "PICKED_UP_PAID", "CANCELLED", "DECLINED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Bookings that still hold a seat and detour budget on their ride. */
export function holdsSeat(status: string): boolean {
  return status === "CONFIRMED_IN_ESCROW" || status === "PICKED_UP_PAID";
}

export const TRANSACTION_TYPES = ["ESCROW_HOLD", "DRIVER_PAYOUT", "REFUND", "TOP_UP"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * A trip counts as past once it has (estimatedly) arrived plus this buffer — not at departure,
 * because pickups along the route (and their PIN check-ins) happen hours into a long trip.
 */
export const TRIP_PAST_AFTER_ARRIVAL_MIN = 120;

export function isTripPast(estimatedArrival: Date | string, now: number = Date.now()): boolean {
  return new Date(estimatedArrival).getTime() + TRIP_PAST_AFTER_ARRIVAL_MIN * 60_000 < now;
}

export const MIN_SEATS = 1;
export const MAX_SEATS = 6;
export const MAX_DETOUR_KM = 30;
export const DEFAULT_TOP_UP_EUR = 50;

/** A booking's PIN is 4 digits, zero-padded. */
export const PIN_PATTERN = /^\d{4}$/;

export function asRideStatus(value: string): RideStatus {
  return (RIDE_STATUSES as readonly string[]).includes(value) ? (value as RideStatus) : "OPEN";
}

export function asBookingStatus(value: string): BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value)
    ? (value as BookingStatus)
    : "CANCELLED";
}

export function asTransactionType(value: string): TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(value)
    ? (value as TransactionType)
    : "TOP_UP";
}
