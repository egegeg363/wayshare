/**
 * WayShare demo data: 4 accounts (2 drivers, 2 passengers), 6 upcoming ride offers and one
 * booking already held in escrow, so the PIN → payout flow can be tested immediately.
 *
 * Departure times are relative to "now", so re-run `npm run db:reset` whenever the seeded
 * rides have departed. All distances, detours and prices come from the same engine the API
 * uses, so seeded numbers match what the app would compute.
 */
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  computeDetour,
  decodePolyline,
  encodePolyline,
  estimateRoute,
  findCity,
  roundKm,
  routeShare,
  straightRoute,
  type Place,
} from "../src/lib/geo";
import { quotePrice, round2 } from "../src/lib/pricing";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

const STARTING_BALANCE = 150;
/** Boarding PIN of the pre-seeded escrow booking (also shown in Lena's "My Trips"). */
const SEEDED_PIN = "4827";

/**
 * Road routes for the seeded rides, captured once from OSRM (simplified overview geometry) so
 * seeding stays offline-safe and deterministic while detours are still measured along real roads.
 */
const SEEDED_ROUTES: Record<string, { polyline: string; distanceKm: number; durationMin: number }> = {
  "Berlin\u2192Munich": { polyline: "_yp_IgdypA`}@xaWvsg@dxe@tjAxj_@lqPnyE|ym@x`qAhyh@|vm@~cmA~eFjvi@`bk@`dYhaHz|GvqNp~]m}Jduh@brVbiY_tDlaGlyF|}UojH~a]haMzoKbnVhn^xaBr|JdjRloSudAjbMrlHdhLloUl_c@xi]hg_AmdQbt]oqa@nba@tt@~dXunLvuG_xKx{h@sPnaScdI`jWduK", distanceKm: 585.2, durationMin: 351 },
  "Hamburg\u2192Cologne": { polyline: "mezeIm{~{@pjHizG|xV`tCniAtsr@f}Fv}[noRvks@xcZjo]`oDxyMxqJl`qAtwY~luAzp`A`dXh}P`|MjyNsJzmt@t{kApdT~gQtrz@y|X`p^n}D~re@dajAbh\\zfFl`O~nShzEvfVllP{rDbdBhnM", distanceKm: 424.8, durationMin: 250 },
  "Frankfurt\u2192Stuttgart": { polyline: "ehzpHav~s@xmC~uKbvIrlCz~SwqB|wPb{BlqL|oHlla@egBnxOn@|uFxbCbmSes@laF{yBzdHqmL@g`W~iH}v\\tqAwq\\tiDyvJzRmgQnsDk{N~kHwXnnYpnMpwHvtLnuL~rF`_Ag}HpuKopA", distanceKm: 204.9, durationMin: 136 },
  "Amsterdam\u2192Brussels": { polyline: "s`s~Hyy|\\jvDyzEtbAntDxgSyrMhyJ{TnuMcxOh_KlcAfiFsqBjqF~cLnhFtyDx|^vgKrdEzgEnqNnl@njHrzI|`G|TjaCb_OzbU|oFvcN`aQ`eLptUzlAv|KlxFsjCrmChuBhkAbaG|z_@jjM|{JjFf|JekG`bGjh@", distanceKm: 200.7, durationMin: 158 },
  "Munich\u2192Vienna": { polyline: "}kxdHicueA_m@mkc@wcCsmSapLyqSgiDgqd@jvAqwn@qyCcvGye@wfL`xCwfTzHqf^trC}_]uqCajIbjA}{Cy{A_iHdYe|XayNcr^jqDurR~tIm_Ib`BkuLn_J}fUqJa`b@iiAiaGf_AquKqnAejLhiBexKmiCg}Lxf@ktF}~Gw~U~uFia_@riKanLngC}cQmr@srWg~CkvJ`kAykb@idEmkU{bDwtFadDyhWltHcn_@wiBw_z@znAwjNbsB{aDtHkjNkfDodTsDsnPotCeuG|~BavT{vCyeG", distanceKm: 403.4, durationMin: 265 },
  "Cologne\u2192Berlin": { polyline: "cv{uHwlni@_aBa_NmmPngD_~E{oUq~N{jSke\\cdFufa@iudA{gUusK}cHszj@gjXaoSqwXkr~AgrK_vSyiRefI{tNkhZyaIk}D}qE{otAgtb@}oq@yfAugt@tjQklsAndDsrqBl`Qkqm@nkIoaxAgpK_tn@krBwggBsjEsn[ezLasS`qAgvq@ffHsnTqx@oy^qmf@sge@iqBgaX", distanceKm: 574.1, durationMin: 349 },
};

