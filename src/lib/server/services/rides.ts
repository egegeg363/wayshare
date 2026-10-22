import "server-only";

import type { User } from "@/generated/prisma/client";
import type {
  CreateRideRequestSchema,
  DriverRideDTO,
  RideSearchQuery,
  RideSearchResponse,
  RideSearchResultDTO,
} from "@/lib/contracts";
import { checkEligibility, computeDetour, encodePolyline, haversineKm, roundKm, routeShare, type LatLng } from "@/lib/geo";
import { quotePrice, round2 } from "@/lib/pricing";
import type { z } from "zod";
import { prisma, withTransaction, type Tx } from "../db";
import { getRoute } from "../geo-services";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { arrivalTime, rideRoute, toDriverRide, toDriverSummary, toRideCore } from "../serializers";

/** A ride "goes your way" when it ends within this distance of your destination. */
const DESTINATION_MATCH_KM = 40;
/** …and starts within this distance of your origin (or passes your pickup, see below). */
const ORIGIN_MATCH_KM = 40;
/**
 * Rides whose route passes up to this much further from the pickup than the driver's radius
 * are still returned (flagged out-of-range) so passengers see near misses; beyond that is noise.
 */
const NEAR_MISS_SLACK_KM = 30;

function point(lat?: number, lng?: number): LatLng | null {
  return lat !== undefined && lng !== undefined ? { lat, lng } : null;
}

/** [start, end) of the searched calendar day, interpreted in the searcher's time zone. */
function dayWindow(date: string, tzOffsetMin = 0): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) + tzOffsetMin * 60_000;
  return { start: new Date(start), end: new Date(start + 24 * 60 * 60_000) };
}

export async function searchRides(
  query: RideSearchQuery,
  actingUserId: string | null,
): Promise<RideSearchResponse> {
  const now = new Date();
  const window = query.date ? dayWindow(query.date, query.tzOffset) : null;
  const rides = await prisma.rideOffer.findMany({
    where: {
      status: "OPEN",
      departureTime: {
        gte: window && window.start > now ? window.start : now,
        ...(window ? { lt: window.end } : {}),
      },
    },
    include: { driver: true },
    orderBy: { departureTime: "asc" },
    take: 200,
  });

  // Rides the searcher already holds a seat on — or was declined from — are flagged, not offered again.
  const history = actingUserId
    ? await prisma.booking.findMany({
        where: {
          passengerId: actingUserId,
          status: { in: ["CONFIRMED_IN_ESCROW", "DECLINED"] },
          rideOfferId: { in: rides.map((r) => r.id) },
        },
        select: { rideOfferId: true, status: true },
      })
    : [];
  const booked = new Set(history.filter((b) => b.status === "CONFIRMED_IN_ESCROW").map((b) => b.rideOfferId));
  const declined = new Set(history.filter((b) => b.status === "DECLINED").map((b) => b.rideOfferId));

  const origin = point(query.originLat, query.originLng);
  const destination = point(query.destLat, query.destLng);
  const explicitPickup = point(query.pickupLat, query.pickupLng);
  const pickup = explicitPickup ?? origin;
  const pickupName = explicitPickup ? (query.pickupName ?? "Your pickup") : "Your origin";

  const results: RideSearchResultDTO[] = [];
  for (const ride of rides) {
    const a = { lat: ride.originLat, lng: ride.originLng };
    const b = { lat: ride.destLat, lng: ride.destLng };
    if (destination && haversineKm(destination, b) > DESTINATION_MATCH_KM) continue;

    const route = rideRoute(ride);
    const detour = pickup
      ? computeDetour(route, pickup)
      : { offRouteKm: 0, detourDistanceKm: 0, detourDurationMin: 0 };
    if (pickup) {
      const startsNearby = origin ? haversineKm(origin, a) <= ORIGIN_MATCH_KM : false;
      const nearMiss = detour.offRouteKm <= ride.remainingDetourKm + NEAR_MISS_SLACK_KM;
      if (!startsNearby && !nearMiss) continue;
    }

    const eligibility = checkEligibility(ride, detour.offRouteKm, query.seats);
    const isOwnRide = ride.driverId === actingUserId;
    const ineligibleReason = isOwnRide
      ? "OWN_RIDE"
      : booked.has(ride.id)
        ? "ALREADY_BOOKED"
        : declined.has(ride.id)
          ? "DECLINED_BY_DRIVER"
          : eligibility.reason;
    results.push({
      ...toRideCore(ride),
      driver: toDriverSummary(ride.driver),
      estimatedArrivalTime: arrivalTime(ride, detour.detourDurationMin),
      isOwnRide,
      pickup: pickup ? { name: pickupName, lat: pickup.lat, lng: pickup.lng } : null,
      offRouteKm: detour.offRouteKm,
      detourDistanceKm: detour.detourDistanceKm,
      detourDurationMin: detour.detourDurationMin,
      isWithinDetourRadius: eligibility.isWithinDetourRadius,
      hasEnoughSeats: eligibility.hasEnoughSeats,
      isEligible: ineligibleReason === null,
      ineligibleReason,
      priceBreakdown: quotePrice({
        pricePerSeat: ride.pricePerSeat,
        seats: query.seats,
        routeShare: pickup ? routeShare(route, pickup) : 1,
        detourDistanceKm: detour.detourDistanceKm,
        detourPricePerKm: ride.detourPricePerKm,
      }),
    });
  }

  // Bookable rides first (soonest departure first), then near misses by how close they are.
  results.sort((x, y) => {
    if (x.isEligible !== y.isEligible) return x.isEligible ? -1 : 1;
    if (!x.isEligible && x.detourDistanceKm !== y.detourDistanceKm) {
      return x.offRouteKm - y.offRouteKm;
    }
    return Date.parse(x.departureTime) - Date.parse(y.departureTime);
  });

  return {
    rides: results,
    meta: {
      total: results.length,
      eligible: results.filter((r) => r.isEligible).length,
      outOfRange: results.filter((r) => r.ineligibleReason === "DETOUR_EXCEEDED").length,
      seats: query.seats,
    },
  };
}

