import "server-only";

import { randomInt, timingSafeEqual } from "node:crypto";
import type { Booking, RideOffer, User } from "@/generated/prisma/client";
import type { CreateBookingRequest } from "@/lib/contracts";
import { checkEligibility, computeDetour, roundKm, routeShare } from "@/lib/geo";
import { formatEur } from "@/lib/format";
import { quotePrice, round2 } from "@/lib/pricing";
import { withTransaction, type Tx } from "../db";
import { HttpError, conflict, forbidden, notFound } from "../http";
import { chargeCard } from "../payments";
import { assertPinAttemptAllowed, clearPinFailures, recordPinFailure } from "../pin-guard";
import { rideRoute, toManifestEntry, toPassengerBooking } from "../serializers";

const BALANCE_EPSILON = 1e-9;

function generatePickupPin(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

function pinsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Only bookings still waiting in escrow can be paid out, cancelled or declined. */
function assertInEscrow(booking: Booking & { passenger?: User }) {
  if (booking.status === "CONFIRMED_IN_ESCROW") return;
  const who = booking.passenger?.name ?? "This passenger";
  switch (booking.status) {
    case "PICKED_UP_PAID":
      throw conflict(`${who} is already checked in and paid out.`, "ALREADY_PAID");
    case "DECLINED":
      throw conflict(`${who} was already declined.`, "ALREADY_DECLINED");
    default:
      throw conflict("This booking is already cancelled.", "ALREADY_CANCELLED");
  }
}

/**
 * Book seats atomically. Detour, eligibility and fare are recomputed server-side from
 * the stored ride — the client's quote is never trusted. Funds move wallet → escrow.
 */
export async function createBooking(passenger: User, input: CreateBookingRequest) {
  return withTransaction(async (tx) => {
    const ride = await tx.rideOffer.findUnique({ where: { id: input.rideOfferId }, include: { driver: true } });
    if (!ride) throw notFound("This ride no longer exists.");
    if (ride.driverId === passenger.id) {
      throw forbidden("You can't book a seat on your own ride.", "OWN_RIDE");
    }
    if (ride.departureTime.getTime() <= Date.now()) {
      throw conflict("This ride has already departed.", "RIDE_DEPARTED");
    }
    const previous = await tx.booking.findMany({
      where: { rideOfferId: ride.id, passengerId: passenger.id, status: { in: ["CONFIRMED_IN_ESCROW", "DECLINED"] } },
      select: { status: true },
    });
    if (previous.some((b) => b.status === "DECLINED")) {
      throw conflict(
        `${ride.driver.name.split(" ")[0]} declined your booking on this ride, so it can't be booked again.`,
        "DECLINED_BY_DRIVER",
      );
    }
    if (previous.length > 0) {
      throw conflict("You already hold a seat on this ride. Cancel it in My Trips to rebook.", "ALREADY_BOOKED");
    }

    // 1–2. Ride must be OPEN, have the seats, and the pickup must lie within the driver's
    //      remaining pickup radius around the route.
    const route = rideRoute(ride);
    const detour = computeDetour(route, input.pickup);
    const eligibility = checkEligibility(ride, detour.offRouteKm, input.seats);
    if (!eligibility.isOpen) {
      throw conflict("This ride is no longer accepting bookings.", "RIDE_NOT_OPEN");
    }
    if (!eligibility.hasEnoughSeats) {
      throw conflict(`Only ${plural(ride.availableSeats, "seat")} left on this ride.`, "NOT_ENOUGH_SEATS");
    }
    if (!eligibility.isWithinDetourRadius) {
      throw conflict(
        `Your pickup is ${detour.offRouteKm} km from the route, but the driver only goes ${roundKm(ride.remainingDetourKm)} km off it.`,
        "DETOUR_EXCEEDED",
      );
    }

    // Distance-based fare: the passenger pays for the share of the route they ride.
    const price = quotePrice({
      pricePerSeat: ride.pricePerSeat,
      seats: input.seats,
      routeShare: routeShare(route, input.pickup),
      detourDistanceKm: detour.detourDistanceKm,
      detourPricePerKm: ride.detourPricePerKm,
    });

    // 3. Payment. A card payment is captured into the wallet first, so the ledger always
    //    reconciles: wallet balance = Σ transactions.
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: passenger.id } });
    let balance = fresh.walletBalance;
    if (input.payment.method === "CARD") {
      const charge = chargeCard(input.payment.card);
      balance = round2(balance + price.totalPrice);
      await tx.transaction.create({
        data: {
          userId: passenger.id,
          amount: price.totalPrice,
          type: "TOP_UP",
          description: `Card payment · ${charge.brand} •••• ${charge.last4}`,
        },
      });
    } else if (balance + BALANCE_EPSILON < price.totalPrice) {
      throw new HttpError(
        402,
        "INSUFFICIENT_FUNDS",
        `Your wallet has ${formatEur(balance)} but this booking costs ${formatEur(price.totalPrice)}. Top up or pay by card.`,
      );
    }

    // 4. Debit the wallet into escrow.
    balance = round2(balance - price.totalPrice);
    await tx.user.update({ where: { id: passenger.id }, data: { walletBalance: balance } });

    // 5. Consume capacity. The compare-and-swap guard makes this safe under concurrent
    //    bookings on databases with weaker isolation than SQLite (e.g. PostgreSQL).
    const availableSeats = ride.availableSeats - input.seats;
    const capacity = await tx.rideOffer.updateMany({
      where: {
        id: ride.id,
        status: "OPEN",
        availableSeats: ride.availableSeats,
        remainingDetourKm: ride.remainingDetourKm,
      },
      data: {
        availableSeats,
        remainingDetourKm: roundKm(Math.max(0, ride.remainingDetourKm - detour.offRouteKm)),
        status: availableSeats === 0 ? "FULL" : "OPEN",
      },
    });
    if (capacity.count !== 1) {
      throw conflict("Someone else just booked this ride. Refresh and try again.", "CONCURRENT_UPDATE");
    }

    // 6. Booking with its boarding PIN, plus the escrow ledger entry.
    const booking = await tx.booking.create({
      data: {
        rideOfferId: ride.id,
        passengerId: passenger.id,
        seatsBooked: input.seats,
        pickupName: input.pickup.name,
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        offRouteKm: detour.offRouteKm,
        detourDistanceKm: detour.detourDistanceKm,
        detourDurationMin: detour.detourDurationMin,
        fareShare: price.fareShare,
        seatCost: price.seatCost,
        detourCost: price.detourCost,
        platformFee: price.platformFee,
        totalPrice: price.totalPrice,
        pickupPin: generatePickupPin(),
        status: "CONFIRMED_IN_ESCROW",
      },
      include: { rideOffer: { include: { driver: true } } },
    });
    await tx.transaction.create({
      data: {
        userId: passenger.id,
        bookingId: booking.id,
        amount: -price.totalPrice,
        type: "ESCROW_HOLD",
        description: `${ride.originName} → ${ride.destName} · ${plural(input.seats, "seat")}`,
      },
    });

    return { booking: toPassengerBooking(booking), walletBalance: balance };
  });
}

