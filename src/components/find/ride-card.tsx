"use client";

import Link from "next/link";
import { ArrowRight, CircleSlash, Route, Star, Ticket } from "lucide-react";
import type { RideSearchResultDTO } from "@/lib/contracts";
import { formatDay, formatDurationShort, formatEur, formatKm, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, buttonClasses } from "@/components/ui/button";
import { Avatar, Badge, SeatIndicator, type BadgeTone } from "@/components/ui/primitives";

type BadgeSpec = { tone: BadgeTone; text: string; icon: "route" | "slash" };

/** Detour badge copy, exactly as a passenger should read it. */
export function detourBadge(ride: RideSearchResultDTO): BadgeSpec {
  const limit = ride.remainingDetourKm;
  const limitLabel = limit < ride.maxDetourKm ? "left" : "max";
  if (!ride.pickup) return { tone: "accent", text: "Pickup at the driver's start point", icon: "route" };
  if (!ride.isWithinDetourRadius) {
    return {
      tone: "muted",
      text: `Outside pickup zone (${formatKm(ride.offRouteKm)} from the route vs ${formatKm(limit)} ${limitLabel})`,
      icon: "slash",
    };
  }
  if (ride.offRouteKm < 0.3) return { tone: "accent", text: "Right on the route (no detour)", icon: "route" };
  return {
    tone: "accent",
    text: `${formatKm(ride.offRouteKm)} from the route (Within driver's ${formatKm(limit)} limit)`,
    icon: "route",
  };
}

export function DetourBadge({ ride, className }: { ride: RideSearchResultDTO; className?: string }) {
  if (ride.ineligibleReason === "ALREADY_BOOKED") {
    return (
      <Badge tone="ink" className={className} icon={<Ticket className="size-3.5" />}>
        You&apos;re booked on this ride
      </Badge>
    );
  }
  if (ride.ineligibleReason === "DECLINED_BY_DRIVER") {
    return (
      <Badge tone="muted" className={className} icon={<CircleSlash className="size-3.5" />}>
        The driver declined your booking on this ride
      </Badge>
    );
  }
  const spec = detourBadge(ride);
  return (
    <Badge
      tone={spec.tone}
      className={className}
      icon={spec.icon === "route" ? <Route className="size-3.5" /> : <CircleSlash className="size-3.5" />}
    >
      {spec.text}
    </Badge>
  );
}

function blockedReason(ride: RideSearchResultDTO): string | null {
  switch (ride.ineligibleReason) {
    case "OWN_RIDE":
      return "This is your ride";
    case "DETOUR_EXCEEDED":
      return "Pickup outside the driver's zone";
    case "NOT_ENOUGH_SEATS":
      return ride.availableSeats === 1 ? "Only 1 seat left" : `Only ${ride.availableSeats} seats left`;
    case "RIDE_NOT_OPEN":
      return "Not taking bookings";
    case "DECLINED_BY_DRIVER":
      return "Not available to you";
    default:
      return null;
  }
}

