import type { NextRequest } from "next/server";
import { CreateBookingRequestSchema } from "@/lib/contracts";
import { json, readJson, route } from "@/lib/server/http";
import { createBooking } from "@/lib/server/services/bookings";
import { requireUser } from "@/lib/server/session";

/**
 * POST /api/bookings — atomic booking: validates seats + detour budget, takes payment into
 * escrow, consumes ride capacity and issues the 4-digit boarding PIN in one transaction.
 */
export const POST = route(async (request: NextRequest) => {
  const passenger = await requireUser();
  const body = await readJson(request, CreateBookingRequestSchema);
  return json(await createBooking(passenger, body), { status: 201 });
});
