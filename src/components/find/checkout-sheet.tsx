"use client";

import Link from "next/link";
import { CheckCircle2, CreditCard, Lock, MapPin, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { api, toApiError, type ApiError } from "@/lib/api-client";
import type { PassengerBookingDTO, RideSearchResultDTO, UserDTO } from "@/lib/contracts";
import { computeDetour, formatCoords, routeShare, type LatLng } from "@/lib/geo";
import { formatDay, formatEur, formatKm, formatTime } from "@/lib/format";
import { PLATFORM_FEE_RATE, quotePrice } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { RouteMap } from "@/components/map/route-map-client";
import { detourLeg } from "@/components/map/scene";
import { Button, buttonClasses } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Avatar, Badge, FieldLabel, Stepper, inputClasses } from "@/components/ui/primitives";

export type CheckoutPickup = LatLng & { name: string };

const TEST_CARD = "4242 4242 4242 4242";

function defaultExpiry(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${String((now.getFullYear() + 3) % 100).padStart(2, "0")}`;
}

function formatCardNumber(value: string) {
  return value
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function CheckoutSheet({
  ride,
  pickup,
  initialSeats,
  user,
  onClose,
  onBooked,
}: {
  ride: RideSearchResultDTO;
  /** Passenger's pickup; null = board at the driver's start point. */
  pickup: CheckoutPickup | null;
  initialSeats: number;
  user: UserDTO;
  onClose: () => void;
  onBooked: (booking: PassengerBookingDTO) => void;
}) {
  const origin = { lat: ride.originLat, lng: ride.originLng };
  const destination = { lat: ride.destLat, lng: ride.destLng };
  const boarding: CheckoutPickup = pickup ?? { ...origin, name: ride.originName };

  const [seats, setSeats] = useState(Math.max(1, Math.min(initialSeats, ride.availableSeats)));
  // Same engine and the same stored route as the server, so this quote is exactly what the
  // booking API will charge.
  const route = ride.routeGeometry.map(([lat, lng]) => ({ lat, lng }));
  const detour = computeDetour(route, boarding);
  const quote = quotePrice({
    pricePerSeat: ride.pricePerSeat,
    seats,
    routeShare: routeShare(route, boarding),
    detourDistanceKm: detour.detourDistanceKm,
    detourPricePerKm: ride.detourPricePerKm,
  });
  const ridePct = Math.round(quote.routeShare * 100);
  const farePct = Math.round(quote.fareShare * 100);
  const walletCovers = user.walletBalance + 1e-9 >= quote.totalPrice;

  const [method, setMethod] = useState<"WALLET" | "CARD">(walletCovers ? "WALLET" : "CARD");
  const [card, setCard] = useState(() => ({
    number: TEST_CARD,
    expiry: defaultExpiry(),
    cvc: "123",
    holder: user.name,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [booking, setBooking] = useState<PassengerBookingDTO | null>(null);

  const routePositions = ride.routeGeometry;

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createBooking({
        rideOfferId: ride.id,
        seats,
        pickup: { name: boarding.name, lat: boarding.lat, lng: boarding.lng },
        payment: method === "WALLET" ? { method: "WALLET" } : { method: "CARD", card },
      });
      setBooking(result.booking);
      onBooked(result.booking);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (booking) {
    return (
      <Sheet open onClose={onClose} title="You're booked" description={`${ride.originName} → ${ride.destName}`}>
        <BookingConfirmation booking={booking} onClose={onClose} />
      </Sheet>
    );
  }

  const canPay = method === "CARD" || walletCovers;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Confirm & pay"
      description={`${formatDay(ride.departureTime)} · ${formatTime(ride.departureTime)} · ${ride.originName} → ${ride.destName}`}
      footer={
        <div className="space-y-3">
          {error ? (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {error.message}
            </p>
          ) : null}
          <Button size="lg" className="w-full" onClick={confirm} loading={submitting} disabled={!canPay}>
            <Lock className="size-4" />
            Confirm & Pay {formatEur(quote.totalPrice)}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="size-3.5 text-accent" />
            Held in escrow — released to {ride.driver.name.split(" ")[0]} only when they enter your PIN.
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Avatar src={ride.driver.avatarUrl} name={ride.driver.name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{ride.driver.name}</p>
            <p className="truncate text-xs text-muted">
              ★ {ride.driver.rating.toFixed(1)} · {ride.driver.vehicleModel}
            </p>
          </div>
          <Badge tone={detour.offRouteKm < 0.3 ? "accent" : "outline"}>
            {detour.offRouteKm < 0.3 ? "On route" : `${formatKm(detour.offRouteKm)} off route`}
          </Badge>
        </div>

        <section>
          <div className="overflow-hidden rounded-2xl border border-line">
            <RouteMap
              className="h-56"
              scrollWheelZoom={false}
              ariaLabel="Pickup location"
              bands={
                ride.remainingDetourKm > 0
                  ? [{ id: `band-${ride.id}`, positions: routePositions, radiusKm: ride.remainingDetourKm }]
                  : []
              }
              paths={[
                ...(routePositions ? [{ id: "route", positions: routePositions, variant: "route" as const }] : []),
                ...detourLeg("leg", boarding, routePositions, true),
              ]}
              markers={[
                { id: "o", position: origin, kind: "origin" },
                { id: "d", position: destination, kind: "destination" },
                { id: "p", position: boarding, kind: "pickup", label: "Pickup", labelTone: "accent" },
              ]}
              fitKey={`${ride.id}:${boarding.lat}:${boarding.lng}`}
              fitTo={[origin, destination, boarding]}
            />
            <div className="flex items-start gap-2.5 border-t border-line bg-canvas px-4 py-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-ink">{boarding.name}</p>
                <p className="text-xs text-muted">
                  {formatCoords(boarding)} ·{" "}
                  {detour.offRouteKm < 0.3
                    ? "directly on the driver's route"
                    : `${formatKm(detour.offRouteKm)} from the route · +${formatKm(detour.detourDistanceKm)} / +${detour.detourDurationMin} min for the driver`}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Seats</p>
            <p className="text-xs text-muted">{ride.availableSeats} available</p>
          </div>
          <Stepper label="Seats" value={seats} min={1} max={ride.availableSeats} onChange={setSeats} />
        </section>

        <section>
          <p className="mb-2 text-sm font-medium">Price breakdown</p>
          <dl className="space-y-2 rounded-2xl border border-line p-4 text-sm">
            <Row
              label={`${seats} seat${seats === 1 ? "" : "s"} × ${formatEur(quote.pricePerSeat)}`}
              value={formatEur(quote.seatCost)}
            />
            {quote.fareShare < 1 ? (
              <p className="-mt-1 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs text-accent-strong">
                {quote.routeShare < quote.fareShare
                  ? `You ride ${ridePct}% of the route — minimum fare is ${farePct}% of the ${formatEur(quote.fullPricePerSeat)} full-route price.`
                  : `You ride ${ridePct}% of the route, so you pay ${farePct}% of the ${formatEur(quote.fullPricePerSeat)} full-route price.`}
              </p>
            ) : null}
            <Row
              label={
                quote.detourPricePerKm > 0
                  ? `Detour fee (${formatKm(quote.detourDistanceKm)} extra driving × ${formatEur(quote.detourPricePerKm)})`
                  : "Detour fee"
              }
              value={quote.detourCost > 0 ? formatEur(quote.detourCost) : "Free"}
              accent={quote.detourCost === 0}
            />
            <Row label={`Platform fee (${Math.round(PLATFORM_FEE_RATE * 100)}%)`} value={formatEur(quote.platformFee)} />
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular text-lg font-semibold">{formatEur(quote.totalPrice)}</dd>
            </div>
            <p className="text-xs text-muted">
              Driver receives {formatEur(quote.driverPayout)} after pickup.
            </p>
          </dl>
        </section>

        <section>
          <p className="mb-2 text-sm font-medium">Payment method</p>
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
            <PaymentOption
              active={method === "WALLET"}
              onSelect={() => setMethod("WALLET")}
              icon={<Wallet className="size-4" />}
              title="Wallet"
              detail={walletCovers ? `${formatEur(user.walletBalance)} available` : `Only ${formatEur(user.walletBalance)}`}
              warn={!walletCovers}
            />
            <PaymentOption
              active={method === "CARD"}
              onSelect={() => setMethod("CARD")}
              icon={<CreditCard className="size-4" />}
              title="Card"
              detail="Instant · test mode"
            />
          </div>
          {method === "WALLET" && !walletCovers ? (
            <p className="mt-2 text-[13px] text-warn">
              Your wallet is {formatEur(quote.totalPrice - user.walletBalance)} short — pay by card or top up in My
              Trips & Wallet.
            </p>
          ) : null}
          {method === "CARD" ? (
            <div className="mt-3 space-y-3 rounded-2xl border border-line bg-canvas p-4">
              <div>
                <FieldLabel htmlFor="card-number" hint="Test card prefilled">
                  Card number
                </FieldLabel>
                <input
                  id="card-number"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  className={cn(inputClasses, "tabular font-mono text-[14px] tracking-wide")}
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                />
              </div>
              <div className="grid grid-cols-[1fr_1fr] gap-3">
                <div>
                  <FieldLabel htmlFor="card-expiry">Expiry</FieldLabel>
                  <input
                    id="card-expiry"
                    autoComplete="cc-exp"
                    placeholder="MM/YY"
                    className={cn(inputClasses, "tabular font-mono text-[14px]")}
                    value={card.expiry}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setCard({ ...card, expiry: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
                    }}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="card-cvc">CVC</FieldLabel>
                  <input
                    id="card-cvc"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    className={cn(inputClasses, "tabular font-mono text-[14px]")}
                    value={card.cvc}
                    onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="card-holder">Name on card</FieldLabel>
                <input
                  id="card-holder"
                  autoComplete="cc-name"
                  className={inputClasses}
                  value={card.holder}
                  onChange={(e) => setCard({ ...card, holder: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted">
                Simulated payments only — never enter a real card. Try <span className="font-mono">4000 0000 0000 0002</span>{" "}
                to see a decline.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </Sheet>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular font-medium", accent ? "text-accent-strong" : "text-ink")}>{value}</dd>
    </div>
  );
}

function PaymentOption({
  active,
  onSelect,
  icon,
  title,
  detail,
  warn,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-all",
        active ? "border-ink bg-surface shadow-[0_0_0_3px_rgb(17_17_17/0.05)]" : "border-line hover:border-line-strong",
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-xl",
          active ? "bg-ink text-white" : "bg-wash text-ink-soft",
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cn("block text-xs", warn ? "text-warn" : "text-muted")}>{detail}</span>
      </span>
    </button>
  );
}

function BookingConfirmation({ booking, onClose }: { booking: PassengerBookingDTO; onClose: () => void }) {
  const driverFirstName = booking.ride.driver.name.split(" ")[0];
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft ring-8 ring-accent-soft/50">
        <CheckCircle2 className="size-7 text-accent" />
      </span>
      <h3 className="mt-5 text-xl font-semibold tracking-tight">Seat confirmed</h3>
      <p className="mt-1 text-sm text-muted">
        {formatDay(booking.ride.departureTime)} at {formatTime(booking.ride.departureTime)} · pickup at {booking.pickupName}
      </p>

      <div className="mt-6 w-full rounded-3xl border border-accent-line bg-accent-soft/60 p-5">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-accent-strong uppercase">Your boarding PIN</p>
        <div className="mt-3 flex justify-center gap-2" aria-label={`Boarding PIN ${booking.pickupPin.split("").join(" ")}`}>
          {booking.pickupPin.split("").map((digit, index) => (
            <span
              key={index}
              className="tabular flex h-14 w-12 items-center justify-center rounded-2xl bg-surface font-mono text-2xl font-semibold text-ink shadow-card ring-1 ring-accent-line"
            >
              {digit}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-ink-soft">
          Show this to {driverFirstName} when you get in. Your {formatEur(booking.totalPrice)} stays in escrow until they
          enter it.
        </p>
      </div>

      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        <Link href="/trips" className={buttonClasses("primary", "lg")} onClick={onClose}>
          View in My Trips
        </Link>
        <Button variant="secondary" size="lg" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