export async function createRide(
  driver: User,
  input: z.output<typeof CreateRideRequestSchema>,
): Promise<{ ride: DriverRideDTO; routeSource: "osrm" | "estimate" }> {
  const vehicleModel = input.vehicleModel ?? driver.vehicleModel;
  const vehiclePlate = input.vehiclePlate ?? driver.vehiclePlate;
  if (!vehicleModel || !vehiclePlate) {
    throw badRequest("Add your car's model and plate before offering a ride.", "VEHICLE_REQUIRED");
  }

  // Network work happens before the transaction so no lock is held while waiting on OSRM.
  const route = await getRoute([input.origin, input.destination]);

  const ride = await withTransaction(async (tx) => {
    if (vehicleModel !== driver.vehicleModel || vehiclePlate !== driver.vehiclePlate) {
      await tx.user.update({ where: { id: driver.id }, data: { vehicleModel, vehiclePlate } });
    }
    return tx.rideOffer.create({
      data: {
        driverId: driver.id,
        originName: input.origin.name,
        originLat: input.origin.lat,
        originLng: input.origin.lng,
        destName: input.destination.name,
        destLat: input.destination.lat,
        destLng: input.destination.lng,
        departureTime: new Date(input.departureTime),
        baseDistanceKm: route.distanceKm,
        baseDurationMin: route.durationMin,
        routeGeometry: encodePolyline(route.geometry.map(([lat, lng]) => ({ lat, lng }))),
        totalSeats: input.totalSeats,
        availableSeats: input.totalSeats,
        pricePerSeat: round2(input.pricePerSeat),
        maxDetourKm: roundKm(input.maxDetourKm),
        remainingDetourKm: roundKm(input.maxDetourKm),
        detourPricePerKm: round2(input.detourPricePerKm),
        notes: input.notes || null,
        status: "OPEN",
      },
      include: { bookings: { include: { passenger: true } } },
    });
  });

  return { ride: toDriverRide(ride), routeSource: route.source };
}

async function loadOwnRide(tx: Tx, driver: User, rideId: string) {
  const ride = await tx.rideOffer.findUnique({ where: { id: rideId }, include: { bookings: true } });
  if (!ride) throw notFound("Ride not found.");
  if (ride.driverId !== driver.id) throw forbidden("Only the driver can manage this ride.", "NOT_RIDE_DRIVER");
  return ride;
}

/** Driver cancels the whole trip: every passenger still in escrow is refunded in full. */
export async function cancelRide(driver: User, rideId: string) {
  return withTransaction(async (tx) => {
    const ride = await loadOwnRide(tx, driver, rideId);
    if (ride.status === "CANCELLED" || ride.status === "COMPLETED") {
      throw conflict(`This ride is already ${ride.status.toLowerCase()}.`, "RIDE_CLOSED");
    }
    if (ride.bookings.some((b) => b.status === "PICKED_UP_PAID")) {
      throw conflict(
        "Passengers are already on board — mark the trip completed instead of cancelling it.",
        "RIDE_UNDERWAY",
      );
    }

    let refundedAmount = 0;
    const toRefund = ride.bookings.filter((b) => b.status === "CONFIRMED_IN_ESCROW");
    for (const booking of toRefund) {
      const passenger = await tx.user.findUniqueOrThrow({ where: { id: booking.passengerId } });
      await tx.user.update({
        where: { id: passenger.id },
        data: { walletBalance: round2(passenger.walletBalance + booking.totalPrice) },
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
      await tx.transaction.create({
        data: {
          userId: passenger.id,
          bookingId: booking.id,
          amount: round2(booking.totalPrice),
          type: "REFUND",
          description: `${ride.originName} → ${ride.destName} · trip cancelled by driver`,
        },
      });
      refundedAmount = round2(refundedAmount + booking.totalPrice);
    }

    await tx.rideOffer.update({
      where: { id: ride.id },
      data: { status: "CANCELLED", availableSeats: ride.totalSeats, remainingDetourKm: ride.maxDetourKm },
    });
    return { rideId: ride.id, status: "CANCELLED" as const, refundedBookings: toRefund.length, refundedAmount };
  });
}

/** Driver closes a finished trip once every passenger has been picked up (or cancelled). */
export async function completeRide(driver: User, rideId: string) {
  return withTransaction(async (tx) => {
    const ride = await loadOwnRide(tx, driver, rideId);
    if (ride.status === "CANCELLED" || ride.status === "COMPLETED") {
      throw conflict(`This ride is already ${ride.status.toLowerCase()}.`, "RIDE_CLOSED");
    }
    const waiting = ride.bookings.filter((b) => b.status === "CONFIRMED_IN_ESCROW").length;
    if (waiting > 0) {
      throw conflict(
        `${waiting} passenger${waiting === 1 ? " hasn't" : "s haven't"} been checked in yet. Verify their PINs first.`,
        "PASSENGERS_WAITING",
      );
    }
    await tx.rideOffer.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });
    return { rideId: ride.id, status: "COMPLETED" as const, refundedBookings: 0, refundedAmount: 0 };
  });
}
