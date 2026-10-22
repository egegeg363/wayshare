import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { declineBooking } from "@/lib/server/services/bookings";
import { requireUser } from "@/lib/server/session";

/**
 * POST /api/bookings/:id/decline — the ride's driver turns a passenger down: full refund,
 * the seat and detour budget return to the ride, and that passenger can't rebook it.
 */
export const POST = route(async (_request: NextRequest, ctx: RouteContext<"/api/bookings/[id]/decline">) => {
  const driver = await requireUser();
  const { id } = await ctx.params;
  return json(await declineBooking(driver, id));
});
