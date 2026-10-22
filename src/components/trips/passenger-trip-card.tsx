"use client";

import { KeyRound, MapPin, Star } from "lucide-react";
import { useState } from "react";
import { api, toApiError } from "@/lib/api-client";
import type { PassengerBookingDTO } from "@/lib/contracts";
import { formatCoords } from "@/lib/geo";
import { formatEur, formatKm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { RouteMap } from "@/components/map/route-map-client";
import { detourLeg } from "@/components/map/scene";
import { Button } from "@/components/ui/button";
import { Avatar, Card } from "@/components/ui/primitives";
import { BookingStatusBadge, MapToggle, TripTimeline } from "./shared";

export function PassengerTripCard({ booking, defaultMapOpen }: { booking: PassengerBookingDTO; defaultMapOpen: boolean }) {
  const { refresh, notify } = useApp();
  const [mapOpen, setMapOpen] = useState(defaultMapOpen);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { ride } = booking;
  const active = booking.status === "CONFIRMED_IN_ESCROW";
  const driverFirstName = ride.driver.name.split(" ")[0];

  async function cancel() {
    setCancelling(true);
    try {
      const result = await api.cancelBooking(booking.id);
      notify({
        title: "Booking cancelled",
        description: `${formatEur(result.refund)} refunded to your wallet.`,
      });
      refresh();
    } catch (error) {
      notify({ tone: "error", title: "Couldn't cancel", description: toApiError(error).message });
      setCancelling(false);
      setConfirming(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", !active && "bg-surface/70")}>
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <BookingStatusBadge status={booking.status} />
          <MapToggle open={mapOpen} onToggle={() => setMapOpen((v) => !v)} label="Route & pickup" />
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-5">
            <TripTimeline
              departure={ride.departureTime}
              arrival={ride.estimatedArrivalTime}
              originName={ride.originName}
              destName={ride.destName}
              pickup={
                <div className="flex min-w-0 items-start gap-1.5 text-[13px]">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">Pickup · {booking.pickupName}</p>
                    <p className="truncate text-xs text-muted">
                      {formatCoords({ lat: booking.pickupLat, lng: booking.pickupLng })}
                      {booking.offRouteKm >= 0.3 ? ` · ${formatKm(booking.offRouteKm)} off route` : " · on route"}
                    </p>
                  </div>
                </div>
              }
            />

            <div className="flex items-center gap-3">
              <Avatar src={ride.driver.avatarUrl} name={ride.driver.name} size={36} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {ride.driver.name}
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted">
                    <Star className="size-3 fill-ink text-ink" />
                    {ride.driver.rating.toFixed(1)}
                  </span>
                </p>
                <p className="truncate text-xs text-muted">
                  {ride.driver.vehicleModel}
                  {ride.driver.vehiclePlate ? (
                    <span className="ml-1.5 rounded border border-line px-1 font-mono text-[11px] text-ink-soft">
                      {ride.driver.vehiclePlate}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
              <div>
                <dt className="text-muted">Seats</dt>
                <dd className="tabular font-medium">
                  {booking.seatsBooked} × {formatEur(booking.seatCost / booking.seatsBooked)}
                </dd>
                {booking.fareShare < 1 ? (
                  <dd className="text-xs text-accent-strong">
                    {Math.round(booking.fareShare * 100)}% of {formatEur(ride.pricePerSeat)}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-muted">Detour fee</dt>
                <dd className="tabular font-medium">{booking.detourCost > 0 ? formatEur(booking.detourCost) : "Free"}</dd>
              </div>
              <div>
                <dt className="text-muted">Platform fee</dt>
                <dd className="tabular font-medium">{formatEur(booking.platformFee)}</dd>
              </div>
              <div>
                <dt className="text-muted">
                  {booking.status === "CANCELLED" || booking.status === "DECLINED" ? "Refunded" : active ? "In escrow" : "Paid"}
                </dt>
                <dd className="tabular font-semibold">{formatEur(booking.totalPrice)}</dd>
              </div>
            </dl>
          </div>

          {active ? (
            <div className="flex flex-col self-start rounded-2xl border border-accent-line bg-accent-soft/70 p-4 md:w-60">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-accent-strong uppercase">
                  <KeyRound className="size-3.5" />
                  Boarding PIN
                </p>
                <div
                  className="mt-3 flex gap-1.5"
                  aria-label={`Boarding PIN ${booking.pickupPin.split("").join(" ")}`}
                >
                  {booking.pickupPin.split("").map((digit, index) => (
                    <span
                      key={index}
                      className="tabular flex h-12 flex-1 items-center justify-center rounded-xl bg-surface font-mono text-[22px] font-semibold text-ink shadow-card ring-1 ring-accent-line"
                    >
                      {digit}
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-accent-strong/90">
                Hand this to {driverFirstName} when you get in. Your payment is released from escrow only after they enter it.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {mapOpen ? <PassengerTripMap booking={booking} /> : null}

      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/60 px-5 py-3 sm:px-6">
          <p className="text-xs text-muted">Free cancellation until pickup · full refund to your wallet.</p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={cancelling}>
                Keep seat
              </Button>
              <Button variant="danger" size="sm" onClick={cancel} loading={cancelling}>
                Cancel & refund {formatEur(booking.totalPrice)}
              </Button>
            </div>
          ) : (
            <Button variant="outline-danger" size="sm" onClick={() => setConfirming(true)}>
              Cancel booking
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function PassengerTripMap({ booking }: { booking: PassengerBookingDTO }) {
  const { ride } = booking;
  const origin = { lat: ride.originLat, lng: ride.originLng };
  const destination = { lat: ride.destLat, lng: ride.destLng };
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const route = ride.routeGeometry;
  return (
    <RouteMap
      className="h-80 border-t border-line"
      scrollWheelZoom={false}
      ariaLabel={`Route ${ride.originName} to ${ride.destName} with your pickup`}
      markers={[
        { id: "o", position: origin, kind: "origin", label: ride.originName },
        { id: "d", position: destination, kind: "destination", label: ride.destName },
        { id: "p", position: pickup, kind: "pickup", label: `Pickup · ${booking.pickupName}`, labelTone: "accent" },
      ]}
      paths={[
        ...(route ? [{ id: "route", positions: route, variant: "route" as const }] : []),
        ...(booking.offRouteKm > 0 ? detourLeg("leg", pickup, route, true) : []),
      ]}
      fitKey={booking.id}
      fitTo={[origin, destination, pickup]}
    />
  );
}
