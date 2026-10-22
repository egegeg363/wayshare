import { connection } from "next/server";
import { json, route } from "@/lib/server/http";
import { getTrips } from "@/lib/server/services/accounts";
import { requireUser } from "@/lib/server/session";

/** GET /api/trips — bookings, ride offers with manifests, and the wallet ledger. */
export const GET = route(async () => {
  await connection();
  const user = await requireUser();
  return json(await getTrips(user.id));
});
