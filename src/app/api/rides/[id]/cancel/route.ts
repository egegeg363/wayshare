import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { cancelRide } from "@/lib/server/services/rides";
import { requireUser } from "@/lib/server/session";

/** POST /api/rides/:id/cancel — driver cancels the trip; escrowed passengers are refunded. */
export const POST = route(async (_request: NextRequest, ctx: RouteContext<"/api/rides/[id]/cancel">) => {
  const driver = await requireUser();
  const { id } = await ctx.params;
  return json(await cancelRide(driver, id));
});
