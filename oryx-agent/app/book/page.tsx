"use client";

import { useMemo, useState } from "react";

type ServiceType = "Emergency" | "Cleaning" | "Consultation" | "Treatment";
type YesNo = "Yes" | "No";

type SlotOption = {
  label: string;
  operatoryId: number;
  oralId: number;
  dayOfWeek: number;
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
};

function splitFullName(input: string): { firstName: string; lastName: string } | null {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function isoToOryxDate(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  return { year: y, month: m, day: d };
}

function buildNotes(params: {
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

  // First line is what commonly shows in tooltip/list views; keep it compact.
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

export default function BookPage() {
  const [serviceType, setServiceType] = useState<ServiceType>("Cleaning");
  const [serviceDateISO, setServiceDateISO] = useState("");
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slotKey, setSlotKey] = useState<string>("");
  const [availabilityMsg, setAvailabilityMsg] = useState<string>("");

  const [fullName, setFullName] = useState("");
  const [dobISO, setDobISO] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [newOrExisting, setNewOrExisting] = useState<"new" | "existing">("new");

  const [hasInsurance, setHasInsurance] = useState<YesNo>("No");
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [insuranceMemberId, setInsuranceMemberId] = useState("");

  const [specialNeeds, setSpecialNeeds] = useState<YesNo>("No");
  const [specialNeedsDetails, setSpecialNeedsDetails] = useState("");

  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const selectedSlot = useMemo(() => {
    const [operatoryId, oralId, sh, sm] = slotKey.split("|").map((v) => Number(v));
    if (![operatoryId, oralId, sh, sm].every(Number.isFinite)) return null;
    return slots.find(
      (s) =>
        s.operatoryId === operatoryId &&
        s.oralId === oralId &&
        s.start.hour === sh &&
        s.start.minute === sm
    ) ?? null;
  }, [slotKey, slots]);

  async function loadAvailability() {
    setErr(null);
    setOkMsg(null);
    setSlots([]);
    setSlotKey("");
    setAvailabilityMsg("");
    if (!serviceDateISO) {
      setErr("Please select a date.");
      return;
    }
    setBusy(true);
    setAvailabilityMsg("Loading available times…");
    try {
      const res = await fetch(
        `/api/availability?date=${encodeURIComponent(serviceDateISO)}&apptType=${encodeURIComponent(
          serviceType
        )}&firstAvail=true`
        , { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setErr("Could not load availability. Try another date.");
        setAvailabilityMsg("");
        return;
      }
      const options: SlotOption[] = Array.isArray(json.data)
        ? json.data
            .filter((x: any) => x && x.oralId != null && x.operatoryId != null)
            .map((x: any) => {
              const sh = Number(x?.start?.hour);
              const sm = Number(x?.start?.minute);
              const eh = Number(x?.end?.hour);
              const em = Number(x?.end?.minute);
              return {
                label: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")} - ${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
                operatoryId: Number(x.operatoryId),
                oralId: Number(x.oralId),
                dayOfWeek: Number(x.dayOfWeek),
                start: { hour: sh, minute: sm },
                end: { hour: eh, minute: em },
              };
            })
        : [];

      // Don't show the currently selected slot again.
      const filtered =
        selectedSlot == null
          ? options
          : options.filter(
              (s) =>
                !(
                  s.operatoryId === selectedSlot.operatoryId &&
                  s.oralId === selectedSlot.oralId &&
                  s.start.hour === selectedSlot.start.hour &&
                  s.start.minute === selectedSlot.start.minute
                )
            );

      setSlots(filtered.slice(0, 20));
      if (!options.length) {
        setAvailabilityMsg("");
        setErr("No openings found for that date.");
      } else {
        setAvailabilityMsg(`Loaded ${Math.min(filtered.length, 20)} time options.`);
      }
    } catch (e: any) {
      setAvailabilityMsg("");
      setErr(`Availability request failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setErr(null);
    setOkMsg(null);

    const name = splitFullName(fullName);
    if (!name) {
      setErr("Please enter a full name (first and last).");
      return;
    }
    if (!selectedSlot) {
      setErr("Please choose an available time.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobISO)) {
      setErr("DOB must be YYYY-MM-DD.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("Please enter a valid email.");
      return;
    }
    if (!phoneNumber.trim()) {
      setErr("Please enter a phone number.");
      return;
    }
    if (serviceType === "Treatment") {
      // Business rule requested earlier.
      setNewOrExisting("existing");
    }

    const payload = {
      apptType: serviceType,
      reason: serviceType,
      notes: buildNotes({
        serviceType,
        insurance: hasInsurance,
        insuranceCompany: hasInsurance === "Yes" ? insuranceCompany.trim() : undefined,
        insuranceMemberId: hasInsurance === "Yes" ? insuranceMemberId.trim() : undefined,
        specialHealthcareNeeds: specialNeeds,
        specialHealthcareNeedsDetails: specialNeeds === "Yes" ? specialNeedsDetails : undefined,
        notes,
      }),

      insurance: hasInsurance,
      insuranceCompany: hasInsurance === "Yes" ? insuranceCompany.trim() : undefined,
      insuranceMemberId: hasInsurance === "Yes" ? insuranceMemberId.trim() : undefined,
      specialHealthcareNeeds: specialNeeds,
      specialHealthcareNeedsDetails: specialNeeds === "Yes" ? specialNeedsDetails : undefined,

      date: isoToOryxDate(serviceDateISO),
      start: { hour: selectedSlot.start.hour, minute: selectedSlot.start.minute, second: 0, millis: 0 },
      end: { hour: selectedSlot.end.hour, minute: selectedSlot.end.minute, second: 0, millis: 0 },
      dayOfWeek: selectedSlot.dayOfWeek,
      operatoryId: selectedSlot.operatoryId,
      oralId: selectedSlot.oralId,

      firstName: name.firstName,
      lastName: name.lastName,
      preferredName: name.firstName,
      dob: isoToOryxDate(dobISO),
      email,
      phoneNumber,
      newOrExisting: serviceType === "Treatment" ? "existing" : newOrExisting,

      // honeypot for basic bot filtering (server ignores if present)
      website: "",
    };

    setBusy(true);
    try {
      const res = await fetch("/api/web/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setErr(json?.error?.message ?? "Booking failed. Please try again.");
        return;
      }
      setOkMsg("Submitted. Your request will appear for admin approval.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 6 }}>Book an appointment</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Submit an online appointment request. A team member will review and confirm.
      </p>

      {err && (
        <div style={{ padding: 12, borderRadius: 12, background: "#ffecec", color: "#7a0000", marginBottom: 12 }}>
          {err}
        </div>
      )}
      {okMsg && (
        <div style={{ padding: 12, borderRadius: 12, background: "#ecfff0", color: "#0b5a1a", marginBottom: 12 }}>
          {okMsg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Service
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)} disabled={busy}>
            <option value="Emergency">Emergency</option>
            <option value="Cleaning">Cleaning</option>
            <option value="Consultation">Consultation</option>
            <option value="Treatment">Treatment (existing patients only)</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Patient type
          <select
            value={serviceType === "Treatment" ? "existing" : newOrExisting}
            onChange={(e) => setNewOrExisting(e.target.value as any)}
            disabled={busy || serviceType === "Treatment"}
          >
            <option value="new">New patient</option>
            <option value="existing">Existing patient</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Date
          <input type="date" value={serviceDateISO} onChange={(e) => setServiceDateISO(e.target.value)} disabled={busy} />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span>Availability</span>
          <button
            type="button"
            onClick={loadAvailability}
            disabled={busy || !serviceDateISO}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff" }}
          >
            Load available times
          </button>
          {availabilityMsg && (
            <span style={{ color: "#666", fontSize: 13 }}>{availabilityMsg}</span>
          )}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
          Time
          <select value={slotKey} onChange={(e) => setSlotKey(e.target.value)} disabled={busy || slots.length === 0}>
            <option value="">Select a time</option>
            {slots.map((s) => (
              <option key={`${s.operatoryId}|${s.oralId}|${s.start.hour}|${s.start.minute}`} value={`${s.operatoryId}|${s.oralId}|${s.start.hour}|${s.start.minute}`}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {slots.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: "#555", fontSize: 13, marginBottom: 8 }}>
              If your device doesn’t show dropdown options, select a time here:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {slots.map((s) => {
                const key = `${s.operatoryId}|${s.oralId}|${s.start.hour}|${s.start.minute}`;
                const active = slotKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSlotKey(key)}
                    disabled={busy}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: active ? "2px solid #111" : "1px solid #ddd",
                      background: active ? "#111" : "#fff",
                      color: active ? "#fff" : "#111",
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} placeholder="First Last" />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Date of birth (YYYY-MM-DD)
          <input value={dobISO} onChange={(e) => setDobISO(e.target.value)} disabled={busy} placeholder="2018-05-14" />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} placeholder="name@example.com" />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Phone number
          <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} disabled={busy} placeholder="+1 717-884-8807" />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Do you have dental insurance?
          <select value={hasInsurance} onChange={(e) => setHasInsurance(e.target.value as YesNo)} disabled={busy}>
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Insurance company name
          <input
            value={insuranceCompany}
            onChange={(e) => setInsuranceCompany(e.target.value)}
            disabled={busy || hasInsurance !== "Yes"}
            placeholder="e.g., Aetna"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Member ID
          <input
            value={insuranceMemberId}
            onChange={(e) => setInsuranceMemberId(e.target.value)}
            disabled={busy || hasInsurance !== "Yes"}
            placeholder="e.g., 123456789"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Any special healthcare needs?
          <select value={specialNeeds} onChange={(e) => setSpecialNeeds(e.target.value as YesNo)} disabled={busy}>
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </label>

        {specialNeeds === "Yes" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            Special needs details
            <input
              value={specialNeedsDetails}
              onChange={(e) => setSpecialNeedsDetails(e.target.value)}
              disabled={busy}
              placeholder="Optional"
            />
          </label>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} rows={4} />
        </label>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff" }}
        >
          Submit request
        </button>
        <span style={{ color: "#666", fontSize: 13, alignSelf: "center" }}>
          Your information is sent to Smile Squad for scheduling.
        </span>
      </div>
    </div>
  );
}

