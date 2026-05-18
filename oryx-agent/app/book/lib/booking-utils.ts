export type ServiceType = "Emergency" | "Cleaning" | "Consultation" | "Treatment";
export type YesNo = "Yes" | "No";
export type WizardStep = 1 | 2 | 3;

export type SlotOption = {
  label: string;
  operatoryId: number;
  oralId: number;
  dayOfWeek: number;
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
};

export const BOOKED_SLOT_KEYS_V1 = "oryxWebBookedSlotKeysV1";

export type AppointmentTypeOption = { value: ServiceType; label: string };

/** Matches Lex / Connect: same options and order as the phone flow. */
const APPOINTMENT_TYPES_NEW: AppointmentTypeOption[] = [
  { value: "Cleaning", label: "Cleaning" },
  { value: "Emergency", label: "Dental Emergency" },
  { value: "Consultation", label: "Consultation" },
];

const APPOINTMENT_TYPES_EXISTING: AppointmentTypeOption[] = [
  ...APPOINTMENT_TYPES_NEW,
  { value: "Treatment", label: "Treatment" },
];

export function appointmentTypesForPatient(newOrExisting: "new" | "existing"): AppointmentTypeOption[] {
  return newOrExisting === "existing" ? APPOINTMENT_TYPES_EXISTING : APPOINTMENT_TYPES_NEW;
}

export function serviceTypeLabel(value: ServiceType): string {
  const match = APPOINTMENT_TYPES_EXISTING.find((t) => t.value === value);
  return match?.label ?? value;
}

export function isServiceAllowedForPatient(
  serviceType: ServiceType,
  newOrExisting: "new" | "existing"
): boolean {
  return appointmentTypesForPatient(newOrExisting).some((t) => t.value === serviceType);
}

export function fmt12(t: { hour: number; minute: number }) {
  const h24 = Number(t.hour);
  const m = Number(t.minute);
  const suffix = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function slotKeyOf(s: { operatoryId: number; oralId: number; start: { hour: number; minute: number } }) {
  return `${s.operatoryId}|${s.oralId}|${s.start.hour}|${s.start.minute}`;
}

export function bookedSlotStorageKey(dateISO: string, s: Pick<SlotOption, "operatoryId" | "oralId" | "start">) {
  return `${dateISO}|${s.operatoryId}|${s.oralId}|${s.start.hour}|${s.start.minute}`;
}

export function readBookedKeysForDate(dateISO: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(BOOKED_SLOT_KEYS_V1);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Set();
    const prefix = `${dateISO}|`;
    return new Set(arr.filter((k) => typeof k === "string" && k.startsWith(prefix)) as string[]);
  } catch {
    return new Set();
  }
}

export function rememberBookedSlot(dateISO: string, s: Pick<SlotOption, "operatoryId" | "oralId" | "start">) {
  if (typeof window === "undefined") return;
  const k = bookedSlotStorageKey(dateISO, s);
  try {
    const raw = window.localStorage.getItem(BOOKED_SLOT_KEYS_V1);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? (arr.filter((x) => typeof x === "string") as string[]) : [];
    if (!list.includes(k)) list.push(k);
    const trimmed = list.slice(-200);
    window.localStorage.setItem(BOOKED_SLOT_KEYS_V1, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

function startMinutes(t: { hour: number; minute: number }) {
  return Number(t.hour) * 60 + Number(t.minute);
}

export function mergeSlotsByStartTime(options: SlotOption[]): SlotOption[] {
  const sorted = [...options].sort((a, b) => {
    const da = startMinutes(a.start) - startMinutes(b.start);
    if (da !== 0) return da;
    if (a.operatoryId !== b.operatoryId) return a.operatoryId - b.operatoryId;
    return a.oralId - b.oralId;
  });

  const out: SlotOption[] = [];
  let lastStartKey: string | null = null;
  for (const s of sorted) {
    const startKey = `${s.start.hour}|${s.start.minute}`;
    if (startKey === lastStartKey) continue;
    lastStartKey = startKey;
    out.push(s);
  }
  return out;
}

export function isoToOryxDate(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  return { year: y, month: m, day: d };
}

export function operatoryRoomLabel(operatoryId: number) {
  if (operatoryId === 3) return "Room 4";
  if (operatoryId === 2) return "Room 2";
  if (operatoryId === 6) return "Room 6";
  return `Room ${operatoryId}`;
}

export function formatAppointmentDateTime(dateISO: string, slot: SlotOption) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d, slot.start.hour, slot.start.minute);
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = dt.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${weekday}, ${monthDay} at ${fmt12(slot.start)}`;
}

export function shiftDateISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function todayISO() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function buildNotes(params: {
  serviceType: ServiceType;
  insurance: YesNo;
  insuranceCompany?: string;
  insuranceMemberId?: string;
  specialHealthcareNeeds: YesNo;
  specialHealthcareNeedsDetails?: string;
  notes?: string;
}) {
  const details: string[] = [];

  const insuranceSummary =
    params.insurance === "Yes"
      ? `Insurance: Yes${params.insuranceCompany ? ` (${params.insuranceCompany})` : ""}${
          params.insuranceMemberId ? `, ID: ${params.insuranceMemberId}` : ""
        }`
      : "Insurance: No";

  const needsSummary =
    params.specialHealthcareNeeds === "Yes" ? "Special needs: Yes" : "Special needs: No";

  details.push(`Service: ${params.serviceType} | ${insuranceSummary} | ${needsSummary}`);

  if (params.insurance === "Yes") {
    if (params.insuranceCompany) details.push(`Insurance company: ${params.insuranceCompany}`);
    if (params.insuranceMemberId) details.push(`Insurance member ID: ${params.insuranceMemberId}`);
  }

  details.push(`Special healthcare needs: ${params.specialHealthcareNeeds}`);
  if (params.specialHealthcareNeeds === "Yes" && params.specialHealthcareNeedsDetails) {
    details.push(`Special healthcare needs details: ${params.specialHealthcareNeedsDetails}`);
  }

  if (params.notes && params.notes.trim()) details.push(`Other notes: ${params.notes.trim()}`);
  return details.join("\n");
}
