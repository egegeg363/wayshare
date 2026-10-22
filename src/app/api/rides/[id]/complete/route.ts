import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { completeRide } from "@/lib/server/services/rides";
import { requireUser } from "@/lib/server/session";

/** POST /api/rides/:id/complete — driver closes a trip once everyone is checked in. */
export const POST = route(async (_request: NextRequest, ctx: RouteContext<"/api/rides/[id]/complete">) => {
  const driver = await requireUser();
  const { id } = await ctx.params;
  return json(await completeRide(driver, id));
});
