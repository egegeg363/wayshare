import "server-only";

import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import type { User } from "@/generated/prisma/client";
import { prisma } from "./db";
import { unauthorized } from "./http";

/**
 * Demo session. There is no password login: the header's account switcher stores the
 * acting user's id in an httpOnly cookie and every handler resolves identity from it,
 * never from request bodies. Swapping in real auth only means replacing this module.
 */
export const SESSION_COOKIE = "wayshare_uid";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** The acting user, or a 401 when no (valid) account is selected. */
export async function requireUser(): Promise<User> {
  const id = await getSessionUserId();
  if (!id) throw unauthorized();
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw unauthorized("That demo account no longer exists. Pick another one.");
  return user;
}

export function setSessionCookie(response: NextResponse, request: NextRequest, userId: string) {
  response.cookies.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    secure: request.nextUrl.protocol === "https:",
  });
}
