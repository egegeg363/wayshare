/**
 * API contracts — the single Zod source of truth for every request and response.
 * Route handlers validate inputs with these schemas; the browser client validates
 * every response with them, so both ends agree on shapes at runtime and compile time.
 */
import { z } from "zod";
import {
  BOOKING_STATUSES,
  DEFAULT_TOP_UP_EUR,
  MAX_DETOUR_KM,
  MAX_SEATS,
  MIN_SEATS,
  PIN_PATTERN,
  RIDE_STATUSES,
  TRANSACTION_TYPES,
} from "./domain";
import { haversineKm } from "./geo";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const isoDateTime = z.iso.datetime({ offset: true });
const money = z.number().finite();

// ---------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------

export const PlaceSchema = z.object({
  name: z.string(),
  detail: z.string().optional(),
  lat,
  lng,
  source: z.enum(["directory", "nominatim", "pin"]),
});
export type PlaceDTO = z.infer<typeof PlaceSchema>;

export const PlaceInputSchema = z.object({
  name: z.string().trim().min(1, "Choose a place").max(160),
  lat,
  lng,
});
export type PlaceInput = z.infer<typeof PlaceInputSchema>;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string(),
  rating: z.number(),
  vehicleModel: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  walletBalance: money,
  isDriver: z.boolean(),
});
export type UserDTO = z.infer<typeof UserSchema>;

export const DriverSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string(),
  rating: z.number(),
  vehicleModel: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
});
export type DriverSummaryDTO = z.infer<typeof DriverSummarySchema>;

export const PriceBreakdownSchema = z.object({
  seats: z.number().int(),
  /** Driver's price per seat for the full route. */
  fullPricePerSeat: money,
  /** Fraction of the route this passenger rides (pickup → destination). */
  routeShare: z.number().min(0).max(1),
  /** Fraction of the full price charged (routeShare, at least the minimum fare share). */
  fareShare: z.number().min(0).max(1),
  /** What this passenger pays per seat. */
  pricePerSeat: money,
  seatCost: money,
  detourDistanceKm: z.number(),
  detourPricePerKm: money,
  detourCost: money,
  platformFeeRate: z.number(),
  platformFee: money,
  totalPrice: money,
  driverPayout: money,
});

export const TransactionSchema = z.object({
  id: z.string(),
  bookingId: z.string().nullable(),
  amount: money,
  type: z.enum(TRANSACTION_TYPES),
  description: z.string(),
  createdAt: isoDateTime,
});
export type TransactionDTO = z.infer<typeof TransactionSchema>;

const RideCoreSchema = z.object({
  id: z.string(),
  originName: z.string(),
  originLat: lat,
  originLng: lng,
  destName: z.string(),
  destLat: lat,
  destLng: lng,
  departureTime: isoDateTime,
  baseDistanceKm: z.number(),
  baseDurationMin: z.number().int(),
  /** The route line detours are measured against, as [lat, lng] pairs. */
  routeGeometry: z.array(z.tuple([z.number(), z.number()])),
  totalSeats: z.number().int(),
  availableSeats: z.number().int(),
  pricePerSeat: money,
  maxDetourKm: z.number(),
  remainingDetourKm: z.number(),
  detourPricePerKm: money,
  notes: z.string().nullable(),
  status: z.enum(RIDE_STATUSES),
});

// ---------------------------------------------------------------------------------------
// Users, session & wallet
// ---------------------------------------------------------------------------------------

export const UsersResponseSchema = z.object({
  users: z.array(UserSchema),
  currentUserId: z.string(),
});

export const SessionRequestSchema = z.object({ userId: z.string().min(1) });
export const SessionResponseSchema = z.object({ user: UserSchema });

export const TopUpRequestSchema = z.object({
  amount: z.number().positive().max(500).default(DEFAULT_TOP_UP_EUR),
});
export const TopUpResponseSchema = z.object({ user: UserSchema, transaction: TransactionSchema });

// ---------------------------------------------------------------------------------------
// Ride search  —  GET /api/rides
// ---------------------------------------------------------------------------------------

const optionalLat = z.coerce.number().min(-90).max(90).optional();
const optionalLng = z.coerce.number().min(-180).max(180).optional();

