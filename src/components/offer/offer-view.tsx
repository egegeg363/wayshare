"use client";

import Link from "next/link";
import { CarFront, Clock3, Euro, Loader2, Route, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { api, toApiError } from "@/lib/api-client";
import { MAX_DETOUR_KM, MAX_SEATS } from "@/lib/domain";
import { ROAD_WINDING_FACTOR, estimateRoute, haversineKm, type LatLng, type Place } from "@/lib/geo";
import { formatDuration, formatEur, formatKm, toLocalDateInput } from "@/lib/format";
import { useDirections, useHydrated } from "@/lib/hooks";
import { MIN_FARE_SHARE, quotePrice, seatPriceFor, suggestSeatPrice } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { RouteMap, type MapBand, type MapMarker } from "@/components/map/route-map-client";
import { Button } from "@/components/ui/button";
import { ItineraryFields, rowRadius } from "@/components/ui/itinerary";
import { PlaceInput } from "@/components/ui/place-input";
import {
  Card,
  Eyebrow,
  FieldError,
  FieldLabel,
  Segmented,
  SeatIndicator,
  Skeleton,
  Stepper,
  inputClasses,
} from "@/components/ui/primitives";

type Errors = Partial<Record<string, string>>;

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toLocalDateInput(date);
}

/** Reads the clock — only ever called from the submit handler. */
function isInPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

const OriginIcon = () => <span className="block size-3 rounded-full border-[3px] border-ink bg-white" />;
const DestinationIcon = () => <span className="block size-3 rounded-[3px] bg-ink" />;

