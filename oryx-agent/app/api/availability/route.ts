import { NextResponse } from "next/server";
import { OryxClient } from "@/lib/oryxClient";
import { AvailabilityQuerySchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function assertWebPreviewCode(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.WEB_FORM_PREVIEW_CODE;
  if (!expected) return { ok: true };

  const url = new URL(req.url);
  const provided =
    (req.headers.get("x-preview-code") ?? "").trim() ||
    (url.searchParams.get("code") ?? "").trim();

  if (!provided || !timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

function getDayOfWeekFromISO(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  // JS: 0=Sun..6=Sat
  return d.getDay();
}

export async function GET(req: Request) {
  const auth = assertWebPreviewCode(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const parsed = AvailabilityQuerySchema.safeParse({
    date: url.searchParams.get("date") ?? "",
    apptType: url.searchParams.get("apptType") ?? undefined,
    firstAvail: url.searchParams.get("firstAvail") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const client = new OryxClient({ realm: "smilesquadpd" });
  const slots = await client.getScheduleForDate({
    apptType: parsed.data.apptType,
    dateISO: parsed.data.date,
    firstAvail: parsed.data.firstAvail ?? true,
  });

  const providersRes = await client.getProviders(parsed.data.apptType);
  const providerIdToOralId = new Map<number, number>();
  if (providersRes?.success && Array.isArray(providersRes?.obj)) {
    for (const p of providersRes.obj) {
      const providerId = Number(p?.providerId);
      const oralId = Number(p?.id);
      if (Number.isFinite(providerId) && Number.isFinite(oralId)) {
        providerIdToOralId.set(providerId, oralId);
      }
    }
  }

  const dayOfWeek = getDayOfWeekFromISO(parsed.data.date);
  const normalized = (Array.isArray(slots) ? slots : []).map((s: any) => {
    const providerId = Number(s?.providerId);
    return {
      date: s?.date,
      dayName: s?.dayName,
      dayOfWeek,
      operatoryId: Number(s?.operatoryId),
      providerId,
      oralId: providerIdToOralId.get(providerId) ?? null,
      start: s?.startTime,
      end: s?.endTime,
      mins: Number(s?.mins),
    };
  });

  return NextResponse.json({ success: true, data: normalized });
}