export function RideCard({
  ride,
  focused,
  pickupLabel,
  onFocus,
  onBook,
}: {
  ride: RideSearchResultDTO;
  focused: boolean;
  pickupLabel: string | null;
  onFocus: () => void;
  onBook: () => void;
}) {
  const booked = ride.ineligibleReason === "ALREADY_BOOKED";
  const blocked = booked ? null : blockedReason(ride);
  const duration = ride.baseDurationMin + ride.detourDurationMin;
  const { priceBreakdown: price } = ride;

  return (
    <article
      onClick={onFocus}
      className={cn(
        "group relative cursor-pointer rounded-2xl border bg-surface p-4 transition-[border-color,box-shadow,opacity] sm:p-5",
        focused ? "border-ink shadow-[0_0_0_4px_rgb(17_17_17/0.04)]" : "border-line hover:border-line-strong",
        !ride.isEligible && !focused && "bg-surface/70",
      )}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFocus();
          }}
          aria-pressed={focused}
          aria-label={`Show ${ride.originName} to ${ride.destName} on the map`}
          className="min-w-0 flex-1 rounded-lg text-left"
        >
          <p className="mb-2.5 text-xs font-medium text-muted">
            {formatDay(ride.departureTime)} · {formatKm(ride.baseDistanceKm)}
          </p>
          <div className="grid grid-cols-[3.25rem_14px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
            <time className="tabular text-[15px] font-semibold">{formatTime(ride.departureTime)}</time>
            <span className="flex justify-center">
              <span className="size-2.5 rounded-full border-[2.5px] border-ink bg-white" />
            </span>
            <span className="truncate text-[15px] font-semibold">{ride.originName}</span>

            <span className="tabular text-[11px] whitespace-nowrap text-muted">{formatDurationShort(duration)}</span>
            <span className="flex h-full justify-center">
              <span className={cn("w-px", pickupLabel ? "h-full bg-line-strong" : "h-5 bg-line-strong")} />
            </span>
            {pickupLabel ? (
              <span className="flex min-w-0 items-center gap-1.5 py-1 text-[13px] text-ink-soft">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    ride.isWithinDetourRadius ? "bg-accent" : "bg-subtle",
                  )}
                />
                <span className="truncate">Pickup · {pickupLabel}</span>
              </span>
            ) : (
              <span />
            )}

            <time className="tabular text-[15px] font-semibold">{formatTime(ride.estimatedArrivalTime)}</time>
            <span className="flex justify-center">
              <span className="size-2.5 rounded-[3px] bg-ink" />
            </span>
            <span className="truncate text-[15px] font-semibold">{ride.destName}</span>
          </div>
        </button>

        <div className="shrink-0 text-right">
          <p className="tabular text-[22px] leading-none font-semibold tracking-tight">{formatEur(price.pricePerSeat)}</p>
          <p className="mt-1 text-xs text-muted">per seat</p>
          {price.fareShare < 1 ? <FareShareNote price={price} /> : null}
          {ride.detourPricePerKm > 0 ? (
            <p className="mt-2 text-[11px] text-muted">+{formatEur(ride.detourPricePerKm)}/detour km</p>
          ) : (
            <p className="mt-2 text-[11px] text-accent-strong">Free detour</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DetourBadge ride={ride} />
        {ride.detourDurationMin > 0 && ride.isWithinDetourRadius && ride.ineligibleReason !== "ALREADY_BOOKED" ? (
          <Badge tone="outline">+{ride.detourDurationMin} min</Badge>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar src={ride.driver.avatarUrl} name={ride.driver.name} size={34} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{ride.driver.name}</span>
              <span className="inline-flex items-center gap-0.5 text-xs text-muted" title="Verified rating">
                <Star className="size-3 fill-ink text-ink" />
                {ride.driver.rating.toFixed(1)}
              </span>
            </p>
            <p className="truncate text-xs text-muted">{ride.driver.vehicleModel ?? "Vehicle on request"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <SeatIndicator total={ride.totalSeats} available={ride.availableSeats} />
            <p className="mt-1 text-[11px] text-muted">
              {ride.availableSeats} of {ride.totalSeats} seats free
            </p>
          </div>
          {booked ? (
            <Link
              href="/trips"
              onClick={(event) => event.stopPropagation()}
              className={buttonClasses("secondary", "md")}
            >
              View PIN
            </Link>
          ) : blocked ? (
            <span className="max-w-36 text-right text-xs leading-snug text-muted">{blocked}</span>
          ) : (
            <Button
              size="md"
              onClick={(event) => {
                event.stopPropagation();
                onBook();
              }}
              aria-label={`Book ${price.seats} seat${price.seats === 1 ? "" : "s"} for ${formatEur(price.totalPrice)}`}
            >
              Book
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/** "47% of the route · full route €42.00" — why this passenger pays less than the headline price. */
export function FareShareNote({ price }: { price: RideSearchResultDTO["priceBreakdown"] }) {
  const minimumApplies = price.routeShare < price.fareShare;
  return (
    <div className="mt-2 flex flex-col items-end gap-0.5">
      <span
        className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-strong"
        title={
          minimumApplies
            ? `You ride ${Math.round(price.routeShare * 100)}% of the route; the minimum fare is ${Math.round(price.fareShare * 100)}%.`
            : `You ride ${Math.round(price.routeShare * 100)}% of the route, so you pay that share of the full-route price.`
        }
      >
        {minimumApplies ? `Minimum fare (${Math.round(price.fareShare * 100)}%)` : `${Math.round(price.fareShare * 100)}% of the route`}
      </span>
      <span className="text-[11px] text-subtle">
        Full route <span className="tabular line-through">{formatEur(price.fullPricePerSeat)}</span>
      </span>
    </div>
  );
}

export function RideCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex justify-between">
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-black/[.055]" />
          <div className="h-4 w-48 animate-pulse rounded bg-black/[.055]" />
          <div className="h-4 w-40 animate-pulse rounded bg-black/[.055]" />
        </div>
        <div className="h-6 w-16 animate-pulse rounded bg-black/[.055]" />
      </div>
      <div className="mt-5 h-6 w-64 animate-pulse rounded-full bg-black/[.055]" />
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 animate-pulse rounded-full bg-black/[.055]" />
          <div className="h-4 w-28 animate-pulse rounded bg-black/[.055]" />
        </div>
        <div className="h-10 w-20 animate-pulse rounded-xl bg-black/[.055]" />
      </div>
    </div>
  );
}
