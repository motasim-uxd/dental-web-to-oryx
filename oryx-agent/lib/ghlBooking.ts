import { OryxClient, type OryxApptType, type OryxRealm } from "@/lib/oryxClient";

export type GhlBookInput = {
  realm: OryxRealm;
  apptType: OryxApptType;
  /** YYYY-MM-DD */
  serviceDateISO: string;
  /** 24h HH:MM */
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
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
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
  const start = parseHHMM(input.startHHMM);
  if (!start) {
    return { ok: false as const, status: 400, error: "Invalid startHHMM (expected HH:MM 24h)" };
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
    dateISO: input.serviceDateISO,
    firstAvail: true,
  });

  const candidates = coerceSlotArray(slots);
  const normalized = candidates.map((s) => {
    const providerId = Number(s?.providerId);
    const operatoryId = Number(s?.operatoryId);
    const startTime = s?.startTime;
    const endTime = s?.endTime;
    const sh = Number(startTime?.hour);
    const sm = Number(startTime?.minute);
    const eh = Number(endTime?.hour);
    const em = Number(endTime?.minute);
    return {
      providerId,
      operatoryId,
      oralId: providerIdToOralId.get(providerId) ?? null,
      start: { hour: sh, minute: sm, second: 0, millis: 0 },
      end: { hour: eh, minute: em, second: 0, millis: 0 },
    };
  });

  const match = normalized.find(
    (x) =>
      x.start.hour === start.hour &&
      x.start.minute === start.minute &&
      Number.isFinite(x.operatoryId) &&
      Number.isFinite(x.oralId)
  );

  if (!match) {
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

  const dateParts = input.serviceDateISO.split("-").map((n) => Number(n));
  const date = { year: dateParts[0], month: dateParts[1], day: dateParts[2] };

  const result = await client.bookOnlineAppointment({
    apptType,
    date,
    start: match.start,
    end: match.end,
    dayOfWeek: getDayOfWeekFromISO(input.serviceDateISO),
    operatoryId: match.operatoryId,
    oralId: match.oralId as number,
    reason: input.reason ?? "Cleaning",
    notes: input.notes ?? "",
    firstName: input.firstName,
    lastName: input.lastName,
    preferredName: input.preferredName ?? input.firstName,
    dob: input.dob,
    email: input.email,
    phoneNumber: input.phoneNumber,
    newOrExisting: input.newOrExisting,
  });

  return { ok: true as const, data: result };
}
