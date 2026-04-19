import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function assertGhlAuth(req: Request) {
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected) {
    return { ok: false as const, error: "Server missing GHL_WEBHOOK_SECRET" };
  }

  const headerKey =
    req.headers.get("x-api-key") ??
    req.headers.get("x-ghl-webhook-secret") ??
    "";

  if (!timingSafeEqual(headerKey, expected)) {
    return { ok: false as const, error: "Unauthorized" };
  }

  return { ok: true as const };
}

const BodySchema = z.object({
  // GHL payloads vary; accept anything and store minimally.
  transcript: z.string().optional(),
  text: z.string().optional(),
  message: z.string().optional(),
  contact: z.record(z.string(), z.unknown()).optional(),
  conversationId: z.string().optional(),
  callId: z.string().optional(),
}).passthrough();

/**
 * GHL inbound webhook (Transcript Generated).
 *
 * Configure in GHL:
 * - URL: https://YOUR_PUBLIC_DOMAIN/api/ghl/webhook
 * - Method: POST
 * - Header: x-api-key: <same value as GHL_WEBHOOK_SECRET in .env.local>
 */
export async function POST(req: Request) {
  const auth = assertGhlAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // For now: acknowledge receipt. Next step is mapping GHL transcript fields -> Oryx booking.
  return NextResponse.json({
    success: true,
    received: true,
    preview: {
      transcript: parsed.data.transcript ?? parsed.data.text ?? parsed.data.message ?? null,
      conversationId: parsed.data.conversationId ?? null,
      callId: parsed.data.callId ?? null,
    },
  });
}
