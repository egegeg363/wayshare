import "server-only";

import type { User } from "@/generated/prisma/client";
import type { TripsResponse } from "@/lib/contracts";
import { round2 } from "@/lib/pricing";
import { prisma, withTransaction } from "../db";
import {
  toDriverRide,
  toPassengerBooking,
  toTransactionDTO,
  toUserDTO,
} from "../serializers";

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }] });
  return users;
}

/** Account the app opens with: the first passenger (no vehicle), else anyone. */
export function pickDefaultUser(users: User[]): User | null {
  return users.find((u) => !u.vehicleModel) ?? users[0] ?? null;
}

export async function topUpWallet(user: User, amount: number) {
  return withTransaction(async (tx) => {
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { walletBalance: round2(fresh.walletBalance + amount) },
    });
    const transaction = await tx.transaction.create({
      data: { userId: user.id, amount: round2(amount), type: "TOP_UP", description: "Test top-up" },
    });
    return { user: toUserDTO(updated), transaction: toTransactionDTO(transaction) };
  });
}

const statusRank = { CONFIRMED_IN_ESCROW: 0, PICKED_UP_PAID: 1, CANCELLED: 2, DECLINED: 2 } as const;
const rideRank = { OPEN: 0, FULL: 0, COMPLETED: 1, CANCELLED: 2 } as const;

/** Everything the "My Trips & Wallet" dashboard needs, for one user, in one round trip. */
export async function getTrips(userId: string): Promise<TripsResponse> {
  const [user, bookings, rides, transactions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.booking.findMany({
      where: { passengerId: userId },
      include: { rideOffer: { include: { driver: true } } },
    }),
    prisma.rideOffer.findMany({
      where: { driverId: userId },
      include: { bookings: { include: { passenger: true }, orderBy: { createdAt: "asc" } } },
    }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  // Active items first, soonest departure first; history after, most recent first.
  bookings.sort((a, b) => {
    const rank =
      statusRank[a.status as keyof typeof statusRank] - statusRank[b.status as keyof typeof statusRank];
    if (rank !== 0) return rank;
    const dir = a.status === "CONFIRMED_IN_ESCROW" ? 1 : -1;
    return dir * (a.rideOffer.departureTime.getTime() - b.rideOffer.departureTime.getTime());
  });
  rides.sort((a, b) => {
    const rank = rideRank[a.status as keyof typeof rideRank] - rideRank[b.status as keyof typeof rideRank];
    if (rank !== 0) return rank;
    const dir = a.status === "OPEN" || a.status === "FULL" ? 1 : -1;
    return dir * (a.departureTime.getTime() - b.departureTime.getTime());
  });

  const heldInEscrow = round2(
    bookings
      .filter((b) => b.status === "CONFIRMED_IN_ESCROW")
      .reduce((sum, b) => sum + b.totalPrice, 0),
  );
  const pendingPayouts = round2(
    rides
      .flatMap((r) => r.bookings)
      .filter((b) => b.status === "CONFIRMED_IN_ESCROW")
      .reduce((sum, b) => sum + b.seatCost + b.detourCost, 0),
  );
  const totalPaidOut = round2(
    transactions.filter((t) => t.type === "DRIVER_PAYOUT").reduce((sum, t) => sum + t.amount, 0),
  );

  return {
    user: toUserDTO(user),
    bookings: bookings.map(toPassengerBooking),
    rides: rides.map(toDriverRide),
    wallet: {
      balance: round2(user.walletBalance),
      heldInEscrow,
      pendingPayouts,
      totalPaidOut,
      transactions: transactions.map(toTransactionDTO),
    },
  };
}
