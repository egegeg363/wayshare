import { connection, type NextRequest } from "next/server";
import { CreateRideRequestSchema, RideSearchQuerySchema } from "@/lib/contracts";
import { json, readJson, readQuery, route } from "@/lib/server/http";
import { createRide, searchRides } from "@/lib/server/services/rides";
import { getSessionUserId, requireUser } from "@/lib/server/session";

/**
 * GET /api/rides — open rides enriched for the searching passenger with detourDistanceKm,
 * detourDurationMin, isWithinDetourRadius and an exact price breakdown.
 * Query: originLat, originLng, destLat, destLng, pickupLat, pickupLng, pickupName, seats, date, tzOffset
 */
export const GET = route(async (request: NextRequest) => {
  await connection();
  const query = readQuery(request, RideSearchQuerySchema);
  return json(await searchRides(query, await getSessionUserId()));
});

/** POST /api/rides — the acting user publishes a ride offer. */
export const POST = route(async (request: NextRequest) => {
  const driver = await requireUser();
  const body = await readJson(request, CreateRideRequestSchema);
  return json(await createRide(driver, body), { status: 201 });
});
