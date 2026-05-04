import { NextResponse } from "next/server";
import { OryxClient } from "@/lib/oryxClient";
import { BookSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

function getClientIp(req: Request): string | null {
  // Best-effort. Real IP depends on your proxy/load balancer.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

// Simple in-memory rate limit (works per-instance; resets on deploy/restart).
const RL_WINDOW_MS = 60_000;
const RL_MAX = 30;
const rl = new Map<string, { resetAt: number; count: number }>();

function rateLimit(req: Request): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const key = getClientIp(req) ?? "unknown";
  const now = Date.now();
  const cur = rl.get(key);
  if (!cur || cur.resetAt <= now) {
    rl.set(key, { resetAt: now + RL_WINDOW_MS, count: 1 });
    return { ok: true };
  }
  if (cur.count >= RL_MAX) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true };
}

/**
 * Public web booking endpoint.
 *
 * - Validates payload (same schema as /api/book)
 * - Adds basic bot defense (honeypot + rate limiting)
 * - Books into Oryx using server-side credentials/cookies only
 *
 * The browser never needs any API key; do NOT move secrets to the client.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: { message: "Too many requests. Please try again." } },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && (body as any).website) {
    // honeypot tripped
    return NextResponse.json({ success: false, error: { message: "Invalid request." } }, { status: 400 });
  }

  const parsed = BookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const client = new OryxClient({ realm: "smilesquadpd" });
  const result = await client.bookOnlineAppointment({
    apptType: parsed.data.apptType,
    date: parsed.data.date,
    start: {
      hour: parsed.data.start.hour,
      minute: parsed.data.start.minute,
      second: parsed.data.start.second,
      millis: parsed.data.start.millis,
    },
    end: {
      hour: parsed.data.end.hour,
      minute: parsed.data.end.minute,
      second: parsed.data.end.second,
      millis: parsed.data.end.millis,
    },
    dayOfWeek: parsed.data.dayOfWeek,
    operatoryId: parsed.data.operatoryId,
    oralId: parsed.data.oralId,
    reason: parsed.data.reason,
    notes: parsed.data.notes,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    preferredName: parsed.data.preferredName,
    dob: parsed.data.dob,
    email: parsed.data.email,
    phoneNumber: parsed.data.phoneNumber,
    newOrExisting: parsed.data.newOrExisting,
  });

  return NextResponse.json({ success: true, data: result });
}

