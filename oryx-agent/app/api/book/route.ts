import { NextResponse } from "next/server";
import { OryxClient } from "@/lib/oryxClient";
import { BookSchema } from "@/lib/schemas";

export const runtime = "nodejs";
/** Vercel / Oryx round-trips can exceed the default ~10s on cold starts. */
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
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

