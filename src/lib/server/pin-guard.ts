import "server-only";

import { HttpError } from "./http";

/**
 * Brute-force protection for 4-digit pickup PINs: 5 wrong guesses lock a booking's PIN
 * check for 10 minutes. In-memory is enough for a single-node deployment; move it to
 * Redis (or a column) when running several instances.
 */
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60_000;
const attempts = new Map<string, { failures: number; lockedUntil: number }>();

export function assertPinAttemptAllowed(bookingId: string) {
  const entry = attempts.get(bookingId);
  if (entry && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    throw new HttpError(429, "PIN_LOCKED", `Too many incorrect PINs. Try again in ${minutes} min.`);
  }
}

/** Records a wrong guess and returns how many attempts remain before the lock. */
export function recordPinFailure(bookingId: string): number {
  const now = Date.now();
  const entry = attempts.get(bookingId) ?? { failures: 0, lockedUntil: 0 };
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    entry.failures = 0;
    entry.lockedUntil = 0;
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) entry.lockedUntil = now + LOCK_MS;
  attempts.set(bookingId, entry);
  return Math.max(0, MAX_FAILURES - entry.failures);
}

export function clearPinFailures(bookingId: string) {
  attempts.delete(bookingId);
}
