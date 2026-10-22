import type { NextRequest } from "next/server";
import { SessionRequestSchema } from "@/lib/contracts";
import { json, notFound, readJson, route } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { toUserDTO } from "@/lib/server/serializers";
import { setSessionCookie } from "@/lib/server/session";

/** POST /api/session — switch the acting demo account. */
export const POST = route(async (request: NextRequest) => {
  const { userId } = await readJson(request, SessionRequestSchema);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("That account doesn't exist.");
  const response = json({ user: toUserDTO(user) });
  setSessionCookie(response, request, user.id);
  return response;
});