export const RideSearchQuerySchema = z
  .object({
    originLat: optionalLat,
    originLng: optionalLng,
    destLat: optionalLat,
    destLng: optionalLng,
    pickupLat: optionalLat,
    pickupLng: optionalLng,
    pickupName: z.string().trim().max(160).optional(),
    seats: z.coerce.number().int().min(MIN_SEATS).max(MAX_SEATS).default(1),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .optional(),
    /** Browser `Date#getTimezoneOffset()` so `date` is interpreted in the searcher's day. */
    tzOffset: z.coerce.number().int().min(-840).max(840).optional(),
  })
  .superRefine((q, ctx) => {
    for (const key of ["origin", "dest", "pickup"] as const) {
      const hasLat = q[`${key}Lat`] !== undefined;
      const hasLng = q[`${key}Lng`] !== undefined;
      if (hasLat !== hasLng) {
        ctx.addIssue({
          code: "custom",
          path: [hasLat ? `${key}Lng` : `${key}Lat`],
          message: `${key}Lat and ${key}Lng must be provided together`,
        });
      }
    }
  });
export type RideSearchQuery = z.infer<typeof RideSearchQuerySchema>;

export const RideSearchResultSchema = RideCoreSchema.extend({
  driver: DriverSummarySchema,
  estimatedArrivalTime: isoDateTime,
  isOwnRide: z.boolean(),
  /** Pickup the detour was computed for (explicit pickup, else the searched origin). */
  pickup: z.object({ name: z.string(), lat, lng }).nullable(),
  /** Distance from the pickup to the ride's route (km) — compared with the driver's pickup radius. */
  offRouteKm: z.number(),
  /** Extra road distance for the driver (there and back) — the basis for the detour fee. */
  detourDistanceKm: z.number(),
  detourDurationMin: z.number().int(),
  isWithinDetourRadius: z.boolean(),
  hasEnoughSeats: z.boolean(),
  isEligible: z.boolean(),
  ineligibleReason: z
    .enum(["RIDE_NOT_OPEN", "NOT_ENOUGH_SEATS", "DETOUR_EXCEEDED", "OWN_RIDE", "ALREADY_BOOKED", "DECLINED_BY_DRIVER"])
    .nullable(),
  priceBreakdown: PriceBreakdownSchema,
});
export type RideSearchResultDTO = z.infer<typeof RideSearchResultSchema>;

export const RideSearchResponseSchema = z.object({
  rides: z.array(RideSearchResultSchema),
  meta: z.object({
    total: z.number().int(),
    eligible: z.number().int(),
    outOfRange: z.number().int(),
    seats: z.number().int(),
  }),
});
export type RideSearchResponse = z.infer<typeof RideSearchResponseSchema>;

// ---------------------------------------------------------------------------------------
// Ride offers  —  POST /api/rides
// ---------------------------------------------------------------------------------------

export const CreateRideRequestSchema = z
  .object({
    origin: PlaceInputSchema,
    destination: PlaceInputSchema,
    departureTime: isoDateTime,
    totalSeats: z.number().int().min(MIN_SEATS).max(MAX_SEATS),
    pricePerSeat: z.number().min(1, "Minimum €1 per seat").max(250, "Maximum €250 per seat"),
    maxDetourKm: z.number().min(0).max(MAX_DETOUR_KM),
    detourPricePerKm: z.number().min(0).max(5).default(0),
    notes: z.string().trim().max(280).optional(),
    vehicleModel: z.string().trim().min(2).max(60).optional(),
    vehiclePlate: z.string().trim().min(2).max(16).optional(),
  })
  .superRefine((body, ctx) => {
    if (haversineKm(body.origin, body.destination) < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Destination must be different from the origin",
      });
    }
    const departure = Date.parse(body.departureTime);
    if (departure < Date.now() - 5 * 60_000) {
      ctx.addIssue({ code: "custom", path: ["departureTime"], message: "Departure must be in the future" });
    }
    if (departure > Date.now() + 365 * 24 * 3_600_000) {
      ctx.addIssue({ code: "custom", path: ["departureTime"], message: "Departure must be within a year" });
    }
  });
export type CreateRideRequest = z.input<typeof CreateRideRequestSchema>;

export const ManifestEntrySchema = z.object({
  id: z.string(),
  status: z.enum(BOOKING_STATUSES),
  seatsBooked: z.number().int(),
  pickupName: z.string(),
  pickupLat: lat,
  pickupLng: lng,
  offRouteKm: z.number(),
  detourDistanceKm: z.number(),
  detourDurationMin: z.number().int(),
  fareShare: z.number(),
  seatCost: money,
  detourCost: money,
  payout: money,
  createdAt: isoDateTime,
  passenger: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string(),
    rating: z.number(),
  }),
});
export type ManifestEntryDTO = z.infer<typeof ManifestEntrySchema>;

