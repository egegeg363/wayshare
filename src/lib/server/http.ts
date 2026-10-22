import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ApiErrorBody } from "@/lib/contracts";

/** An error that maps 1:1 onto an HTTP response. Throw it anywhere inside a handler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") => new HttpError(400, code, message);
export const unauthorized = (message = "Choose a demo account first.") =>
  new HttpError(401, "NO_ACTIVE_USER", message);
export const forbidden = (message: string, code = "FORBIDDEN") => new HttpError(403, code, message);
export const notFound = (message: string) => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, code = "CONFLICT") => new HttpError(409, code, message);

function errorResponse(status: number, body: ApiErrorBody["error"]) {
  return NextResponse.json({ error: body } satisfies ApiErrorBody, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return errorResponse(error.status, {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    });
  }
  if (error instanceof z.ZodError) {
    const fieldErrors = zodFieldErrors(error);
    const first = error.issues[0];
    return errorResponse(400, {
      code: "VALIDATION_FAILED",
      message: first ? `${first.path.join(".") || "Request"}: ${first.message}` : "Invalid request",
      fieldErrors,
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return errorResponse(409, {
        code: "CONCURRENT_UPDATE",
        message: "Someone else just changed this ride. Please try again.",
      });
    }
    if (error.code === "P2025") {
      return errorResponse(404, { code: "NOT_FOUND", message: "That record no longer exists." });
    }
  }
  console.error("[api] unhandled error", error);
  return errorResponse(500, {
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our side. Please try again.",
  });
}

/**
 * Wraps a route handler with uniform error handling. The context type is passed through
 * untouched so Next.js' generated route types still validate the export.
 */
export function route<C>(handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      // Let Next.js' own control-flow signals through (e.g. the prerender bail-out that
      // `connection()` throws at build time) — they are not application errors.
      unstable_rethrow(error);
      return toErrorResponse(error);
    }
  };
}

/** Parse and validate a JSON request body (an empty body is treated as `{}`). */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw badRequest("Request body must be valid JSON.", "INVALID_JSON");
    }
  }
  return schema.parse(body);
}

/** Parse query parameters, treating empty values as absent. */
export function readQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.output<S> {
  const raw: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    if (value.trim() !== "") raw[key] = value;
  });
  return schema.parse(raw);
}

export function json<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}
