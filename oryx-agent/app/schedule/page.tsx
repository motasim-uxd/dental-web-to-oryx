"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as chrono from "chrono-node";

type Role = "assistant" | "user" | "system";
type Msg = { role: Role; text: string };

type Collected = {
  dayISO?: string; // YYYY-MM-DD
  // slot selection
  operatoryId?: number;
  oralId?: number;
  dayOfWeek?: number;
  start?: { hour: number; minute: number };
  end?: { hour: number; minute: number };

  // patient
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  dobISO?: string; // YYYY-MM-DD
  email?: string;
  phone?: string;
  insurance?: "Yes" | "No";
  insuranceCompany?: string;
  insuranceMemberId?: string;
  specialHealthcareNeeds?: "Yes" | "No";
  specialHealthcareNeedsDetails?: string;
  notes?: string;
};

function parseISODate(input: string): string | null {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseNaturalDate(input: string): string | null {
  // Accept: "24 August 2026", "Aug 24 2026", "next Tuesday", etc.
  const direct = parseISODate(input);
  if (direct) return direct;

  const d = chrono.parseDate(input, new Date(), { forwardDate: true });
  if (!d) return null;
  return toISODate(d);
}

function parseTimeHHMM(input: string): { hour: number; minute: number } | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseNaturalTime(input: string, referenceDateISO: string): { hour: number; minute: number } | null {
  // Accept: "3pm", "at 3:30 PM", "15:30", etc. Use the selected day as reference.
  const direct = parseTimeHHMM(input);
  if (direct) return direct;

  const ref = new Date(`${referenceDateISO}T00:00:00`);
  const results = chrono.parse(input, ref, { forwardDate: true });
  for (const r of results) {
    const dt = r.start?.date();
    if (!dt) continue;
    // only accept if the text clearly includes a time
    if (r.start.isCertain("hour") || r.start.isCertain("minute")) {
      return { hour: dt.getHours(), minute: dt.getMinutes() };
    }
  }
  return null;
}

function splitName(input: string): { firstName: string; lastName: string } | null {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function isoToOryxDate(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  return { year: y, month: m, day: d };
}

function normalizeYesNo(input: string): "Yes" | "No" | null {
  const v = input.trim().toLowerCase();
  if (["yes", "y"].includes(v)) return "Yes";
  if (["no", "n"].includes(v)) return "No";
  return null;
}

function buildNotesBlock(c: Collected) {
  const details: string[] = [];

  const insuranceSummary =
    c.insurance === "Yes"
      ? `Insurance: Yes${c.insuranceCompany ? ` (${c.insuranceCompany})` : ""}${
          c.insuranceMemberId ? `, ID: ${c.insuranceMemberId}` : ""
        }`
      : c.insurance === "No"
        ? "Insurance: No"
        : undefined;

  const needsSummary =
    c.specialHealthcareNeeds === "Yes"
      ? "Special needs: Yes"
      : c.specialHealthcareNeeds === "No"
        ? "Special needs: No"
        : undefined;

  // Keep the first line short so it displays in the admin list without truncation.
  const firstLineParts = [insuranceSummary, needsSummary].filter(Boolean) as string[];
  const firstLine = firstLineParts.join(" | ");

  if (c.insurance) {
    details.push(`Insurance: ${c.insurance}`);
    if (c.insurance === "Yes") {
      if (c.insuranceCompany) details.push(`Insurance company: ${c.insuranceCompany}`);
      if (c.insuranceMemberId) details.push(`Insurance member ID: ${c.insuranceMemberId}`);
    }
  }

  if (c.specialHealthcareNeeds) {
    details.push(`Special healthcare needs: ${c.specialHealthcareNeeds}`);
    if (c.specialHealthcareNeeds === "Yes" && c.specialHealthcareNeedsDetails) {
      details.push(`Special healthcare needs details: ${c.specialHealthcareNeedsDetails}`);
    }
  }

  if (c.notes) details.push(`Other notes: ${c.notes}`);

  return [firstLine, ...details].filter((x) => x && x.trim().length > 0).join("\n");
}

export default function SchedulePage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! I can help you schedule a Cleaning appointment. What day would you like to come in?",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [collected, setCollected] = useState<Collected>({});
  const [slotOptions, setSlotOptions] = useState<
    { label: string; operatoryId: number; oralId: number; dayOfWeek: number; start: { hour: number; minute: number }; end: { hour: number; minute: number } }[]
  >([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSessionOn, setVoiceSessionOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceLastTranscript, setVoiceLastTranscript] = useState<string>("");
  const lastSpokenAssistantIdxRef = useRef<number>(-1);
  const processUserAnswerRef = useRef<(text: string) => void>(() => {});
  const busyRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const silenceMsRef = useRef<number>(0);
  const lastTickMsRef = useRef<number>(0);
  const shouldRestartListeningRef = useRef<boolean>(false);

  const lastAssistantPrompt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].text;
    }
    return "";
  }, [messages]);

  function speak(text: string) {
    if (!voiceEnabled) return;
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1;
      utter.pitch = 1;
      utter.lang = "en-US";
      synth.speak(utter);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!voiceEnabled) return;
    // Speak only new assistant messages
    const lastIdx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") return i;
      }
      return -1;
    })();
    if (lastIdx <= lastSpokenAssistantIdxRef.current) return;
    lastSpokenAssistantIdxRef.current = lastIdx;
    const text = messages[lastIdx]?.text ?? "";
    // Keep TTS short-ish: speak first paragraph only
    const firstChunk = text.split("\n").slice(0, 4).join("\n");
    speak(firstChunk);
  }, [messages, voiceEnabled]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  async function ensureMic() {
    if (typeof window === "undefined") return null;
    if (!navigator.mediaDevices?.getUserMedia) return null;
    if (mediaStreamRef.current) return mediaStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    return stream;
  }

  function stopAllAudio() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null;

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // ignore
      }
    }
    audioCtxRef.current = null;
    analyserRef.current = null;

    if (mediaStreamRef.current) {
      for (const t of mediaStreamRef.current.getTracks()) t.stop();
    }
    mediaStreamRef.current = null;
    setRecording(false);
  }

  async function transcribe(blob: Blob) {
    const fd = new FormData();
    fd.append("audio", blob, "speech.webm");
    const res = await fetch("/api/stt", { method: "POST", body: fd });
    const raw = await res.text().catch(() => "");
    let json: any = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        // non-json response
      }
    }

    if (!res.ok || !json?.success) {
      const errMsg =
        json?.error ??
        (raw ? `Transcription failed: ${raw.slice(0, 180)}` : "Transcription failed");
      throw new Error(errMsg);
    }
    return String(json.text ?? "").trim();
  }

  async function recordOneUtteranceAndTranscribe(): Promise<string | null> {
    const stream = await ensureMic();
    if (!stream) {
      setVoiceError("Microphone is not available in this browser/device.");
      return null;
    }

    setVoiceError(null);
    setRecording(true);
    chunksRef.current = [];
    silenceMsRef.current = 0;
    lastTickMsRef.current = performance.now();

    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    const SILENCE_THRESHOLD = 0.015; // tune
    const SILENCE_TO_STOP_MS = 900;
    const MAX_UTTERANCE_MS = 12000;
    const START_GRACE_MS = 250;
    const startMs = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = now - lastTickMsRef.current;
      lastTickMsRef.current = now;

      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);

      const elapsed = now - startMs;
      if (elapsed > START_GRACE_MS) {
        if (rms < SILENCE_THRESHOLD) silenceMsRef.current += dt;
        else silenceMsRef.current = 0;
      }

      if (silenceMsRef.current >= SILENCE_TO_STOP_MS || elapsed >= MAX_UTTERANCE_MS) {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        resolve(blob);
      };
    });

    recorder.start(250);
    rafRef.current = requestAnimationFrame(tick);

    const blob = await done;
    setRecording(false);
    // Cleanup per-utterance audio graph to avoid leaking AudioContexts.
    try {
      source.disconnect();
    } catch {
      // ignore
    }
    try {
      analyser.disconnect();
    } catch {
      // ignore
    }
    try {
      await audioCtx.close();
    } catch {
      // ignore
    }
    if (audioCtxRef.current === audioCtx) audioCtxRef.current = null;
    if (analyserRef.current === analyser) analyserRef.current = null;

    if (blob.size < 5000) return null;
    const text = await transcribe(blob);
    return text || null;
  }

  async function fetchAvailability(dayISO: string) {
    const res = await fetch(`/api/availability?date=${encodeURIComponent(dayISO)}&apptType=Cleaning&firstAvail=true`);
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error("Availability request failed");
    return json.data;
  }

  function extractSlots(scheduleData: any) {
    const candidates: any[] = Array.isArray(scheduleData) ? scheduleData : [];
    const normalized: {
      label: string;
      operatoryId: number;
      oralId: number;
      dayOfWeek: number;
      start: { hour: number; minute: number };
      end: { hour: number; minute: number };
    }[] = [];

    for (const s of candidates) {
      const operatoryId = Number(s?.operatoryId);
      const oralId = Number(s?.oralId);
      const dayOfWeek = Number(s?.dayOfWeek);
      const start = s?.start;
      const end = s?.end;
      const sh = Number(start?.hour);
      const sm = Number(start?.minute);
      const eh = Number(end?.hour);
      const em = Number(end?.minute);

      if (![operatoryId, oralId, dayOfWeek, sh, sm, eh, em].every((n) => Number.isFinite(n))) continue;
      const label = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")} - ${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
      normalized.push({
        label,
        operatoryId,
        oralId,
        dayOfWeek,
        start: { hour: sh, minute: sm },
        end: { hour: eh, minute: em },
      });
    }

    // De-dupe by label+ids
    const seen = new Set<string>();
    return normalized.filter((x) => {
      const k = `${x.label}|${x.operatoryId}|${x.oralId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function submitBooking() {
    if (
      !collected.dayISO ||
      !collected.operatoryId ||
      !collected.oralId ||
      collected.dayOfWeek === undefined ||
      !collected.start ||
      !collected.end ||
      !collected.firstName ||
      !collected.lastName ||
      !collected.dobISO ||
      !collected.email ||
      !collected.phone
    ) {
      throw new Error("Missing fields");
    }

    const date = isoToOryxDate(collected.dayISO);
    const dob = isoToOryxDate(collected.dobISO);

    const payload = {
      apptType: "Cleaning",
      reason: "Cleaning",
      notes: buildNotesBlock(collected),
      date,
      start: { hour: collected.start.hour, minute: collected.start.minute, second: 0, millis: 0 },
      end: { hour: collected.end.hour, minute: collected.end.minute, second: 0, millis: 0 },
      dayOfWeek: collected.dayOfWeek,
      operatoryId: collected.operatoryId,
      oralId: collected.oralId,
      firstName: collected.firstName,
      lastName: collected.lastName,
      preferredName: collected.preferredName ?? collected.firstName,
      dob,
      email: collected.email,
      phoneNumber: collected.phone,
      newOrExisting: "new",
    };

    const res = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error("Booking failed");
    return json.data;
  }

  async function processUserAnswer(userText: string) {
    if (!userText || busy) return;
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setBusy(true);
    try {
      // Step 1: day
      if (!collected.dayISO) {
        const day = parseNaturalDate(userText);
        if (!day) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              text: "What date works for you? You can say something like “Aug 24 2026” or “next Tuesday”.",
            },
          ]);
          return;
        }

        const avail = await fetchAvailability(day);
        const slots = extractSlots(avail);
        if (!slots.length) {
          setMessages((m) => [
            ...m,
            { role: "assistant", text: `I couldn't find openings on ${day}. Try another day (YYYY-MM-DD).` },
          ]);
          return;
        }

        setCollected((c) => ({ ...c, dayISO: day }));
        setSlotOptions(slots.slice(0, 8));
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              `Great — here are some available times on ${day}. What time works for you?\n` +
              slots
                .slice(0, 8)
                .map((s) => `- ${s.label}`)
                .join("\n"),
          },
        ]);
        return;
      }

      // Step 2: time
      if (!collected.start || !collected.end) {
        const t = parseNaturalTime(userText, collected.dayISO);
        if (!t) {
          setMessages((m) => [
            ...m,
            { role: "assistant", text: "What time would you like? You can say “3:30pm” (or pick one of the times listed)." },
          ]);
          return;
        }
        const match = slotOptions.find((s) => s.start.hour === t.hour && s.start.minute === t.minute);
        if (!match) {
          setMessages((m) => [
            ...m,
            { role: "assistant", text: "That time isn't in the available options I found. Please choose one of the listed times." },
          ]);
          return;
        }
        setCollected((c) => ({
          ...c,
          operatoryId: match.operatoryId,
          oralId: match.oralId,
          dayOfWeek: match.dayOfWeek,
          start: match.start,
          end: match.end,
        }));
        setMessages((m) => [...m, { role: "assistant", text: "Perfect. What is the patient's full name? (first and last)" }]);
        return;
      }

      // Step 3: name
      if (!collected.firstName || !collected.lastName) {
        const n = splitName(userText);
        if (!n) {
          setMessages((m) => [...m, { role: "assistant", text: "Please enter first and last name." }]);
          return;
        }
        setCollected((c) => ({ ...c, ...n }));
        setMessages((m) => [...m, { role: "assistant", text: "Date of birth? (YYYY-MM-DD)" }]);
        return;
      }

      // Step 4: dob
      if (!collected.dobISO) {
        const dob = parseISODate(userText);
        if (!dob) {
          setMessages((m) => [...m, { role: "assistant", text: "Please enter DOB like 2013-12-14." }]);
          return;
        }
        setCollected((c) => ({ ...c, dobISO: dob }));
        setMessages((m) => [...m, { role: "assistant", text: "Email address?" }]);
        return;
      }

      // Step 5: email
      if (!collected.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userText)) {
          setMessages((m) => [...m, { role: "assistant", text: "Please enter a valid email." }]);
          return;
        }
        setCollected((c) => ({ ...c, email: userText }));
        setMessages((m) => [...m, { role: "assistant", text: "Phone number? (include country code, e.g. +1 717-884-8807)" }]);
        return;
      }

      // Step 6: phone
      if (!collected.phone) {
        setCollected((c) => ({ ...c, phone: userText }));
        setMessages((m) => [...m, { role: "assistant", text: "Does your child have insurance? (Yes/No)" }]);
        return;
      }

      // Step 7: insurance yes/no
      if (!collected.insurance) {
        const yn = normalizeYesNo(userText);
        if (!yn) {
          setMessages((m) => [...m, { role: "assistant", text: "Please reply Yes or No." }]);
          return;
        }
        setCollected((c) => ({ ...c, insurance: yn }));
        if (yn === "Yes") {
          setMessages((m) => [...m, { role: "assistant", text: "Dental insurance company name?" }]);
        } else {
          setMessages((m) => [...m, { role: "assistant", text: "Does your child have any diagnosed developmental disabilities or special healthcare needs? (Yes/No)" }]);
        }
        return;
      }

      // Step 8: insurance company (only if insurance yes)
      if (collected.insurance === "Yes" && !collected.insuranceCompany) {
        setCollected((c) => ({ ...c, insuranceCompany: userText }));
        setMessages((m) => [...m, { role: "assistant", text: "Insurance member ID?" }]);
        return;
      }

      // Step 9: insurance member id (only if insurance yes)
      if (collected.insurance === "Yes" && !collected.insuranceMemberId) {
        setCollected((c) => ({ ...c, insuranceMemberId: userText }));
        setMessages((m) => [...m, { role: "assistant", text: "Does your child have any diagnosed developmental disabilities or special healthcare needs? (Yes/No)" }]);
        return;
      }

      // Step 10: special needs yes/no
      if (!collected.specialHealthcareNeeds) {
        const yn = normalizeYesNo(userText);
        if (!yn) {
          setMessages((m) => [...m, { role: "assistant", text: "Please reply Yes or No." }]);
          return;
        }
        setCollected((c) => ({ ...c, specialHealthcareNeeds: yn }));
        if (yn === "Yes") {
          setMessages((m) => [...m, { role: "assistant", text: "Please share any details (or type 'no')." }]);
        } else {
          setMessages((m) => [...m, { role: "assistant", text: "Any notes for the clinic? (or type 'no')" }]);
        }
        return;
      }

      // Step 11: special needs details (only if yes)
      if (collected.specialHealthcareNeeds === "Yes" && collected.specialHealthcareNeedsDetails === undefined) {
        const details = userText.toLowerCase() === "no" ? "" : userText;
        setCollected((c) => ({ ...c, specialHealthcareNeedsDetails: details }));
        setMessages((m) => [...m, { role: "assistant", text: "Any notes for the clinic? (or type 'no')" }]);
        return;
      }

      // Step 12: notes + submit
      if (collected.notes === undefined) {
        const notes = userText.toLowerCase() === "no" ? "" : userText;
        setCollected((c) => ({ ...c, notes }));
        setMessages((m) => [...m, { role: "assistant", text: "Booking now..." }]);
        const result = await submitBooking();
        const id = result?.obj?.apt?.id ?? result?.obj?.apt?.apptInfo?.id ?? result?.obj?.aptId ?? "created";
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Done. Appointment ${id} created (pending admin approval).` },
        ]);
        return;
      }

      setMessages((m) => [...m, { role: "assistant", text: "You're all set. If you'd like to book another, refresh the page." }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", text: `Something went wrong: ${e?.message ?? "unknown error"}` }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    processUserAnswerRef.current = (t: string) => {
      // Avoid double-submits while already processing.
      if (busyRef.current) return;
      void processUserAnswer(t);
    };
  });

  async function handleSend() {
    const userText = input.trim();
    if (!userText || busy) return;
    setInput("");
    await processUserAnswer(userText);
  }

  useEffect(() => {
    // Auto-stop voice loop when booking finishes
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && /created \(pending admin approval\)/i.test(last.text)) {
      setVoiceSessionOn(false);
    }
  }, [messages]);

  useEffect(() => {
    if (!voiceEnabled) {
      setVoiceSessionOn(false);
      stopAllAudio();
      return;
    }
    return () => {
      stopAllAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceEnabled]);

  useEffect(() => {
    if (!voiceSessionOn) {
      shouldRestartListeningRef.current = false;
      stopAllAudio();
      return;
    }

    shouldRestartListeningRef.current = true;
    const loop = async () => {
      while (shouldRestartListeningRef.current) {
        if (busyRef.current) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const t = await recordOneUtteranceAndTranscribe().catch((e) => {
          const msg = e?.message ?? "Voice error";
          setVoiceError(msg);
          // Fail-fast: stop voice mode on STT/mic errors to avoid retry loops.
          shouldRestartListeningRef.current = false;
          setVoiceSessionOn(false);
          stopAllAudio();
          return null;
        });
        if (!shouldRestartListeningRef.current) return;
        if (t) {
          setVoiceLastTranscript(t);
          processUserAnswerRef.current(t);
        } else {
          // nothing captured; keep looping but don't spam
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };
    void loop();
    return () => {
      shouldRestartListeningRef.current = false;
      stopAllAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSessionOn]);

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Schedule Online</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        This assistant books directly into Oryx (realm: <b>smilesquadpd</b>, service: <b>Cleaning</b>).
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "12px 0 16px" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
            disabled={busy}
          />
          Voice mode
        </label>
        <button
          onClick={() => speak(lastAssistantPrompt)}
          disabled={!voiceEnabled}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: voiceEnabled ? "#fff" : "#f3f3f3",
          }}
        >
          Replay prompt
        </button>
        <button
          type="button"
          onClick={() => {
            if (!voiceEnabled) return;
            setVoiceError(null);
            setVoiceSessionOn((v) => !v);
          }}
          disabled={!voiceEnabled}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #111",
            background: voiceSessionOn ? "#d13b3b" : "#111",
            color: "#fff",
            cursor: !voiceEnabled ? "not-allowed" : "pointer",
          }}
        >
          {voiceSessionOn ? (recording ? "Listening…" : "Voice on") : "Start voice"}
        </button>
        <span style={{ color: "#666", fontSize: 13 }}>
          {voiceEnabled ? "Click once to start voice. Speak each answer; it will auto-continue." : "Enable to use microphone."}
        </span>
      </div>

      {voiceEnabled && (
        <div style={{ margin: "0 0 12px", color: "#555", fontSize: 13 }}>
          {voiceLastTranscript && (
            <div>
              <b>Last transcript:</b> {voiceLastTranscript}
            </div>
          )}
          {voiceError && (
            <div style={{ marginTop: 6, color: "#b00020" }}>
              <b>Voice issue:</b> {voiceError}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 12,
          minHeight: 360,
          background: "#fff",
        }}
      >
        {messages.map((m, idx) => (
          <div key={idx} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 12px",
                borderRadius: 12,
                whiteSpace: "pre-wrap",
                background: m.role === "user" ? "#111" : "#f3f3f3",
                color: m.role === "user" ? "#fff" : "#111",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "Working..." : "Type your answer..."}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
          disabled={busy}
        />
        <button
          onClick={handleSend}
          disabled={busy || !input.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: busy ? "#999" : "#111",
            color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>

      <details style={{ marginTop: 16, color: "#444" }}>
        <summary>Debug (current state)</summary>
        <pre style={{ fontSize: 12, overflowX: "auto" }}>
          {JSON.stringify({ collected, lastAssistantPrompt }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