/** Driver enters the passenger's PIN at pickup → escrow is released to the driver. */
export async function verifyPickupPin(driver: User, bookingId: string, pin: string) {
  assertPinAttemptAllowed(bookingId);
  return withTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { rideOffer: true, passenger: true },
    });
    if (!booking) throw notFound("Booking not found.");
    if (booking.rideOffer.driverId !== driver.id) {
      throw forbidden("Only this ride's driver can verify pickup PINs.", "NOT_RIDE_DRIVER");
    }
    assertInEscrow(booking);
    if (!pinsMatch(booking.pickupPin, pin)) {
      const left = recordPinFailure(bookingId);
      throw new HttpError(
        400,
        "INVALID_PIN",
        left > 0
          ? `That PIN doesn't match. ${plural(left, "attempt")} left.`
          : "That PIN doesn't match. PIN entry is locked for 10 minutes.",
      );
    }

    const released = await tx.booking.updateMany({
      where: { id: booking.id, status: "CONFIRMED_IN_ESCROW" },
      data: { status: "PICKED_UP_PAID" },
    });
    if (released.count !== 1) throw conflict("This booking just changed. Refresh and try again.", "CONCURRENT_UPDATE");

    const payout = round2(booking.seatCost + booking.detourCost);
    const freshDriver = await tx.user.findUniqueOrThrow({ where: { id: driver.id } });
    const walletBalance = round2(freshDriver.walletBalance + payout);
    await tx.user.update({ where: { id: driver.id }, data: { walletBalance } });
    await tx.transaction.create({
      data: {
        userId: driver.id,
        bookingId: booking.id,
        amount: payout,
        type: "DRIVER_PAYOUT",
        description: `${booking.passenger.name} · picked up at ${booking.pickupName}`,
      },
    });
    clearPinFailures(bookingId);

    return {
      booking: toManifestEntry({ ...booking, status: "PICKED_UP_PAID" }),
      payout,
      walletBalance,
    };
  });
}

