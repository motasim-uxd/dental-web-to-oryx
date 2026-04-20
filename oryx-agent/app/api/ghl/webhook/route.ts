import { NextResponse } from "next/server";
import { z } from "zod";
import { bookCleaningFromGhl } from "@/lib/ghlBooking";
import { planOryxBookFromGhlVoiceBody } from "@/lib/ghlVoiceBook";

export const runtime = "nodejs";
export const maxDuration = 60;

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

/** Accept VoiceAiCallEnd-style payloads and custom workflow shapes. */
const BodySchema = z
  .object({
    id: z.string().optional(),
    locationId: z.string().optional(),
    agentId: z.string().optional(),
    contactId: z.string().optional(),
    fromNumber: z.string().optional(),
    summary: z.string().optional(),
    transcript: z.string().optional(),
    text: z.string().optional(),
    message: z.string().optional(),
    translation: z.record(z.string(), z.unknown()).optional(),
    extractedData: z.record(z.string(), z.unknown()).optional(),
    executedCallActions: z.array(z.unknown()).optional(),
    contact: z.record(z.string(), z.unknown()).optional(),
    conversationId: z.string().optional(),
    callId: z.string().optional(),
    oryx: z.record(z.string(), z.unknown()).optional(),
    book: z.record(z.string(), z.unknown()).optional(),
    customData: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * GHL inbound webhook: Voice AI call end / transcript → Oryx online request.
 *
 * Configure GHL (Voice AI or workflow “Custom Webhook”) to POST here after the call:
 * - URL: https://YOUR_DOMAIN/api/ghl/webhook
 * - Header: x-api-key: <GHL_WEBHOOK_SECRET>
 *
 * Map Voice AI **data extraction** fields into `extractedData` (or send the same keys
 * under `oryx` / `book`). See `planOryxBookFromGhlVoiceBody` in `lib/ghlVoiceBook.ts`.
 *
 * @see https://marketplace.gohighlevel.com/docs/webhook/VoiceAiCallEnd/index.html
 */
export async function POST(req: Request) {
  const auth = assertGhlAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data as Record<string, unknown>;
  const plan = planOryxBookFromGhlVoiceBody(body, process.env);

  if (plan.mode === "skip") {
    return NextResponse.json({
      success: true,
      booked: false,
      reasons: plan.reasons,
      preview: {
        transcript: plan.transcript?.slice(0, 500) ?? null,
        contactId: typeof body.contactId === "string" ? body.contactId : null,
        callId: typeof body.id === "string" ? body.id : null,
      },
    });
  }

  const bookResult = await bookCleaningFromGhl(plan.input);
  if (!bookResult.ok) {
    return NextResponse.json(
      {
        success: true,
        booked: false,
        error: bookResult.error,
        alternatives: bookResult.status === 409 ? bookResult.alternatives : undefined,
        preview: {
          serviceDateISO: plan.input.serviceDateISO,
          startHHMM: plan.input.startHHMM,
          transcript: plan.transcript?.slice(0, 300) ?? null,
        },
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    success: true,
    booked: true,
    data: bookResult.data,
    preview: {
      contactId: typeof body.contactId === "string" ? body.contactId : null,
      callId: typeof body.id === "string" ? body.id : null,
    },
  });
}
