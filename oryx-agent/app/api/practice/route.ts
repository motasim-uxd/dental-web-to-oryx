import { NextResponse } from "next/server";
import { OryxClient } from "@/lib/oryxClient";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const client = new OryxClient({ realm: "smilesquadpd" });
  const [info, cinfo] = await Promise.all([
    client.getPracticeInfo(),
    client.getPracticeContactInfo(),
  ]);

  return NextResponse.json({ success: true, data: { info, cinfo } });
}