/**
 * Take a booking out of escrow without a pickup: full refund to the passenger, and its
 * seats + detour budget go back to the ride (a FULL ride reopens for booking).
 */
async function releaseBooking(
  tx: Tx,
  booking: Booking & { rideOffer: RideOffer },
  status: "CANCELLED" | "DECLINED",
  ledgerNote: string,
) {
  const changed = await tx.booking.updateMany({
    where: { id: booking.id, status: "CONFIRMED_IN_ESCROW" },
    data: { status },
  });
  if (changed.count !== 1) throw conflict("This booking just changed. Refresh and try again.", "CONCURRENT_UPDATE");

  const ride = booking.rideOffer;
  const refund = round2(booking.totalPrice);
  const passenger = await tx.user.findUniqueOrThrow({ where: { id: booking.passengerId } });
  await tx.user.update({
    where: { id: passenger.id },
    data: { walletBalance: round2(passenger.walletBalance + refund) },
  });
  await tx.transaction.create({
    data: {
      userId: passenger.id,
      bookingId: booking.id,
      amount: refund,
      type: "REFUND",
      description: `${ride.originName} → ${ride.destName} · ${ledgerNote}`,
    },
  });

  let availableSeats = ride.availableSeats;
  if (ride.status === "OPEN" || ride.status === "FULL") {
    availableSeats = Math.min(ride.totalSeats, ride.availableSeats + booking.seatsBooked);
    await tx.rideOffer.update({
      where: { id: ride.id },
      data: {
        availableSeats,
        remainingDetourKm: roundKm(Math.min(ride.maxDetourKm, ride.remainingDetourKm + booking.offRouteKm)),
        status: "OPEN",
      },
    });
  }

  return { bookingId: booking.id, status, refund, availableSeats };
}

/** Passenger cancels their own booking before pickup. */
export async function cancelBooking(passenger: User, bookingId: string) {
  return withTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { rideOffer: true } });
    if (!booking) throw notFound("Booking not found.");
    if (booking.passengerId !== passenger.id) {
      throw forbidden("Only the passenger can cancel this booking — drivers decline passengers instead.", "NOT_YOUR_BOOKING");
    }
    assertInEscrow(booking);
    return releaseBooking(tx, booking, "CANCELLED", "you cancelled");
  });
}

/** Driver declines a passenger: they're refunded, the seat reopens, and they can't rebook this ride. */
export async function declineBooking(driver: User, bookingId: string) {
  return withTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { rideOffer: true, passenger: true },
    });
    if (!booking) throw notFound("Booking not found.");
    if (booking.rideOffer.driverId !== driver.id) {
      throw forbidden("Only this ride's driver can decline its passengers.", "NOT_RIDE_DRIVER");
    }
    assertInEscrow(booking);
    return releaseBooking(tx, booking, "DECLINED", "declined by driver");
  });
}
