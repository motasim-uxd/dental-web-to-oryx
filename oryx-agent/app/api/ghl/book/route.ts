import { NextResponse } from "next/server";
import { z } from "zod";
import { bookCleaningFromGhl } from "@/lib/ghlBooking";

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

const BookSchema = z.object({
  realm: z.string().min(1),
  apptType: z.string().min(1).default("Cleaning"),
  serviceDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHHMM: z.string().regex(/^\d{1,2}:\d{2}$/),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  preferredName: z.string().optional(),
  dobYear: z.coerce.number().int().min(1900).max(2100),
  dobMonth: z.coerce.number().int().min(1).max(12),
  dobDay: z.coerce.number().int().min(1).max(31),
  email: z.string().email(),
  phoneNumber: z.string().min(7),
  newOrExisting: z.enum(["new", "existing"]).default("new"),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Structured booking endpoint for GHL (recommended).
 *
 * URL: https://YOUR_PUBLIC_DOMAIN/api/ghl/book
 * Header: x-api-key: <GHL_WEBHOOK_SECRET>
 */
export async function POST(req: Request) {
  const auth = assertGhlAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BookSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const p = parsed.data;
  const result = await bookCleaningFromGhl({
    realm: p.realm,
    apptType: p.apptType,
    serviceDateISO: p.serviceDateISO,
    startHHMM: p.startHHMM,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    dob: { year: p.dobYear, month: p.dobMonth, day: p.dobDay },
    email: p.email,
    phoneNumber: p.phoneNumber,
    newOrExisting: p.newOrExisting,
    reason: p.reason,
    notes: p.notes,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        alternatives: result.status === 409 ? result.alternatives : undefined,
      },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, data: result.data });
}