function city(name: string): Place {
  const place = findCity(name);
  if (!place) throw new Error(`City "${name}" is missing from the directory`);
  return place;
}

/** Local time `days` from today at hh:mm. */
function at(days: number, hours: number, minutes: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

async function main() {
  console.log("🌱 Seeding WayShare…");

  await prisma.transaction.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.rideOffer.deleteMany();
  await prisma.user.deleteMany();

  const joined = (minutesAgo: number) => new Date(Date.now() - 21 * 24 * 3_600_000 + minutesAgo * 60_000);
  const people = [
    { key: "lena", name: "Lena Fischer", email: "lena.fischer@wayshare.example", rating: 4.9 },
    { key: "malik", name: "Malik Osei", email: "malik.osei@wayshare.example", rating: 4.8 },
    {
      key: "jonas",
      name: "Jonas Weber",
      email: "jonas.weber@wayshare.example",
      rating: 4.9,
      vehicleModel: "Volkswagen ID.4",
      vehiclePlate: "B-JW 2041",
    },
    {
      key: "sofia",
      name: "Sofia Martins",
      email: "sofia.martins@wayshare.example",
      rating: 5.0,
      vehicleModel: "Tesla Model 3",
      vehiclePlate: "HH-SM 7731",
    },
  ] as const;

  const users: Record<(typeof people)[number]["key"], { id: string; name: string }> = {} as never;
  for (const [index, person] of people.entries()) {
    const createdAt = joined(index);
    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        avatarUrl: `/avatars/${person.key}.svg`,
        rating: person.rating,
        vehicleModel: "vehicleModel" in person ? person.vehicleModel : null,
        vehiclePlate: "vehiclePlate" in person ? person.vehiclePlate : null,
        walletBalance: STARTING_BALANCE,
        createdAt,
        transactions: {
          create: {
            amount: STARTING_BALANCE,
            type: "TOP_UP",
            description: "Welcome credit",
            createdAt,
          },
        },
      },
    });
    users[person.key] = user;
  }

  const offers = [
    {
      key: "berlin-munich",
      driver: users.jonas,
      from: "Berlin",
      to: "Munich",
      departure: at(1, 7, 30),
      seats: 3,
      price: 42,
      detourKm: 12,
      detourFee: 0.3,
      notes: "Leaving from Berlin Hbf. Coffee stop near Nuremberg; one carry-on per person.",
    },
    {
      key: "hamburg-cologne",
      driver: users.sofia,
      from: "Hamburg",
      to: "Cologne",
      departure: at(1, 9, 15),
      seats: 2,
      price: 29,
      detourKm: 20,
      detourFee: 0.25,
      notes: "Quiet ride down the A1 — happy to collect you in Bremen, Osnabrück or Münster.",
    },
    {
      key: "frankfurt-stuttgart",
      driver: users.jonas,
      from: "Frankfurt",
      to: "Stuttgart",
      departure: at(2, 17, 45),
      seats: 4,
      price: 15,
      detourKm: 5,
      detourFee: 0,
      notes: "After-work run. Small detours only, free of charge.",
    },
    {
      key: "amsterdam-brussels",
      driver: users.sofia,
      from: "Amsterdam",
      to: "Brussels",
      departure: at(2, 10, 30),
      seats: 3,
      price: 22,
      detourKm: 12,
      detourFee: 0.4,
      notes: "Via Rotterdam and Antwerp. Space for cabin bags; bikes won't fit.",
    },
    {
      key: "munich-vienna",
      driver: users.sofia,
      from: "Munich",
      to: "Vienna",
      departure: at(3, 8, 0),
      seats: 1,
      price: 35,
      detourKm: 0,
      detourFee: 0,
      notes: "Straight through on the A8/A1 — no detours, pickup at Munich Hbf only.",
    },
    {
      key: "cologne-berlin",
      driver: users.jonas,
      from: "Cologne",
      to: "Berlin",
      departure: at(4, 6, 45),
      seats: 4,
      price: 45,
      detourKm: 20,
      detourFee: 0.2,
      notes: "Early start, long haul. Snacks provided, two short breaks.",
    },
  ];

  const rides: Record<string, Awaited<ReturnType<typeof prisma.rideOffer.create>>> = {};
  for (const offer of offers) {
    const origin = city(offer.from);
    const destination = city(offer.to);
    const known = SEEDED_ROUTES[`${offer.from}→${offer.to}`];
    const estimate = estimateRoute([origin, destination]);
    const route = known
      ? { distanceKm: known.distanceKm, durationMin: known.durationMin, polyline: known.polyline }
      : { ...estimate, polyline: encodePolyline(straightRoute(origin, destination)) };
    rides[offer.key] = await prisma.rideOffer.create({
      data: {
        driverId: offer.driver.id,
        originName: origin.name,
        originLat: origin.lat,
        originLng: origin.lng,
        destName: destination.name,
        destLat: destination.lat,
        destLng: destination.lng,
        departureTime: offer.departure,
        baseDistanceKm: route.distanceKm,
        baseDurationMin: route.durationMin,
        routeGeometry: route.polyline,
        totalSeats: offer.seats,
        availableSeats: offer.seats,
        pricePerSeat: offer.price,
        maxDetourKm: offer.detourKm,
        remainingDetourKm: offer.detourKm,
        detourPricePerKm: offer.detourFee,
        notes: offer.notes,
        status: "OPEN",
        createdAt: new Date(Date.now() - 3 * 24 * 3_600_000),
      },
    });
  }

  // Lena already holds a seat on Jonas' Berlin → Munich ride, picked up at Berlin Hbf.
  const ride = rides["berlin-munich"];
  const pickup = { name: "Berlin Hauptbahnhof", lat: 52.5251, lng: 13.3694 };
  const rideLine = decodePolyline(ride.routeGeometry ?? "");
  const detour = computeDetour(rideLine, pickup);
  const price = quotePrice({
    pricePerSeat: ride.pricePerSeat,
    seats: 1,
    routeShare: routeShare(rideLine, pickup),
    detourDistanceKm: detour.detourDistanceKm,
    detourPricePerKm: ride.detourPricePerKm,
  });
  const bookedAt = new Date(Date.now() - 2 * 3_600_000);

  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        rideOfferId: ride.id,
        passengerId: users.lena.id,
        seatsBooked: 1,
        pickupName: pickup.name,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        offRouteKm: detour.offRouteKm,
        detourDistanceKm: detour.detourDistanceKm,
        detourDurationMin: detour.detourDurationMin,
        fareShare: price.fareShare,
        seatCost: price.seatCost,
        detourCost: price.detourCost,
        platformFee: price.platformFee,
        totalPrice: price.totalPrice,
        pickupPin: SEEDED_PIN,
        status: "CONFIRMED_IN_ESCROW",
        createdAt: bookedAt,
      },
    });
    await tx.transaction.create({
      data: {
        userId: users.lena.id,
        bookingId: booking.id,
        amount: -price.totalPrice,
        type: "ESCROW_HOLD",
        description: `${ride.originName} → ${ride.destName} · 1 seat`,
        createdAt: bookedAt,
      },
    });
    await tx.user.update({
      where: { id: users.lena.id },
      data: { walletBalance: round2(STARTING_BALANCE - price.totalPrice) },
    });
    await tx.rideOffer.update({
      where: { id: ride.id },
      data: {
        availableSeats: ride.availableSeats - 1,
        remainingDetourKm: roundKm(ride.remainingDetourKm - detour.offRouteKm),
      },
    });
  });

  console.log(`   ✓ ${people.length} users · ${offers.length} ride offers · 1 booking in escrow`);
  console.log(
    `   ✓ Lena → ${ride.originName}–${ride.destName}: pickup ${pickup.name} (${detour.offRouteKm} km off route), ` +
      `paid €${price.totalPrice.toFixed(2)}, boarding PIN ${SEEDED_PIN}`,
  );
  console.log("   → Switch to Jonas Weber › My Trips & Wallet and enter the PIN to release the payout.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
