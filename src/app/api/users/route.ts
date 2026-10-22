import { connection, type NextRequest } from "next/server";
import type { z } from "zod";
import type { UsersResponseSchema } from "@/lib/contracts";
import { HttpError, json, route } from "@/lib/server/http";
import { toUserDTO } from "@/lib/server/serializers";
import { listUsers, pickDefaultUser } from "@/lib/server/services/accounts";
import { getSessionUserId, setSessionCookie } from "@/lib/server/session";

/** GET /api/users — every demo account (for the switcher) plus the active one. */
export const GET = route(async (request: NextRequest) => {
  await connection();
  const sessionUserId = await getSessionUserId();
  const users = await listUsers();
  const current = users.find((u) => u.id === sessionUserId) ?? pickDefaultUser(users);
  if (!current) {
    throw new HttpError(503, "NOT_SEEDED", "No demo accounts yet. Run `npm run db:seed` and reload.");
  }
  const response = json({
    users: users.map(toUserDTO),
    currentUserId: current.id,
  } satisfies z.infer<typeof UsersResponseSchema>);
  if (current.id !== sessionUserId) setSessionCookie(response, request, current.id);
  return response;
});
