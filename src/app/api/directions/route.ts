import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { getRoute } from "@/lib/server/geo-services";
import { json, readQuery, route } from "@/lib/server/http";

const coordinate = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform((pair) => {
    const [lat, lng] = pair.split(",").map(Number);
    return { lat, lng };
  })
  .refine((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180, "Coordinate out of range");

const Query = z.object({
  points: z
    .string()
    .transform((value) => value.split(";"))
    .pipe(z.array(coordinate).min(2, "At least two points").max(6, "At most six points")),
});

/** GET /api/directions?points=lat,lng;lat,lng — OSRM road route with a Haversine fallback. */
export const GET = route(async (request: NextRequest) => {
  await connection();
  const { points } = readQuery(request, Query);
  return json(await getRoute(points));
});
