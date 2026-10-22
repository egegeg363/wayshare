"use client";

import { BadgeCheck, ChevronDown, CircleSlash, Flag, MapPin, Star, UserX, Users, XCircle } from "lucide-react";
import { useState } from "react";
import { api, toApiError } from "@/lib/api-client";
import type { DriverRideDTO, ManifestEntryDTO } from "@/lib/contracts";
import { holdsSeat } from "@/lib/domain";
import { formatCoords } from "@/lib/geo";
import { formatEur, formatKm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { RouteMap, type MapMarker } from "@/components/map/route-map-client";
import { Button } from "@/components/ui/button";
import { PinInput } from "@/components/ui/pin-input";
import { Avatar, Card, EmptyState, Eyebrow, SeatIndicator } from "@/components/ui/primitives";
import { MapToggle, RideStatusBadge, TripTimeline } from "./shared";

export function DriverRideCard({ ride, defaultMapOpen }: { ride: DriverRideDTO; defaultMapOpen: boolean }) {
  const { refresh, notify } = useApp();
  const [mapOpen, setMapOpen] = useState(defaultMapOpen);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "complete" | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const live = ride.status === "OPEN" || ride.status === "FULL";
  const active = ride.manifest.filter((m) => holdsSeat(m.status));
  const waiting = ride.manifest.filter((m) => m.status === "CONFIRMED_IN_ESCROW").length;
  const bookedSeats = ride.totalSeats - ride.availableSeats;
  const usedDetour = Math.max(0, ride.maxDetourKm - ride.remainingDetourKm);
  const detourShare = ride.maxDetourKm > 0 ? (usedDetour / ride.maxDetourKm) * 100 : 0;
  // Cancelled and declined bookings are history: tucked away behind a toggle.
  const closed = ride.manifest.filter((m) => !holdsSeat(m.status));

  async function runAction(action: "cancel" | "complete") {
    setBusy(action);
    try {
      const result = action === "cancel" ? await api.cancelRide(ride.id) : await api.completeRide(ride.id);
      notify(
        action === "cancel"
          ? {
              title: "Ride cancelled",
              description:
                result.refundedBookings > 0
                  ? `${result.refundedBookings} passenger${result.refundedBookings === 1 ? "" : "s"} refunded ${formatEur(result.refundedAmount)}.`
                  : "No passengers were booked.",
            }
          : { title: "Trip completed", description: `${ride.originName} → ${ride.destName} is closed.` },
      );
      refresh();
    } catch (error) {
      notify({ tone: "error", title: "Action failed", description: toApiError(error).message });
      setBusy(null);
      setConfirmCancel(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", !live && "bg-surface/70")}>
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <RideStatusBadge status={ride.status} />
          <MapToggle open={mapOpen} onToggle={() => setMapOpen((v) => !v)} />
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <TripTimeline
            departure={ride.departureTime}
            arrival={ride.estimatedArrivalTime}
            originName={ride.originName}
            destName={ride.destName}
            pickup={
              <p className="text-xs text-muted">
                {formatKm(ride.baseDistanceKm)} · {formatEur(ride.pricePerSeat)}/seat
                {ride.detourPricePerKm > 0 ? ` · ${formatEur(ride.detourPricePerKm)}/detour km` : " · free detours"}
              </p>
            }
          />

          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">Seats</dt>
              <dd className="mt-1.5">
                <SeatIndicator total={ride.totalSeats} available={ride.availableSeats} />
                <p className="tabular mt-1 text-[13px] font-semibold">
                  {bookedSeats}/{ride.totalSeats} booked
                </p>
              </dd>
            </div>
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">Pickup radius</dt>
              <dd className="mt-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-accent-soft ring-1 ring-inset ring-accent-line/60">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${detourShare}%` }} />
                </div>
                <p className="tabular mt-1.5 text-[13px] font-semibold">
                  {ride.maxDetourKm === 0 ? "On-route only" : `${formatKm(ride.remainingDetourKm)} left`}
                </p>
                {ride.maxDetourKm > 0 ? (
                  <p className="tabular text-[11px] text-muted">of {formatKm(ride.maxDetourKm)}</p>
                ) : null}
              </dd>
            </div>
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">Earnings</dt>
              <dd className="mt-1.5">
                <p className="tabular text-[15px] font-semibold text-accent-strong">{formatEur(ride.earnings.paidOut)}</p>
                <p className="tabular text-[11px] text-muted">{formatEur(ride.earnings.inEscrow)} in escrow</p>
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <Eyebrow>Passenger manifest</Eyebrow>
            <span className="text-xs text-muted">
              {active.length} passenger{active.length === 1 ? "" : "s"}
            </span>
          </div>
          {active.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Users className="size-5" />}
              title="No passengers yet"
              description={live ? "Your ride is live in search — bookings appear here instantly." : undefined}
            />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {active.map((entry) => (
                <ManifestRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          {closed.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-black/[.04] hover:text-ink"
              >
                {showClosed ? "Hide" : "Show"} {closed.length} cancelled or declined booking{closed.length === 1 ? "" : "s"}
                <ChevronDown className={cn("size-3.5 transition-transform", showClosed && "rotate-180")} />
              </button>
              {showClosed ? (
                <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  {closed.map((entry) => (
                    <ManifestRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {mapOpen ? <DriverRideMap ride={ride} /> : null}

      {live ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/60 px-5 py-3 sm:px-6">
          <p className="text-xs text-muted">
            {waiting > 0
              ? `${waiting} passenger${waiting === 1 ? "" : "s"} still to check in with their PIN.`
              : active.length > 0
                ? "Everyone is checked in — close the trip when you arrive."
                : "Cancel anytime before passengers board."}
          </p>
          <div className="flex items-center gap-2">
            {confirmCancel ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)} disabled={busy !== null}>
                  Keep ride
                </Button>
                <Button variant="danger" size="sm" loading={busy === "cancel"} onClick={() => runAction("cancel")}>
                  Cancel ride{waiting > 0 ? ` & refund ${waiting}` : ""}
                </Button>
              </>
            ) : (
              <>
                {ride.manifest.every((m) => m.status !== "PICKED_UP_PAID") ? (
                  <Button variant="outline-danger" size="sm" onClick={() => setConfirmCancel(true)}>
                    <XCircle className="size-3.5" />
                    Cancel ride
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === "complete"}
                  disabled={waiting > 0}
                  title={waiting > 0 ? "Verify every passenger's PIN first" : undefined}
                  onClick={() => runAction("complete")}
                >
                  <Flag className="size-3.5" />
                  Mark completed
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ManifestRow({ entry }: { entry: ManifestEntryDTO }) {
  const { refresh, notify } = useApp();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"verify" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const firstName = entry.passenger.name.split(" ")[0];
  const closed = entry.status === "CANCELLED" || entry.status === "DECLINED";
  const farePct = Math.round(entry.fareShare * 100);

  async function claim(code: string) {
    if (code.length !== 4 || busy) return;
    setBusy("verify");
    setError(null);
    try {
      const result = await api.verifyPin(entry.id, code);
      notify({
        title: `${firstName} is on board`,
        description: `${formatEur(result.payout)} released from escrow to your wallet.`,
      });
      refresh();
    } catch (err) {
      setError(toApiError(err).message);
      setPin("");
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    try {
      const result = await api.declineBooking(entry.id);
      notify({
        title: `${firstName} declined`,
        description: `Refunded in full · ${result.availableSeats} seat${result.availableSeats === 1 ? "" : "s"} open for booking again.`,
      });
      refresh();
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(null);
      setConfirmDecline(false);
    }
  }

  return (
    <li className={cn("grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", closed && "opacity-60")}>
      <div className="flex min-w-0 items-start gap-3">
        <Avatar src={entry.passenger.avatarUrl} name={entry.passenger.name} size={38} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
            {entry.passenger.name}
            <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted">
              <Star className="size-3 fill-ink text-ink" />
              {entry.passenger.rating.toFixed(1)}
            </span>
            <span className="text-xs font-normal text-muted">
              · {entry.seatsBooked} seat{entry.seatsBooked === 1 ? "" : "s"}
            </span>
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[13px] text-ink-soft">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="font-medium">{entry.pickupName}</span>
              <span className="block font-mono text-[11px] text-muted">
                {formatCoords({ lat: entry.pickupLat, lng: entry.pickupLng }, 5)}
              </span>
              <span className="block text-xs text-muted">
                {entry.offRouteKm >= 0.3
                  ? `${formatKm(entry.offRouteKm)} off route · +${formatKm(entry.detourDistanceKm)} / +${entry.detourDurationMin} min detour`
                  : "On your route — no detour"}
                {entry.fareShare < 1 ? ` · pays ${farePct}% of the seat price` : ""}
              </span>
            </span>
          </p>
        </div>
      </div>

      <div className="sm:text-right">
        {entry.status === "CONFIRMED_IN_ESCROW" ? (
          confirmDecline ? (
            <div className="flex flex-col gap-2 sm:items-end">
              <p className="text-[13px] text-ink-soft sm:max-w-72">
                Decline {firstName}? They&apos;re refunded in full, can&apos;t rebook this ride, and the seat opens up
                for someone else.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDecline(false)} disabled={busy !== null}>
                  Keep {firstName}
                </Button>
                <Button variant="danger" size="sm" loading={busy === "decline"} onClick={decline}>
                  <UserX className="size-3.5" />
                  Decline passenger
                </Button>
              </div>
              {error ? (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <form
              className="flex flex-col gap-2 sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void claim(pin);
              }}
            >
              <p className="text-xs text-muted">Enter Passenger PIN to Claim Payout</p>
              <div className="flex items-center gap-2">
                <PinInput
                  value={pin}
                  onChange={(value) => {
                    setPin(value);
                    if (error) setError(null);
                  }}
                  onComplete={claim}
                  disabled={busy !== null}
                  invalid={Boolean(error)}
                  label={`PIN from ${entry.passenger.name}`}
                />
                <Button type="submit" variant="accent" loading={busy === "verify"} disabled={pin.length !== 4} className="h-10">
                  Claim {formatEur(entry.payout)}
                </Button>
              </div>
              {error ? (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDecline(true)}
                className="inline-flex items-center gap-1 self-start text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-danger hover:underline sm:self-end"
              >
                <UserX className="size-3.5" />
                Decline passenger
              </button>
            </form>
          )
        ) : entry.status === "PICKED_UP_PAID" ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent-strong ring-1 ring-inset ring-accent-line/70">
            <BadgeCheck className="size-4" />
            Picked up · {formatEur(entry.payout)} paid out
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <CircleSlash className="size-4" />
            {entry.status === "DECLINED" ? "Declined by you · refunded" : "Cancelled by passenger · refunded"}
          </p>
        )}
      </div>
    </li>
  );
}

function DriverRideMap({ ride }: { ride: DriverRideDTO }) {
  const origin = { lat: ride.originLat, lng: ride.originLng };
  const destination = { lat: ride.destLat, lng: ride.destLng };
  const route = ride.routeGeometry;
  const pickups = ride.manifest.filter((m) => holdsSeat(m.status));
  const markers: MapMarker[] = [
    { id: "o", position: origin, kind: "origin", label: ride.originName },
    { id: "d", position: destination, kind: "destination", label: ride.destName },
    ...pickups.map((m) => ({
      id: m.id,
      position: { lat: m.pickupLat, lng: m.pickupLng },
      kind: "stop" as const,
      label: m.passenger.name.split(" ")[0],
      labelTone: "accent" as const,
    })),
  ];
  return (
    <RouteMap
      className="h-80 border-t border-line sm:h-96"
      scrollWheelZoom={false}
      ariaLabel={`Route ${ride.originName} to ${ride.destName} with passenger pickups`}
      bands={ride.remainingDetourKm > 0 ? [{ id: `band-${ride.id}`, positions: route, radiusKm: ride.remainingDetourKm }] : []}
      paths={[{ id: "route", positions: route, variant: "route" }]}
      markers={markers}
      fitKey={ride.id}
      fitTo={[origin, destination, ...pickups.map((m) => ({ lat: m.pickupLat, lng: m.pickupLng }))]}
    />
  );
}