export const DriverRideSchema = RideCoreSchema.extend({
  estimatedArrivalTime: isoDateTime,
  /** The trip ended (arrival + buffer) — shown under history, not in the active list. */
  isPast: z.boolean(),
  createdAt: isoDateTime,
  manifest: z.array(ManifestEntrySchema),
  earnings: z.object({ paidOut: money, inEscrow: money }),
});
export type DriverRideDTO = z.infer<typeof DriverRideSchema>;

export const CreateRideResponseSchema = z.object({
  ride: DriverRideSchema,
  routeSource: z.enum(["osrm", "estimate"]),
});

export const RideActionResponseSchema = z.object({
  rideId: z.string(),
  status: z.enum(RIDE_STATUSES),
  refundedBookings: z.number().int(),
  refundedAmount: money,
});

// ---------------------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------------------

export const CardPaymentSchema = z.object({
  number: z.string().trim().min(12).max(23),
  expiry: z.string().trim().regex(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/, "Use MM/YY"),
  cvc: z.string().trim().regex(/^\d{3,4}$/, "3–4 digits"),
  holder: z.string().trim().min(2, "Name on card").max(80),
});

export const CreateBookingRequestSchema = z.object({
  rideOfferId: z.string().min(1),
  seats: z.number().int().min(MIN_SEATS).max(MAX_SEATS),
  pickup: PlaceInputSchema,
  payment: z.discriminatedUnion("method", [
    z.object({ method: z.literal("WALLET") }),
    z.object({ method: z.literal("CARD"), card: CardPaymentSchema }),
  ]),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

export const PassengerBookingSchema = z.object({
  id: z.string(),
  status: z.enum(BOOKING_STATUSES),
  seatsBooked: z.number().int(),
  pickupName: z.string(),
  pickupLat: lat,
  pickupLng: lng,
  offRouteKm: z.number(),
  detourDistanceKm: z.number(),
  detourDurationMin: z.number().int(),
  fareShare: z.number(),
  seatCost: money,
  detourCost: money,
  platformFee: money,
  totalPrice: money,
  pickupPin: z.string(),
  createdAt: isoDateTime,
  /** The trip ended (arrival + buffer) — shown under history, not in the active list. */
  isPast: z.boolean(),
  ride: RideCoreSchema.extend({
    estimatedArrivalTime: isoDateTime,
    driver: DriverSummarySchema,
  }),
});
export type PassengerBookingDTO = z.infer<typeof PassengerBookingSchema>;

export const CreateBookingResponseSchema = z.object({
  booking: PassengerBookingSchema,
  walletBalance: money,
});

export const VerifyPinRequestSchema = z.object({
  pin: z.string().trim().regex(PIN_PATTERN, "Enter the 4-digit PIN"),
});
export const VerifyPinResponseSchema = z.object({
  booking: ManifestEntrySchema,
  payout: money,
  walletBalance: money,
});

/** Response of both passenger cancellation and driver decline. */
export const ReleaseBookingResponseSchema = z.object({
  bookingId: z.string(),
  status: z.enum(BOOKING_STATUSES),
  refund: money,
  /** Seats free on the ride afterwards. */
  availableSeats: z.number().int(),
});

// ---------------------------------------------------------------------------------------
// Dashboard  —  GET /api/trips
// ---------------------------------------------------------------------------------------

export const TripsResponseSchema = z.object({
  user: UserSchema,
  bookings: z.array(PassengerBookingSchema),
  rides: z.array(DriverRideSchema),
  wallet: z.object({
    balance: money,
    /** Passenger money currently held for upcoming pickups. */
    heldInEscrow: money,
    /** Driver money waiting on passenger PINs. */
    pendingPayouts: money,
    totalPaidOut: money,
    transactions: z.array(TransactionSchema),
  }),
});
export type TripsResponse = z.infer<typeof TripsResponseSchema>;

// ---------------------------------------------------------------------------------------
// Geo services
// ---------------------------------------------------------------------------------------

export const GeocodeResponseSchema = z.object({
  results: z.array(PlaceSchema),
  source: z.enum(["nominatim", "directory", "offline"]),
});

export const ReverseGeocodeResponseSchema = z.object({
  place: PlaceSchema,
  source: z.enum(["nominatim", "directory"]),
});

export const RouteResponseSchema = z.object({
  distanceKm: z.number(),
  durationMin: z.number().int(),
  /** [lat, lng] pairs following the road network (or the straight line when estimated). */
  geometry: z.array(z.tuple([z.number(), z.number()])),
  source: z.enum(["osrm", "estimate"]),
});
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

// ---------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
