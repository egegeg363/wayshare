/**
 * Pricing rules — shared verbatim by the checkout preview and the booking API so that
 * the quote a passenger sees is exactly what gets charged.
 *
 * The driver sets one price per seat for the full route. A passenger who boards along the
 * way pays for the part of the route they actually ride (everyone is dropped at the
 * destination), never less than MIN_FARE_SHARE of the full price — a stop costs the
 * driver time whatever the distance.
 */

/** WayShare service fee, charged to the passenger on top of what the driver receives. */
export const PLATFORM_FEE_RATE = 0.08;
export const PLATFORM_FEE_MIN_EUR = 0.5;
/** Minimum share of the full-route seat price any passenger pays. */
export const MIN_FARE_SHARE = 0.2;
/** Running cost per passenger-km used for the "fair cost-split" suggestion (fuel + wear). */
export const FAIR_SHARE_EUR_PER_KM = 0.068;

/** Round to whole cents. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Share of the full price that is billed: the ridden share in whole percent, at least MIN_FARE_SHARE. */
export function fareShareFor(routeShare: number): number {
  const ridden = Math.round(Math.min(1, Math.max(0, routeShare)) * 100) / 100;
  return Math.max(MIN_FARE_SHARE, ridden);
}

/** Per-seat price for a fare share, rounded to €0.10 and never above the full-route price. */
export function seatPriceFor(fullPrice: number, fareShare: number): number {
  if (fareShare >= 1) return round2(fullPrice);
  return Math.min(round2(fullPrice), Math.round(fullPrice * fareShare * 10) / 10);
}

export type PriceBreakdown = {
  seats: number;
  /** The driver's price per seat for the full route. */
  fullPricePerSeat: number;
  /** Fraction of the route this passenger rides (pickup → destination ÷ origin → destination). */
  routeShare: number;
  /** Fraction of the full price charged: routeShare rounded to whole percent, at least MIN_FARE_SHARE. */
  fareShare: number;
  /** What this passenger pays per seat. */
  pricePerSeat: number;
  seatCost: number;
  detourDistanceKm: number;
  detourPricePerKm: number;
  detourCost: number;
  platformFeeRate: number;
  platformFee: number;
  totalPrice: number;
  /** What the driver receives once the pickup PIN is verified (seatCost + detourCost). */
  driverPayout: number;
};

export function quotePrice(input: {
  /** Full-route price per seat, as set by the driver. */
  pricePerSeat: number;
  seats: number;
  /** From `routeShare()` in geo.ts; 1 when boarding at the driver's origin. */
  routeShare: number;
  detourDistanceKm: number;
  detourPricePerKm: number;
}): PriceBreakdown {
  const routeShare = Math.round(Math.min(1, Math.max(0, input.routeShare)) * 100) / 100;
  const fareShare = fareShareFor(routeShare);
  const pricePerSeat = seatPriceFor(input.pricePerSeat, fareShare);
  const seatCost = round2(pricePerSeat * input.seats);
  // The car drives the extra kilometres once, regardless of how many seats are booked.
  const detourCost = round2(input.detourDistanceKm * input.detourPricePerKm);
  const driverPayout = round2(seatCost + detourCost);
  const platformFee = round2(Math.max(PLATFORM_FEE_MIN_EUR, driverPayout * PLATFORM_FEE_RATE));
  return {
    seats: input.seats,
    fullPricePerSeat: round2(input.pricePerSeat),
    routeShare,
    fareShare,
    pricePerSeat,
    seatCost,
    detourDistanceKm: input.detourDistanceKm,
    detourPricePerKm: input.detourPricePerKm,
    detourCost,
    platformFeeRate: PLATFORM_FEE_RATE,
    platformFee,
    totalPrice: round2(driverPayout + platformFee),
    driverPayout,
  };
}

/** Suggested full-route seat price that splits running costs fairly; rounded to the nearest €0.50. */
export function suggestSeatPrice(distanceKm: number): number {
  const raw = distanceKm * FAIR_SHARE_EUR_PER_KM;
  return Math.max(5, Math.round(raw * 2) / 2);
}
