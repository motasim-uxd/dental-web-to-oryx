import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const whisperUrl = process.env.WHISPER_SERVER_URL ?? "http://127.0.0.1:9000/inference";

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { success: false, error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Missing 'audio' file field" },
        { status: 400 }
      );
    }

    // Forward to whisper.cpp server (docker-whisper-server).
    const fd = new FormData();
    fd.append("file", audio, audio.name || "speech.webm");
    fd.append("response_format", "json");
    fd.append("temperature", "0.0");

    const res = await fetch(whisperUrl, { method: "POST", body: fd as any });
    const raw = await res.text().catch(() => "");
    let json: any = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        // ignore
      }
    }

    if (!res.ok) {
      const errMsg =
        json?.error ??
        json?.message ??
        (raw ? raw.slice(0, 200) : `Whisper server error (${res.status})`);
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 });
    }

    const text = String(json?.text ?? json?.transcription ?? "").trim();
    return NextResponse.json({ success: true, text });
  } catch (err: any) {
    // Always return JSON so the frontend never crashes parsing.
    const message =
      typeof err?.message === "string"
        ? err.message
        : "STT request failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

