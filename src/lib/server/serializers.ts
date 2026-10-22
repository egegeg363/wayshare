import "server-only";

import type { Booking, RideOffer, Transaction, User } from "@/generated/prisma/client";
import type {
  DriverRideDTO,
  DriverSummaryDTO,
  ManifestEntryDTO,
  PassengerBookingDTO,
  TransactionDTO,
  UserDTO,
} from "@/lib/contracts";
import { asBookingStatus, asRideStatus, asTransactionType, holdsSeat, isTripPast } from "@/lib/domain";
import { decodePolyline, roundKm, straightRoute, type RoutePath } from "@/lib/geo";
import { round2 } from "@/lib/pricing";

/** Prisma models → API DTOs. Money is normalised to cents and distances to 0.1 km on the way out. */

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    rating: user.rating,
    vehicleModel: user.vehicleModel,
    vehiclePlate: user.vehiclePlate,
    walletBalance: round2(user.walletBalance),
    isDriver: Boolean(user.vehicleModel),
  };
}

export function toDriverSummary(user: User): DriverSummaryDTO {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    rating: user.rating,
    vehicleModel: user.vehicleModel,
    vehiclePlate: user.vehiclePlate,
  };
}

/** The line a ride's detours are measured against: its stored road route, else origin → destination. */
export function rideRoute(ride: RideOffer): RoutePath {
  const stored = ride.routeGeometry ? decodePolyline(ride.routeGeometry) : [];
  return stored.length >= 2
    ? stored
    : straightRoute({ lat: ride.originLat, lng: ride.originLng }, { lat: ride.destLat, lng: ride.destLng });
}

export function toRideCore(ride: RideOffer) {
  return {
    id: ride.id,
    originName: ride.originName,
    originLat: ride.originLat,
    originLng: ride.originLng,
    destName: ride.destName,
    destLat: ride.destLat,
    destLng: ride.destLng,
    departureTime: ride.departureTime.toISOString(),
    baseDistanceKm: roundKm(ride.baseDistanceKm),
    baseDurationMin: ride.baseDurationMin,
    routeGeometry: rideRoute(ride).map((p): [number, number] => [p.lat, p.lng]),
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    pricePerSeat: round2(ride.pricePerSeat),
    maxDetourKm: roundKm(ride.maxDetourKm),
    remainingDetourKm: roundKm(ride.remainingDetourKm),
    detourPricePerKm: round2(ride.detourPricePerKm),
    notes: ride.notes,
    status: asRideStatus(ride.status),
  };
}

export function arrivalTime(ride: RideOffer, extraMinutes = 0): string {
  return new Date(
    ride.departureTime.getTime() + (ride.baseDurationMin + extraMinutes) * 60_000,
  ).toISOString();
}

export function toManifestEntry(booking: Booking & { passenger: User }): ManifestEntryDTO {
  return {
    id: booking.id,
    status: asBookingStatus(booking.status),
    seatsBooked: booking.seatsBooked,
    pickupName: booking.pickupName,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    offRouteKm: roundKm(booking.offRouteKm),
    detourDistanceKm: roundKm(booking.detourDistanceKm),
    detourDurationMin: booking.detourDurationMin,
    fareShare: booking.fareShare,
    seatCost: round2(booking.seatCost),
    detourCost: round2(booking.detourCost),
    payout: round2(booking.seatCost + booking.detourCost),
    createdAt: booking.createdAt.toISOString(),
    // Deliberately no pickupPin: the driver must get it from the passenger in person.
    passenger: {
      id: booking.passenger.id,
      name: booking.passenger.name,
      avatarUrl: booking.passenger.avatarUrl,
      rating: booking.passenger.rating,
    },
  };
}

export function toDriverRide(
  ride: RideOffer & { bookings: (Booking & { passenger: User })[] },
): DriverRideDTO {
  const active = ride.bookings.filter((b) => holdsSeat(b.status));
  const detourMinutes = active.reduce((sum, b) => sum + b.detourDurationMin, 0);
  const sumPayout = (status: string) =>
    round2(
      ride.bookings
        .filter((b) => b.status === status)
        .reduce((sum, b) => sum + b.seatCost + b.detourCost, 0),
    );
  const estimatedArrivalTime = arrivalTime(ride, detourMinutes);
  return {
    ...toRideCore(ride),
    estimatedArrivalTime,
    isPast: isTripPast(estimatedArrivalTime),
    createdAt: ride.createdAt.toISOString(),
    manifest: ride.bookings.map(toManifestEntry),
    earnings: { paidOut: sumPayout("PICKED_UP_PAID"), inEscrow: sumPayout("CONFIRMED_IN_ESCROW") },
  };
}

export function toPassengerBooking(
  booking: Booking & { rideOffer: RideOffer & { driver: User } },
): PassengerBookingDTO {
  return {
    id: booking.id,
    status: asBookingStatus(booking.status),
    seatsBooked: booking.seatsBooked,
    pickupName: booking.pickupName,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    offRouteKm: roundKm(booking.offRouteKm),
    detourDistanceKm: roundKm(booking.detourDistanceKm),
    detourDurationMin: booking.detourDurationMin,
    fareShare: booking.fareShare,
    seatCost: round2(booking.seatCost),
    detourCost: round2(booking.detourCost),
    platformFee: round2(booking.platformFee),
    totalPrice: round2(booking.totalPrice),
    pickupPin: booking.pickupPin,
    createdAt: booking.createdAt.toISOString(),
    isPast: isTripPast(arrivalTime(booking.rideOffer, booking.detourDurationMin)),
    ride: {
      ...toRideCore(booking.rideOffer),
      estimatedArrivalTime: arrivalTime(booking.rideOffer, booking.detourDurationMin),
      driver: toDriverSummary(booking.rideOffer.driver),
    },
  };
}

export function toTransactionDTO(tx: Transaction): TransactionDTO {
  return {
    id: tx.id,
    bookingId: tx.bookingId,
    amount: round2(tx.amount),
    type: asTransactionType(tx.type),
    description: tx.description,
    createdAt: tx.createdAt.toISOString(),
  };
}
