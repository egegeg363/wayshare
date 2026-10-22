import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { cancelBooking } from "@/lib/server/services/bookings";
import { requireUser } from "@/lib/server/session";

/** POST /api/bookings/:id/cancel — the passenger cancels: full refund, seats + detour budget return to the ride. */
export const POST = route(async (_request: NextRequest, ctx: RouteContext<"/api/bookings/[id]/cancel">) => {
  const passenger = await requireUser();
  const { id } = await ctx.params;
  return json(await cancelBooking(passenger, id));
});
