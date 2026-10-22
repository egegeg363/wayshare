import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { geocode } from "@/lib/server/geo-services";
import { json, readQuery, route } from "@/lib/server/http";

const Query = z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(200) });

/** GET /api/geocode?q= — OpenStreetMap Nominatim search, falling back to the city directory. */
export const GET = route(async (request: NextRequest) => {
  await connection();
  const { q } = readQuery(request, Query);
  return json(await geocode(q));
});
