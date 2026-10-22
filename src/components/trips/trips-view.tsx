"use client";

import Link from "next/link";
import { CarFront, ChevronDown, History, RefreshCw, Search, Ticket } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import type { DriverRideDTO, PassengerBookingDTO, TripsResponse } from "@/lib/contracts";
import { useResource } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/primitives";
import { DriverRideCard } from "./driver-ride-card";
import { PassengerTripCard } from "./passenger-trip-card";
import { WalletPanel } from "./wallet-panel";

export function TripsView() {
  const { currentUser, dataVersion, refresh } = useApp();
  const trips = useResource(currentUser ? `trips:${currentUser.id}:${dataVersion}` : null, (signal) =>
    api.trips(signal),
  );
  // Only show data that belongs to the active account (avoid flashing the previous user's trips).
  const data = trips.data && trips.data.user.id === currentUser?.id ? trips.data : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">My Trips &amp; Wallet</h1>
        <p className="mt-1 text-[15px] text-muted">
          Boarding PINs, passenger manifests and every euro in or out of escrow.
        </p>
      </div>

      {trips.error && !data ? (
        <EmptyState
          icon={<RefreshCw className="size-5" />}
          title="Couldn't load your trips"
          description={trips.error.message}
          action={
            <Button variant="secondary" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
          <Skeleton className="h-[520px] rounded-2xl" />
        </div>
      ) : (
        <TripsContent key={data.user.id} data={data} />
      )}
    </div>
  );
}

/** Cancelled, declined and completed trips — and trips that have already arrived — are history. */
function isHistoryBooking(booking: PassengerBookingDTO) {
  return booking.isPast || booking.status === "CANCELLED" || booking.status === "DECLINED";
}
function isHistoryRide(ride: DriverRideDTO) {
  return ride.isPast || ride.status === "CANCELLED" || ride.status === "COMPLETED";
}

function TripsContent({ data }: { data: TripsResponse }) {
  const [tab, setTab] = useState<"riding" | "driving" | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const bookings = data.bookings.filter((b) => !isHistoryBooking(b));
  const pastBookings = data.bookings.filter(isHistoryBooking);
  const rides = data.rides.filter((r) => !isHistoryRide(r));
  const pastRides = data.rides.filter(isHistoryRide);

  const defaultTab = rides.length > 0 && bookings.length === 0 ? "driving" : "riding";
  const current = tab ?? defaultTab;
  const history = current === "riding" ? pastBookings.length : pastRides.length;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
      <section aria-label="Trips" className="min-w-0">
        <Segmented
          label="Trip role"
          value={current}
          onChange={(value) => {
            setTab(value);
            setShowHistory(false);
          }}
          className="mb-4"
          options={[
            {
              value: "riding",
              icon: <Ticket className="size-4" />,
              label: (
                <>
                  As passenger <Count n={bookings.length} />
                </>
              ),
            },
            {
              value: "driving",
              icon: <CarFront className="size-4" />,
              label: (
                <>
                  As driver <Count n={rides.length} />
                </>
              ),
            },
          ]}
        />

        {current === "riding" ? (
          bookings.length === 0 ? (
            <EmptyState
              icon={<Ticket className="size-5" />}
              title="No upcoming trips"
              description="Find a driver heading your way — seats you book show up here with their boarding PIN."
              action={
                <Link href="/" className={buttonClasses("primary")}>
                  <Search className="size-4" />
                  Find a ride
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
              {bookings.map((booking, index) => (
                <PassengerTripCard key={booking.id} booking={booking} defaultMapOpen={index === 0} />
              ))}
            </div>
          )
        ) : rides.length === 0 ? (
          <EmptyState
            icon={<CarFront className="size-5" />}
            title="No upcoming rides"
            description="Publish a trip you're already making and set how far you'll detour for pickups."
            action={
              <Link href="/offer" className={buttonClasses("primary")}>
                <CarFront className="size-4" />
                Offer a ride
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {rides.map((ride, index) => (
              <DriverRideCard key={ride.id} ride={ride} defaultMapOpen={index === 0} />
            ))}
          </div>
        )}

        {history > 0 ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-black/[.04] hover:text-ink"
            >
              <History className="size-4" />
              {showHistory ? "Hide" : "Show"} past &amp; cancelled {current === "riding" ? "trips" : "rides"} ({history})
              <ChevronDown className={cn("size-3.5 transition-transform", showHistory && "rotate-180")} />
            </button>
            {showHistory ? (
              <div className="mt-3 space-y-4 opacity-80">
                {current === "riding"
                  ? pastBookings.map((booking) => (
                      <PassengerTripCard key={booking.id} booking={booking} defaultMapOpen={false} />
                    ))
                  : pastRides.map((ride) => <DriverRideCard key={ride.id} ride={ride} defaultMapOpen={false} />)}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <aside aria-label="Wallet" className="lg:sticky lg:top-24">
        <WalletPanel wallet={data.wallet} />
      </aside>
    </div>
  );
}

function Count({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="tabular ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] leading-5 font-semibold text-white">
      {n}
    </span>
  );
}
