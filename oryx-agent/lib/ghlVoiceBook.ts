import * as chrono from "chrono-node";
import type { GhlBookInput } from "@/lib/ghlBooking";

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function parseDobParts(obj: Record<string, unknown>): { year: number; month: number; day: number } | null {
  const y = pickNum(obj, ["dobYear", "birthYear", "oryx_dobYear"]);
  const m = pickNum(obj, ["dobMonth", "birthMonth", "oryx_dobMonth"]);
  const d = pickNum(obj, ["dobDay", "birthDay", "oryx_dobDay"]);
  if (y != null && m != null && d != null) {
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { year: y, month: m, day: d };
  }
  const iso = pickStr(obj, ["dob", "dobISO", "dateOfBirth", "birthday", "oryx_dob"]);
  if (iso) {
    const m2 = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) {
      return { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) };
    }
  }
  return null;
}

function mergeFieldSources(body: Record<string, unknown>): Record<string, unknown> {
  const extracted = asRecord(body.extractedData);
  const oryx = asRecord(body.oryx);
  const book = asRecord(body.book);
  const contact = asRecord(body.contact);
  const customData = asRecord(body.customData);
  // Later keys win — prefer explicit `oryx` / `book` over generic extractedData / contact.
  return { ...contact, ...customData, ...extracted, ...book, ...oryx };
}

function getTranscript(body: Record<string, unknown>): string | null {
  const direct = pickStr(body, ["transcript", "text", "message"]);
  if (direct) return direct;
  const tr = asRecord(body.translation);
  const t2 = pickStr(tr, ["transcript"]);
  return t2 ?? null;
}

function tryParseDateTimeFromTranscript(text: string): { serviceDateISO: string; startHHMM: string } | null {
  const ref = new Date();
  const results = chrono.parse(text, ref, { forwardDate: true });
  for (const r of results) {
    const dt = r.start?.date();
    if (!dt) continue;
    const hasDate =
      r.start.isCertain("day") && r.start.isCertain("month") && r.start.isCertain("year");
    const hasTime = r.start.isCertain("hour") || r.start.isCertain("minute");
    if (hasDate && hasTime) {
      const y = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      const hh = dt.getHours();
      const mm = String(dt.getMinutes()).padStart(2, "0");
      return { serviceDateISO: `${y}-${mo}-${d}`, startHHMM: `${hh}:${mm}` };
    }
  }

  const dateOnly = chrono.parseDate(text, ref, { forwardDate: true });
  if (!dateOnly) return null;
  const dateRef = new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate()
  );
  const timeResults = chrono.parse(text, dateRef, { forwardDate: true });
  for (const r of timeResults) {
    const dt = r.start?.date();
    if (!dt) continue;
    if (r.start.isCertain("hour") || r.start.isCertain("minute")) {
      const y = dateOnly.getFullYear();
      const mo = String(dateOnly.getMonth() + 1).padStart(2, "0");
      const d = String(dateOnly.getDate()).padStart(2, "0");
      const hh = dt.getHours();
      const mm = String(dt.getMinutes()).padStart(2, "0");
      return { serviceDateISO: `${y}-${mo}-${d}`, startHHMM: `${hh}:${mm}` };
    }
  }
  return null;
}

export type VoiceToOryxPlan =
  | { mode: "book"; input: GhlBookInput; transcript: string | null }
  | { mode: "skip"; transcript: string | null; reasons: string[] };

export type VoiceToOryxPlanMany =
  | { mode: "many"; plans: VoiceToOryxPlan[]; transcript: string | null }
  | VoiceToOryxPlan;

/**
 * Build an Oryx booking plan from a GHL Voice AI / workflow JSON body.
 *
 * Configure GHL Voice AI **data extraction** (or workflow merge fields) so
 * `extractedData` (or `oryx` / `book` objects) include:
 * - serviceDateISO (YYYY-MM-DD), startHHMM (H:MM or HH:MM 24h)
 * - firstName, lastName, email
 * - dob + phone: either dobYear/dobMonth/dobDay or dob "YYYY-MM-DD", and phoneNumber (or we use fromNumber)
 *
 * Optional: realm, apptType, preferredName, newOrExisting, reason, notes
 *
 * If `GHL_VOICE_PARSE_TRANSCRIPT` is true, missing date/time can be inferred from `transcript` via chrono-node
 * when first/last/email/phone/dob are already present from extraction.
 */
