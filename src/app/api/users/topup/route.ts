import type { NextRequest } from "next/server";
import { TopUpRequestSchema } from "@/lib/contracts";
import { json, readJson, route } from "@/lib/server/http";
import { topUpWallet } from "@/lib/server/services/accounts";
import { requireUser } from "@/lib/server/session";

/** POST /api/users/topup — instant test credit for the acting account (default €50). */
export const POST = route(async (request: NextRequest) => {
  const user = await requireUser();
  const { amount } = await readJson(request, TopUpRequestSchema);
  return json(await topUpWallet(user, amount));
});
