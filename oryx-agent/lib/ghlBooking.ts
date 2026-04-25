import { OryxClient, type OryxApptType, type OryxRealm } from "@/lib/oryxClient";

export type GhlBookInput = {
  realm: OryxRealm;
  apptType: OryxApptType;
  /** YYYY-MM-DD (preferred). Also accepts MM-DD-YYYY and converts. */
  serviceDateISO: string;
  /**
   * Preferred: 24h HH:MM.
   * Also accepts 12h like "1 PM", "1:00 pm", "01:00 PM".
   */
  startHHMM: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dob: { year: number; month: number; day: number };
  email: string;
  phoneNumber: string;
  newOrExisting: "new" | "existing";
  reason?: string;
  notes?: string;
};

function parseHHMM(hhmm: string): { hour: number; minute: number } | null {
  const s = hhmm.trim();

  // 24h HH:MM
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  // 12h "h(:mm)? am/pm"
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([aApP][mM])$/);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = m12[2] == null ? 0 : Number(m12[2]);
    const ampm = m12[3].toLowerCase();
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (ampm === "am") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
    return { hour, minute };
  }

  // 12h "h" without am/pm is ambiguous -> reject
  return null;
}

function normalizeDateISO(input: string): string | null {
  const s = input.trim();
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // MM-DD-YYYY
  const mdy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return null;
}

function getDayOfWeekFromISO(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.getDay();
}

function coerceSlotArray(slots: unknown): any[] {
  if (Array.isArray(slots)) return slots;
  if (slots && typeof slots === "object") {
    const obj = slots as Record<string, unknown>;
    const maybe = obj.obj ?? obj.data ?? obj.slots;
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}

export type GhlBookFailure =
  | { ok: false; status: 400; error: string }
  | {
      ok: false;
      status: 409;
      error: string;
      alternatives: Array<{
        start: string;
        end: string;
        operatoryId: number;
        providerId: number;
      }>;
    };

export type GhlBookResult =
  | GhlBookFailure
  | { ok: true; data: unknown };

export async function bookCleaningFromGhl(input: GhlBookInput): Promise<GhlBookResult> {
  const dateISO = normalizeDateISO(input.serviceDateISO);
  if (!dateISO) {
    return { ok: false as const, status: 400, error: "Invalid serviceDateISO (expected YYYY-MM-DD or MM-DD-YYYY)" };
  }

  const start = parseHHMM(input.startHHMM);
  if (!start) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid startHHMM (expected HH:MM 24h or 12h like '1:00 PM')",
    };
  }

  const client = new OryxClient({ realm: input.realm });
  const apptType = input.apptType || "Cleaning";

  const providersRes = await client.getProviders(apptType);
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

  const slots = await client.getScheduleForDate({
    apptType,
    dateISO,
    firstAvail: true,
  });

  const candidates = coerceSlotArray(slots);
  const normalized = candidates.map((s) => {
    const providerId = Number(s?.providerId);
    const operatoryId = Number(s?.operatoryId);
    const oralIdFromSlot = Number(s?.oralId);
    const startTime = s?.startTime;
    const endTime = s?.endTime;
    const sh = Number(startTime?.hour);
    const sm = Number(startTime?.minute);
    const eh = Number(endTime?.hour);
    const em = Number(endTime?.minute);
    return {
      providerId,
      operatoryId,
      oralId:
        (Number.isFinite(oralIdFromSlot) ? oralIdFromSlot : null) ??
        providerIdToOralId.get(providerId) ??
        null,
      start: { hour: sh, minute: sm, second: 0, millis: 0 },
      end: { hour: eh, minute: em, second: 0, millis: 0 },
    };
  });

  const matches = normalized.filter(
    (x) =>
      x.start.hour === start.hour &&
      x.start.minute === start.minute &&
      Number.isFinite(x.operatoryId) &&
      Number.isFinite(x.oralId)
  );

  if (!matches.length) {
    return {
      ok: false as const,
      status: 409,
      error: "Selected time is not available",
      alternatives: normalized.slice(0, 12).map((x) => ({
        start: `${String(x.start.hour).padStart(2, "0")}:${String(x.start.minute).padStart(2, "0")}`,
        end: `${String(x.end.hour).padStart(2, "0")}:${String(x.end.minute).padStart(2, "0")}`,
        operatoryId: x.operatoryId,
        providerId: x.providerId,
      })),
    };
  }

  const dateParts = dateISO.split("-").map((n) => Number(n));
  const date = { year: dateParts[0], month: dateParts[1], day: dateParts[2] };

  const dayOfWeek = getDayOfWeekFromISO(dateISO);
  const reason = input.reason ?? "Cleaning";
  const notes = input.notes ?? "";

  // If multiple operatories/providers share the same start time, try each until one books.
  let lastFailureMessage: string | null = null;
  for (const m of matches) {
    const result = await client.bookOnlineAppointment({
      apptType,
      date,
      start: m.start,
      end: m.end,
      dayOfWeek,
      operatoryId: m.operatoryId,
      oralId: m.oralId as number,
      reason,
      notes,
      firstName: input.firstName,
      lastName: input.lastName,
      preferredName: input.preferredName ?? input.firstName,
      dob: input.dob,
      email: input.email,
      phoneNumber: input.phoneNumber,
      newOrExisting: input.newOrExisting,
    });

    if (result?.success === true) {
      return { ok: true as const, data: result };
    }

    const msg =
      (typeof result?.message === "string" && result.message.trim()) ||
      (typeof result?.error === "string" && result.error.trim()) ||
      null;
    lastFailureMessage = msg ?? lastFailureMessage;
  }

  return {
    ok: false as const,
    status: 409,
    error: lastFailureMessage ?? "Slot not available",
    alternatives: normalized.slice(0, 12).map((x) => ({
      start: `${String(x.start.hour).padStart(2, "0")}:${String(x.start.minute).padStart(2, "0")}`,
      end: `${String(x.end.hour).padStart(2, "0")}:${String(x.end.minute).padStart(2, "0")}`,
      operatoryId: x.operatoryId,
      providerId: x.providerId,
    })),
  };
}
