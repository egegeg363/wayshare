import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { reverseGeocode } from "@/lib/server/geo-services";
import { json, readQuery, route } from "@/lib/server/http";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** GET /api/geocode/reverse?lat=&lng= — label for a pin dropped on the map. */
export const GET = route(async (request: NextRequest) => {
  await connection();
  return json(await reverseGeocode(readQuery(request, Query)));
});
