"use client";

import { Loader2, MousePointerClick, RefreshCw, SearchX, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { api, rideSearchQueryString } from "@/lib/api-client";
import type { RideSearchResultDTO } from "@/lib/contracts";
import { findCity, formatCoords, type LatLng, type Place } from "@/lib/geo";
import { formatKm, toLocalDateInput } from "@/lib/format";
import { useDebouncedValue, useHydrated, useResource } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { RouteMap, type MapBand, type MapMarker, type MapPath } from "@/components/map/route-map-client";
import { detourLeg } from "@/components/map/scene";
import { Button } from "@/components/ui/button";
import { DateField, ItineraryFields, rowRadius } from "@/components/ui/itinerary";
import { PlaceInput } from "@/components/ui/place-input";
import { Card, EmptyState, Stepper, Switch } from "@/components/ui/primitives";
import { CheckoutSheet, type CheckoutPickup } from "./checkout-sheet";
import { RideCard, RideCardSkeleton } from "./ride-card";

// Pickups chosen against the seeded road routes: three inside the driver's zone, one just outside.
const SUGGESTIONS = [
  { from: "Berlin", via: "Nuremberg", to: "Munich" },
  { from: "Hamburg", via: "Bremen", to: "Cologne" },
  { from: "Amsterdam", via: "Utrecht", to: "Brussels" },
  { from: "Frankfurt", via: "Heidelberg", to: "Stuttgart" },
] as const;

const OriginIcon = () => <span className="block size-3 rounded-full border-[3px] border-ink bg-white" />;
const DestinationIcon = () => <span className="block size-3 rounded-[3px] bg-ink" />;
const PickupIcon = () => <span className="block size-3 rounded-full bg-accent ring-[3px] ring-accent-soft" />;

export function FindRideView() {
  const { currentUser, dataVersion, refresh, notify } = useApp();
  const hydrated = useHydrated();

  const [origin, setOrigin] = useState<Place | null>(null);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [seats, setSeats] = useState(1);
  const [date, setDate] = useState("");
  const [showOutOfRange, setShowOutOfRange] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [checkout, setCheckout] = useState<{ ride: RideSearchResultDTO; pickup: CheckoutPickup | null } | null>(null);
  const pinRequest = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  // A checkout drawer is transient: close it if this tab is hidden by navigation.
  useLayoutEffect(() => () => setCheckout(null), []);

  // --- Search ------------------------------------------------------------------------
  const query = rideSearchQueryString({ origin, destination, pickup, seats, date: date || undefined });
  const debouncedQuery = useDebouncedValue(query, 220);
  const search = useResource(
    currentUser ? `${debouncedQuery}|${currentUser.id}|${dataVersion}` : null,
    (signal) => api.searchRides(debouncedQuery, signal),
  );
  const rides = search.data?.rides ?? [];
  const visible = rides.filter((ride) => showOutOfRange || ride.ineligibleReason !== "DETOUR_EXCEEDED");
  const hiddenCount = rides.length - visible.length;
  // Nothing is preselected: a ride's route and pickup zone appear only once the user picks it.
  const focused = focusedId ? (visible.find((ride) => ride.id === focusedId) ?? null) : null;
  const pending = search.isLoading || query !== debouncedQuery;

  // The point the detour is measured from: explicit pickup, else the searched origin.
  const pickupPoint: Place | null = pickup ?? origin;

  function choosePickup(place: Place | null, refit = true) {
    setPickup(place);
    if (refit) setFitToken((t) => t + 1);
  }

  async function dropPickupAt(point: LatLng) {
    const request = ++pinRequest.current;
    setPickup({ name: "Dropped pin", detail: formatCoords(point), lat: point.lat, lng: point.lng, source: "pin" });
    try {
      const { place } = await api.reverseGeocode(point);
      if (request === pinRequest.current) setPickup({ ...place, lat: point.lat, lng: point.lng, source: "pin" });
    } catch {
      // Keep the coordinate label — the pin itself is what matters for the detour.
    }
  }

  function applySuggestion(suggestion: (typeof SUGGESTIONS)[number]) {
    setOrigin(findCity(suggestion.from));
    setPickup(findCity(suggestion.via));
    setDestination(findCity(suggestion.to));
    setFocusedId(null);
    setFitToken((t) => t + 1);
  }

  function resetSearch() {
    setOrigin(null);
    setPickup(null);
    setDestination(null);
    setDate("");
    setSeats(1);
    setFocusedId(null);
    setFitToken((t) => t + 1);
  }

  // --- Map scene ---------------------------------------------------------------------
  const a = focused ? { lat: focused.originLat, lng: focused.originLng } : null;
  const b = focused ? { lat: focused.destLat, lng: focused.destLng } : null;
  // The ride's stored route — the exact line its pickup radius is measured from.
  const route = focused ? focused.routeGeometry : null;
  // Layer ids are per ride: selecting another ride swaps in fresh layers instead of
  // mutating the old ones, so the previous route/band can never linger on screen.
  const bands: MapBand[] =
    focused && route && focused.remainingDetourKm > 0
      ? [{ id: `band-${focused.id}`, positions: route, radiusKm: focused.remainingDetourKm }]
      : [];
  const within = focused ? focused.isWithinDetourRadius || focused.ineligibleReason === "ALREADY_BOOKED" : true;

  const markers: MapMarker[] = [];
  const paths: MapPath[] = [];
  if (focused && a && b) {
    markers.push({ id: "ride-origin", position: a, kind: "origin", label: focused.originName });
    markers.push({ id: "ride-destination", position: b, kind: "destination", label: focused.destName });
    if (route) paths.push({ id: `route-${focused.id}`, positions: route, variant: "route" });
    if (pickupPoint && focused.offRouteKm > 0) {
      paths.push(...detourLeg(`leg-${focused.id}`, pickupPoint, route, within));
    }
  } else {
    if (origin) markers.push({ id: "origin", position: origin, kind: "origin", label: origin.name });
    if (destination) markers.push({ id: "destination", position: destination, kind: "destination", label: destination.name });
    if (origin && destination) {
      paths.push({
        id: "wish",
        positions: [
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ],
        variant: "route-muted",
      });
    }
  }
  if (pickupPoint) {
    markers.push({
      id: "pickup",
      position: pickupPoint,
      kind: within ? "pickup" : "pickup-muted",
      label: pickup ? `Pickup · ${pickup.name}` : "Pickup",
      labelTone: within ? "accent" : "muted",
      draggable: true,
    });
  }
  const fitTo = (focused && a && b ? [a, b, pickupPoint] : [origin, destination, pickupPoint]).filter(
    (p): p is LatLng => p !== null,
  );

  const searchedRoute =
    origin || destination ? `${origin?.name ?? "Anywhere"} → ${destination?.name ?? "Anywhere"}` : "All upcoming rides";

  return (
    <div className="grid gap-5 [grid-template-areas:'search'_'map'_'results'] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-x-8 lg:[grid-template-areas:'search_map'_'results_map']">
      {/* Search ------------------------------------------------------------------ */}
      <section className="[grid-area:search]" aria-label="Search rides">
        <div className="mb-5">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">Find a ride</h1>
          <p className="mt-1 text-[15px] text-muted">
            Drivers share the trip they&apos;re already making — and detour to pick you up.
          </p>
        </div>
        <Card className="p-3 sm:p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <ItineraryFields
              onSwap={() => {
                setOrigin(destination);
                setDestination(origin);
                setFitToken((t) => t + 1);
              }}
            >
              <PlaceInput
                id="search-origin"
                variant="row"
                inputClassName={rowRadius.first}
                label="From"
                placeholder="From — city or address"
                icon={<OriginIcon />}
                value={origin}
                onChange={(place) => {
                  setOrigin(place);
                  setFitToken((t) => t + 1);
                }}
              />
              <PlaceInput
                id="search-pickup"
                variant="row"
                label="Exact pickup"
                placeholder="Exact pickup point (optional)"
                icon={<PickupIcon />}
                value={pickup}
                onChange={(place) => choosePickup(place)}
                footer="Or click the map — and drag the green pin — to set an exact pickup point."
              />
              <PlaceInput
                id="search-destination"
                variant="row"
                inputClassName={rowRadius.last}
                label="To"
                placeholder="To — city or address"
                icon={<DestinationIcon />}
                value={destination}
                onChange={(place) => {
                  setDestination(place);
                  setFitToken((t) => t + 1);
                }}
              />
            </ItineraryFields>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DateField
                value={date}
                onChange={setDate}
                min={hydrated ? toLocalDateInput(new Date()) : undefined}
                className="min-w-40 flex-1"
              />
              <div className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface pr-1 pl-3">
                <span className="text-sm text-muted">Seats</span>
                <Stepper label="Seats" value={seats} min={1} max={6} onChange={setSeats} size="sm" />
              </div>
              <Button type="submit" size="lg" className="h-11 lg:hidden">
                Show rides
              </Button>
            </div>
          </form>
        </Card>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Sparkles className="size-3.5" /> Try
          </span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s.from + s.to}
              type="button"
              onClick={() => applySuggestion(s)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              {s.from} → {s.to} <span className="text-subtle">· pickup {s.via}</span>
            </button>
          ))}
          {origin || destination || pickup || date ? (
            <button
              type="button"
              onClick={resetSearch}
              className="rounded-full px-2 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              Clear
            </button>
          ) : null}
        </div>
      </section>

      {/* Map ------------------------------------------------------------------------ */}
      <section
        aria-label="Route and pickup zone"
        className="[grid-area:map] lg:sticky lg:top-24 lg:h-[calc(100dvh-7.5rem)] lg:self-start"
      >
        <Card className="relative h-72 overflow-hidden sm:h-96 lg:h-full">
          <RouteMap
            className="absolute inset-0"
            markers={markers}
            paths={paths}
            bands={bands}
            fitKey={`${focused?.id ?? "none"}|${fitToken}`}
            fitTo={fitTo}
            onMapClick={dropPickupAt}
            onMarkerDragEnd={(id, point) => {
              if (id === "pickup") void dropPickupAt(point);
            }}
            ariaLabel="Map: driver route, pickup zone and your pickup"
          >
            <div className="pointer-events-none absolute top-3 left-3 z-[1000] flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1.5 text-xs font-medium text-ink-soft shadow-card ring-1 ring-line backdrop-blur">
              <MousePointerClick className="size-3.5 text-accent" />
              Click the map to set your exact pickup
            </div>
            {focused ? (
              <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] hidden max-w-[calc(100%-5rem)] rounded-2xl bg-surface/95 px-3.5 py-3 text-xs shadow-card ring-1 ring-line backdrop-blur sm:block">
                <div className="mb-1.5 flex items-center justify-between gap-4">
                  <p className="font-semibold text-ink">
                    {focused.originName} → {focused.destName}
                  </p>
                  <button
                    type="button"
                    onClick={() => setFocusedId(null)}
                    className="pointer-events-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-black/[.05] hover:text-ink"
                  >
                    Clear
                  </button>
                </div>
                <p className="flex items-center gap-2 text-ink-soft">
                  <span className="h-[3px] w-4 rounded-full bg-ink" />
                  Route · {formatKm(focused.baseDistanceKm)}
                  {focused.routeGeometry.length > 2 ? " by road" : " (est.)"}
                </p>
                <p className="mt-1 flex items-center gap-2 text-ink-soft">
                  <span className="h-2.5 w-4 rounded-sm border border-dashed border-accent bg-accent/15" />
                  {focused.remainingDetourKm > 0
                    ? `Pickup zone · up to ${formatKm(focused.remainingDetourKm)} off the route`
                    : "Direct route only — no detours"}
                </p>
                {focused.remainingDetourKm > 0 ? (
                  <p className="mt-1 pl-6 text-[11px] text-muted">Pickups inside the green band qualify</p>
                ) : null}
              </div>
            ) : visible.length > 0 ? (
              <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[calc(100%-5rem)] rounded-2xl bg-surface/95 px-3.5 py-2.5 text-xs text-ink-soft shadow-card ring-1 ring-line backdrop-blur">
                Select a ride to see its route and pickup zone
              </div>
            ) : null}
          </RouteMap>
        </Card>
      </section>

      {/* Results -------------------------------------------------------------------- */}
      <section ref={resultsRef} aria-label="Results" className="scroll-mt-28 [grid-area:results]">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              {searchedRoute}
              {pending && search.data ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
            </h2>
            {search.data ? (
              <p className="text-[13px] text-muted">
                {search.data.meta.eligible} bookable · {search.data.meta.total} matching
                {seats > 1 ? ` · ${seats} seats` : ""}
              </p>
            ) : null}
          </div>
          <Switch
            checked={showOutOfRange}
            onChange={setShowOutOfRange}
            label={`Show out-of-range rides${search.data?.meta.outOfRange ? ` (${search.data.meta.outOfRange})` : ""}`}
          />
        </div>

        {search.error && !search.data ? (
          <EmptyState
            icon={<RefreshCw className="size-5" />}
            title="Couldn't load rides"
            description={search.error.message}
            action={
              <Button variant="secondary" onClick={refresh}>
                Try again
              </Button>
            }
          />
        ) : !search.data ? (
          <div className="space-y-3">
            <RideCardSkeleton />
            <RideCardSkeleton />
            <RideCardSkeleton />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-5" />}
            title={hiddenCount > 0 ? "No rides within detour range" : "No rides match yet"}
            description={
              hiddenCount > 0
                ? `${hiddenCount} ride${hiddenCount === 1 ? " goes" : "s go"} your way, but your pickup is further from the route than the driver will go.`
                : "Try another date, fewer seats, or a nearby city — or offer this ride yourself."
            }
            action={
              hiddenCount > 0 ? (
                <Button variant="secondary" onClick={() => setShowOutOfRange(true)}>
                  Show {hiddenCount} out-of-range ride{hiddenCount === 1 ? "" : "s"}
                </Button>
              ) : (
                <Button variant="secondary" onClick={resetSearch}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <div className={cn("space-y-3 transition-opacity", pending && "opacity-70")}>
            {visible.map((ride) => (
              <RideCard
                key={ride.id}
                ride={ride}
                focused={focused?.id === ride.id}
                pickupLabel={pickupPoint?.name ?? null}
                onFocus={() => setFocusedId((id) => (id === ride.id ? null : ride.id))}
                onBook={() => {
                  setFocusedId(ride.id);
                  setCheckout({
                    ride,
                    pickup: pickupPoint ? { name: pickupPoint.name, lat: pickupPoint.lat, lng: pickupPoint.lng } : null,
                  });
                }}
              />
            ))}
            {hiddenCount > 0 && !showOutOfRange ? (
              <button
                type="button"
                onClick={() => setShowOutOfRange(true)}
                className="w-full rounded-2xl border border-dashed border-line-strong py-3 text-[13px] font-medium text-muted transition-colors hover:text-ink"
              >
                Show {hiddenCount} ride{hiddenCount === 1 ? "" : "s"} outside the detour limit
              </button>
            ) : null}
          </div>
        )}
      </section>

      {checkout && currentUser ? (
        <CheckoutSheet
          key={checkout.ride.id}
          ride={checkout.ride}
          pickup={checkout.pickup}
          initialSeats={seats}
          user={currentUser}
          onClose={() => setCheckout(null)}
          onBooked={(booking) => {
            refresh();
            notify({
              title: "Seat booked",
              description: `PIN ${booking.pickupPin} · ${booking.ride.originName} → ${booking.ride.destName}`,
              action: { label: "Open My Trips", href: "/trips" },
            });
          }}
        />
      ) : null}
    </div>
  );
}
