import type { NextRequest } from "next/server";
import { VerifyPinRequestSchema } from "@/lib/contracts";
import { json, readJson, route } from "@/lib/server/http";
import { verifyPickupPin } from "@/lib/server/services/bookings";
import { requireUser } from "@/lib/server/session";

/** POST /api/bookings/:id/verify-pin — driver releases escrow with the passenger's PIN. */
export const POST = route(
  async (request: NextRequest, ctx: RouteContext<"/api/bookings/[id]/verify-pin">) => {
    const driver = await requireUser();
    const { id } = await ctx.params;
    const { pin } = await readJson(request, VerifyPinRequestSchema);
    return json(await verifyPickupPin(driver, id, pin));
  },
);
