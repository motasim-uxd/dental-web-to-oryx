import { NextResponse } from "next/server";
import { OryxClient } from "@/lib/oryxClient";
import { ProvidersQuerySchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = ProvidersQuerySchema.safeParse({
    apptType: url.searchParams.get("apptType") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const client = new OryxClient({ realm: "smilesquadpd" });
  const data = await client.getProviders(parsed.data.apptType);
  return NextResponse.json({ success: true, data });
}