export function planOryxBookFromGhlVoiceBody(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): VoiceToOryxPlan {
  const fields = mergeFieldSources(body);
  const transcript = getTranscript(body);
  const summary = pickStr(body, ["summary"]) ?? null;

  const realm = (pickStr(fields, ["realm", "oryx_realm"]) ??
    env.GHL_ORYX_REALM ??
    "smilesquadpd") as GhlBookInput["realm"];

  const apptType = (pickStr(fields, ["apptType", "appointmentType", "oryx_apptType"]) ??
    "Cleaning") as GhlBookInput["apptType"];

  let serviceDateISO = pickStr(fields, [
    "serviceDateISO",
    "appointmentDate",
    "apptDate",
    "oryx_serviceDateISO",
  ]);
  let startHHMM = pickStr(fields, ["startHHMM", "appointmentTime", "apptTime", "oryx_startHHMM"]);

  const parseTranscript = env.GHL_VOICE_PARSE_TRANSCRIPT === "1" || env.GHL_VOICE_PARSE_TRANSCRIPT === "true";
  if ((!serviceDateISO || !startHHMM) && parseTranscript && transcript) {
    const parsed = tryParseDateTimeFromTranscript(transcript);
    if (parsed) {
      serviceDateISO = serviceDateISO ?? parsed.serviceDateISO;
      startHHMM = startHHMM ?? parsed.startHHMM;
    }
  }

  const firstName = pickStr(fields, ["firstName", "first_name", "givenName"]);
  const lastName = pickStr(fields, ["lastName", "last_name", "familyName"]);
  const email = pickStr(fields, ["email", "emailAddress"]);
  const phoneNumber =
    pickStr(fields, ["phoneNumber", "phone", "mobile", "contactPhone"]) ??
    pickStr(body, ["fromNumber", "phone", "toNumber"]);

  const dob = parseDobParts(fields);
  const newOrExistingRaw = pickStr(fields, ["newOrExisting", "patientType", "oryx_newOrExisting"]);
  const newOrExisting: GhlBookInput["newOrExisting"] =
    newOrExistingRaw?.toLowerCase() === "existing" ? "existing" : "new";

  const preferredName = pickStr(fields, ["preferredName", "preferred_name"]);
  const reason = pickStr(fields, ["reason", "appointmentReason", "oryx_reason"]);
  const notesField = pickStr(fields, ["notes", "oryx_notes"]);

  if (
    !serviceDateISO ||
    !startHHMM ||
    !firstName ||
    !lastName ||
    !email ||
    !phoneNumber ||
    !dob
  ) {
    const reasons: string[] = [];
    if (!serviceDateISO) reasons.push("missing_serviceDateISO");
    if (!startHHMM) reasons.push("missing_startHHMM");
    if (!firstName) reasons.push("missing_firstName");
    if (!lastName) reasons.push("missing_lastName");
    if (!email) reasons.push("missing_email");
    if (!phoneNumber) reasons.push("missing_phoneNumber");
    if (!dob) reasons.push("missing_dob");
    return { mode: "skip", transcript, reasons };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDateISO)) {
    return { mode: "skip", transcript, reasons: ["invalid_serviceDateISO"] };
  }
  if (!/^\d{1,2}:\d{2}$/.test(startHHMM)) {
    return { mode: "skip", transcript, reasons: ["invalid_startHHMM"] };
  }

  const notesExtra = [summary && `GHL summary: ${summary}`, notesField, transcript && `Transcript:\n${transcript}`]
    .filter(Boolean)
    .join("\n\n");

  const input: GhlBookInput = {
    realm,
    apptType,
    serviceDateISO,
    startHHMM,
    firstName,
    lastName,
    preferredName,
    dob,
    email,
    phoneNumber,
    newOrExisting,
    reason: reason ?? "Cleaning",
    notes: notesExtra || undefined,
  };

  return { mode: "book", input, transcript };
}

/**
 * Multi-child helper: if the payload includes an array of patient objects, build
 * one plan per patient by merging each patient object into `customData`.
 *
 * Supported array keys (any one):
 * - `patients`
 * - `children`
 * - `appointments`
 */
export function planOryxBooksFromGhlVoiceBody(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): VoiceToOryxPlanMany {
  const transcript = getTranscript(body);
  const patientsRaw =
    (body.patients as unknown) ??
    (body.children as unknown) ??
    (body.appointments as unknown);

  if (!Array.isArray(patientsRaw)) {
    return planOryxBookFromGhlVoiceBody(body, env);
  }

  const baseCustom = asRecord(body.customData);
  const plans = patientsRaw.map((p) => {
    const patientObj = asRecord(p);
    const merged: Record<string, unknown> = {
      ...body,
      customData: { ...baseCustom, ...patientObj },
    };
    return planOryxBookFromGhlVoiceBody(merged, env);
  });

  return { mode: "many", plans, transcript };
}