export function OfferRideView() {
  const { currentUser, refresh, notify } = useApp();
  const hydrated = useHydrated();

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState("08:00");
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState<string | null>(null); // null = follow the suggestion
  const [detourKm, setDetourKm] = useState(5);
  const [feeMode, setFeeMode] = useState<"free" | "per-km">("free");
  const [feePerKm, setFeePerKm] = useState("0.50");
  const [notes, setNotes] = useState("");
  const [editVehicle, setEditVehicle] = useState(false);
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // --- Live route preview --------------------------------------------------------------
  const sameEnds = origin && destination ? haversineKm(origin, destination) < 2 : false;
  const points: LatLng[] | null = origin && destination && !sameEnds ? [origin, destination] : null;
  const directions = useDirections(points);
  // The pickup zone is a band along the actual route, exactly `detourKm` wide on each side.
  const bands: MapBand[] =
    points && directions && detourKm > 0
      ? [{ id: "band", positions: directions.geometry, radiusKm: detourKm }]
      : [];
  const distanceKm = directions?.distanceKm ?? null;
  const suggestion = distanceKm ? suggestSeatPrice(distanceKm) : null;
  const effectivePrice = price ?? (suggestion !== null ? suggestion.toFixed(2) : "");
  const priceValue = Number.parseFloat(effectivePrice);
  const feeValue = feeMode === "free" ? 0 : Number.parseFloat(feePerKm) || 0;
  const effectiveDate = date ?? (hydrated ? tomorrow() : "");
  const hasVehicle = Boolean(currentUser?.vehicleModel && currentUser.vehiclePlate);
  const showVehicleFields = !hasVehicle || editVehicle;

  const markers: MapMarker[] = [];
  if (origin) markers.push({ id: "o", position: origin, kind: "origin", label: origin.name });
  if (destination) markers.push({ id: "d", position: destination, kind: "destination", label: destination.name });

  const sampleQuote =
    Number.isFinite(priceValue) && priceValue > 0
      ? quotePrice({ pricePerSeat: priceValue, seats: 1, routeShare: 1, detourDistanceKm: 0, detourPricePerKm: feeValue })
      : null;

  function validate(): Errors {
    const next: Errors = {};
    if (!origin) next.origin = "Where are you leaving from?";
    if (!destination) next.destination = "Where are you heading?";
    if (sameEnds) next.destination = "Destination must differ from the origin";
    const departure = new Date(`${effectiveDate}T${time}`);
    if (!effectiveDate || !time || Number.isNaN(departure.getTime())) next.departureTime = "Pick a date and time";
    else if (isInPast(departure)) next.departureTime = "Departure must be in the future";
    if (!Number.isFinite(priceValue) || priceValue < 1) next.pricePerSeat = "Set a price of at least €1";
    if (feeMode === "per-km" && !(feeValue > 0 && feeValue <= 5)) next.detourPricePerKm = "Between €0.01 and €5 per km";
    if (showVehicleFields) {
      if (vehicleModel.trim().length < 2) next.vehicleModel = "Add your car model";
      if (vehiclePlate.trim().length < 2) next.vehiclePlate = "Add your plate";
    }
    return next;
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !origin || !destination) return;
    setSubmitting(true);
    try {
      const { ride, routeSource } = await api.createRide({
        origin: { name: origin.name, lat: origin.lat, lng: origin.lng },
        destination: { name: destination.name, lat: destination.lat, lng: destination.lng },
        departureTime: new Date(`${effectiveDate}T${time}`).toISOString(),
        totalSeats: seats,
        pricePerSeat: Math.round(priceValue * 100) / 100,
        maxDetourKm: detourKm,
        detourPricePerKm: feeValue,
        notes: notes.trim() || undefined,
        ...(showVehicleFields ? { vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase() } : {}),
      });
      refresh();
      notify({
        title: "Ride published",
        description: `${ride.originName} → ${ride.destName} · ${formatKm(ride.baseDistanceKm)} ${routeSource === "osrm" ? "by road" : "(estimated)"}`,
        action: { label: "View in My Trips", href: "/trips" },
      });
      setOrigin(null);
      setDestination(null);
      setPrice(null);
      setNotes("");
      setEditVehicle(false);
      setErrors({});
    } catch (err) {
      const apiError = toApiError(err);
      const fieldErrors: Errors = {};
      for (const [key, messages] of Object.entries(apiError.fieldErrors ?? {})) {
        fieldErrors[key.split(".")[0]] = messages[0];
      }
      setErrors(fieldErrors);
      notify({ tone: "error", title: "Couldn't publish ride", description: apiError.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (!currentUser) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Skeleton className="h-[640px] rounded-2xl" />
        <Skeleton className="h-[480px] rounded-2xl" />
      </div>
    );
  }

  const fill = `${(detourKm / MAX_DETOUR_KM) * 100}%`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
      <div>
        <div className="mb-5">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">Offer a ride</h1>
          <p className="mt-1 text-[15px] text-muted">
            Already driving somewhere? Fill your empty seats and split the cost.
          </p>
        </div>

        <form onSubmit={publish} noValidate>
          <Card className="divide-y divide-line">
            {/* Route */}
            <fieldset className="p-5 sm:p-6">
              <legend className="contents">
                <Eyebrow className="mb-3">Route</Eyebrow>
              </legend>
              <ItineraryFields
                invalid={Boolean(errors.origin || errors.destination)}
                onSwap={() => {
                  setOrigin(destination);
                  setDestination(origin);
                }}
              >
                <PlaceInput
                  id="offer-origin"
                  variant="row"
                  inputClassName={rowRadius.first}
                  label="Leaving from"
                  placeholder="Leaving from"
                  icon={<OriginIcon />}
                  value={origin}
                  onChange={setOrigin}
                  error={errors.origin}
                />
                <PlaceInput
                  id="offer-destination"
                  variant="row"
                  inputClassName={rowRadius.last}
                  label="Going to"
                  placeholder="Going to"
                  icon={<DestinationIcon />}
                  value={destination}
                  onChange={setDestination}
                  error={errors.destination}
                />
              </ItineraryFields>
              <FieldError>{errors.origin ?? errors.destination}</FieldError>
              <div className="mt-3 flex min-h-6 items-center gap-2 text-[13px]">
                {directions ? (
                  <>
                    <Route className="size-4 text-accent" />
                    <span className="tabular font-medium text-ink">{formatKm(directions.distanceKm)}</span>
                    <span className="text-subtle">·</span>
                    <span className="tabular text-ink-soft">{formatDuration(directions.durationMin)}</span>
                    <span className="text-muted">
                      {directions.loading
                        ? "· checking roads…"
                        : directions.source === "osrm"
                          ? "· by road (OSRM)"
                          : "· estimated (offline)"}
                    </span>
                    {directions.loading ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
                  </>
                ) : (
                  <span className="text-muted">Pick both ends to preview distance and drive time.</span>
                )}
              </div>
            </fieldset>

            {/* When & seats */}
            <fieldset className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <legend className="contents">
                <Eyebrow className="mb-0 sm:col-span-2">When &amp; seats</Eyebrow>
              </legend>
              <div>
                <FieldLabel htmlFor="offer-date">Departure</FieldLabel>
                <div className="flex gap-2">
                  <input
                    id="offer-date"
                    type="date"
                    className={cn(inputClasses, "tabular min-w-0 flex-[1.4]")}
                    value={effectiveDate}
                    min={hydrated ? toLocalDateInput(new Date()) : undefined}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <input
                    aria-label="Departure time"
                    type="time"
                    className={cn(inputClasses, "tabular min-w-0 flex-1")}
                    value={time}
                    step={300}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
                <FieldError>{errors.departureTime}</FieldError>
              </div>
              <div>
                <FieldLabel>Available seats</FieldLabel>
                <div className="flex h-11 items-center gap-4">
                  <Stepper label="Seats" value={seats} min={1} max={MAX_SEATS} onChange={setSeats} />
                  <SeatIndicator total={seats} available={seats} />
                </div>
              </div>
            </fieldset>

            {/* Price */}
            <fieldset className="p-5 sm:p-6">
              <legend className="contents">
                <Eyebrow className="mb-3">Price</Eyebrow>
              </legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <FieldLabel htmlFor="offer-price">Price per seat · full route</FieldLabel>
                  <div className="relative">
                    <Euro className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
                    <input
                      id="offer-price"
                      type="number"
                      inputMode="decimal"
                      min={1}
                      max={250}
                      step={0.5}
                      placeholder="0.00"
                      value={effectivePrice}
                      onChange={(e) => setPrice(e.target.value)}
                      className={cn(inputClasses, "tabular pl-9 text-[17px] font-semibold")}
                    />
                  </div>
                </div>
                {suggestion !== null ? (
                  <button
                    type="button"
                    onClick={() => setPrice(null)}
                    className={cn(
                      "flex h-11 items-center gap-2 rounded-xl border px-3.5 text-[13px] transition-colors",
                      price === null
                        ? "border-accent-line bg-accent-soft text-accent-strong"
                        : "border-line bg-surface text-ink-soft hover:border-line-strong",
                    )}
                  >
                    <Sparkles className="size-4" />
                    Fair cost-split suggestion: <span className="tabular font-semibold">{formatEur(suggestion)}</span>
                    {price !== null ? <span className="font-semibold text-ink underline underline-offset-2">Use</span> : null}
                  </button>
                ) : null}
              </div>
              <FieldError>{errors.pricePerSeat}</FieldError>
              <p className="mt-2 text-xs text-muted">
                {suggestion !== null && distanceKm
                  ? `Based on ~€0.07 per passenger-km for ${formatKm(distanceKm)} — fuel and wear, split fairly.`
                  : "We'll suggest a fair price once your route is set."}
              </p>
              <p className="mt-3 rounded-xl bg-canvas px-3.5 py-3 text-[13px] leading-relaxed text-ink-soft ring-1 ring-line">
                This is the fare for the whole trip. Passengers who board along the way pay for the share of the
                route they ride
                {Number.isFinite(priceValue) && priceValue > 0 ? (
                  <>
                    {" "}
                    — someone joining halfway pays{" "}
                    <strong className="tabular text-ink">{formatEur(seatPriceFor(priceValue, 0.5))}</strong>
                  </>
                ) : null}
                . Minimum {Math.round(MIN_FARE_SHARE * 100)}% of the full fare.
              </p>
            </fieldset>

            {/* Detour */}
            <fieldset className="p-5 sm:p-6">
              <legend className="contents">
                <Eyebrow className="mb-3">Pickup detour</Eyebrow>
              </legend>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <label htmlFor="offer-detour" className="text-[13px] font-medium text-ink-soft">
                    Pickup radius
                  </label>
                  <p className="tabular text-[32px] leading-none font-semibold tracking-tight">
                    {detourKm}
                    <span className="ml-1 text-base font-medium text-muted">km</span>
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    detourKm === 0 ? "bg-wash text-muted" : "bg-accent-soft text-accent-strong",
                  )}
                >
                  {detourKm === 0 ? "On-route pickups only" : detourKm <= 3 ? "Small detours" : detourKm <= 10 ? "Flexible" : "Very flexible"}
                </span>
              </div>
              <input
                id="offer-detour"
                type="range"
                min={0}
                max={MAX_DETOUR_KM}
                step={1}
                value={detourKm}
                onChange={(e) => setDetourKm(Number(e.target.value))}
                className="ws-range mt-4"
                style={{ "--fill": fill } as React.CSSProperties}
                aria-valuetext={`${detourKm} kilometres`}
              />
              <div className="mt-1.5 flex justify-between text-[11px] text-subtle">
                <span>0 km</span>
                <span>15 km</span>
                <span>30 km</span>
              </div>
              <p className="mt-3 rounded-xl bg-canvas px-3.5 py-3 text-[13px] leading-relaxed text-ink-soft ring-1 ring-line">
                {detourKm === 0 ? (
                  <>Passengers must meet you directly on your route — you won&apos;t leave it at all.</>
                ) : (
                  <>
                    You are willing to drive up to <strong className="text-ink">{detourKm} km</strong> off your main
                    route to pick someone up. Anyone inside the green band along your route qualifies.
                  </>
                )}
              </p>

              <div className="mt-5">
                <FieldLabel>Detour fee</FieldLabel>
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    label="Detour fee"
                    value={feeMode}
                    onChange={setFeeMode}
                    options={[
                      { value: "free", label: "Free detour" },
                      { value: "per-km", label: "Charge per km" },
                    ]}
                  />
                  {feeMode === "per-km" ? (
                    <div className="relative w-36">
                      <input
                        aria-label="Fee per detour kilometre"
                        type="number"
                        inputMode="decimal"
                        min={0.05}
                        max={5}
                        step={0.05}
                        value={feePerKm}
                        onChange={(e) => setFeePerKm(e.target.value)}
                        className={cn(inputClasses, "tabular h-10 pr-12")}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">
                        €/km
                      </span>
                    </div>
                  ) : null}
                </div>
                <FieldError>{errors.detourPricePerKm}</FieldError>
                <p className="mt-2 text-xs text-muted">
                  {feeMode === "free"
                    ? "Passengers pay only the seat price, whatever their detour."
                    : `A pickup 3 km off your route means ~${formatKm(2 * 3 * ROAD_WINDING_FACTOR)} of extra driving — ${formatEur(Math.round(2 * 3 * ROAD_WINDING_FACTOR * 10) / 10 * feeValue)} on that passenger's fare.`}
                </p>
              </div>
            </fieldset>

            {/* Vehicle & notes */}
            <fieldset className="space-y-4 p-5 sm:p-6">
              <legend className="contents">
                <Eyebrow className="mb-0">Vehicle &amp; notes</Eyebrow>
              </legend>
              {hasVehicle && !editVehicle ? (
                <div className="flex items-center justify-between rounded-xl border border-line px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-wash">
                      <CarFront className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{currentUser.vehicleModel}</p>
                      <p className="font-mono text-xs text-muted">{currentUser.vehiclePlate}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setVehicleModel(currentUser.vehicleModel ?? "");
                      setVehiclePlate(currentUser.vehiclePlate ?? "");
                      setEditVehicle(true);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div>
                  {!hasVehicle ? (
                    <p className="mb-3 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-strong">
                      Add your car once and you can offer rides from this account.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                    <div>
                      <FieldLabel htmlFor="vehicle-model">Car model</FieldLabel>
                      <input
                        id="vehicle-model"
                        className={inputClasses}
                        placeholder="e.g. Škoda Octavia"
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value)}
                      />
                      <FieldError>{errors.vehicleModel}</FieldError>
                    </div>
                    <div>
                      <FieldLabel htmlFor="vehicle-plate">Plate</FieldLabel>
                      <input
                        id="vehicle-plate"
                        className={cn(inputClasses, "font-mono uppercase")}
                        placeholder="B-AB 1234"
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value)}
                      />
                      <FieldError>{errors.vehiclePlate}</FieldError>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <FieldLabel htmlFor="offer-notes" hint={`${notes.length}/280`}>
                  Notes for passengers <span className="font-normal text-muted">(optional)</span>
                </FieldLabel>
                <textarea
                  id="offer-notes"
                  rows={3}
                  maxLength={280}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Meeting point, luggage space, breaks…"
                  className={cn(inputClasses, "h-auto resize-none py-3")}
                />
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
              <p className="text-[13px] text-muted">
                {sampleQuote
                  ? `A full-route passenger pays ${formatEur(sampleQuote.totalPrice)} per seat incl. fees · you receive ${formatEur(sampleQuote.driverPayout)}.`
                  : "Set your route and price to publish."}
              </p>
              <Button type="submit" size="lg" loading={submitting}>
                Publish ride
              </Button>
            </div>
          </Card>
        </form>
      </div>

      {/* Preview ------------------------------------------------------------------------ */}
      <aside className="lg:sticky lg:top-24 lg:h-[calc(100dvh-7.5rem)] lg:self-start" aria-label="Live route preview">
        <Card className="flex h-full flex-col overflow-hidden">
          <RouteMap
            className="h-72 sm:h-96 lg:h-auto lg:flex-1"
            markers={markers}
            bands={bands}
            paths={directions ? [{ id: "route", positions: directions.geometry, variant: "route" }] : []}
            fitKey={`${origin?.lat},${origin?.lng}|${destination?.lat},${destination?.lng}`}
            fitTo={[origin, destination].filter((p): p is Place => p !== null)}
            ariaLabel="Preview of your route and pickup zone"
          >
            {!points ? (
              <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-6">
                <p className="rounded-2xl bg-surface/95 px-4 py-3 text-center text-[13px] text-ink-soft shadow-card ring-1 ring-line backdrop-blur">
                  Choose where you&apos;re leaving from and going to —<br />
                  your route and pickup zone appear here.
                </p>
              </div>
            ) : null}
          </RouteMap>
          <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
            <Stat icon={<Route className="size-4" />} label="Distance" value={distanceKm ? formatKm(distanceKm) : "—"} />
            <Stat
              icon={<Clock3 className="size-4" />}
              label="Drive time"
              value={directions ? formatDuration(directions.durationMin) : "—"}
            />
            <Stat
              icon={<Users className="size-4" />}
              label="Full car"
              value={Number.isFinite(priceValue) && priceValue > 0 ? formatEur(priceValue * seats) : "—"}
              accent
            />
          </div>
        </Card>
        {origin && destination && !directions?.loading && directions?.source === "estimate" ? (
          <p className="mt-2 text-xs text-muted">
            Live routing is unavailable, so distance uses a Haversine × 1.22 estimate (
            {formatKm(estimateRoute([origin, destination]).distanceKm)}).
          </p>
        ) : null}
        <p className="mt-2 hidden text-xs text-muted lg:block">
          Published rides appear instantly in{" "}
          <Link href="/" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
            Find a Ride
          </Link>{" "}
          and in your trips dashboard.
        </p>
      </aside>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </p>
      <p className={cn("tabular mt-1 text-[17px] font-semibold tracking-tight", accent && "text-accent-strong")}>{value}</p>
    </div>
  );
}
