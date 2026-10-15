/**
 * Formatting in the business timezone (Asia/Kolkata), independent of server or device settings,
 * so server-rendered and client-rendered output always match.
 */
export const BUSINESS_TZ = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Wall-clock parts in IST for an instant. IST has no DST, so a fixed offset is exact. */
export function istParts(input: Date | string | number): Parts {
  const date = input instanceof Date ? input : new Date(input);
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** DD MMM YYYY for a timestamp, in IST. */
export function formatDate(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const p = istParts(value);
  if (Number.isNaN(p.year)) return "—";
  return `${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** DD MMM YYYY for a calendar date string (YYYY-MM-DD) without timezone shifting. */
export function formatCalendarDate(value: string | null | undefined) {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatTime(value: Date | string | number | null | undefined) {
  if (!value) return "—";
  const p = istParts(value);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;
}

export function formatDateTime(value: Date | string | number | null | undefined) {
  if (!value) return "—";
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** Today in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()) {
  const p = istParts(now);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converts an IST wall-clock date + time (YYYY-MM-DD, HH:mm) to an absolute instant. */
export function istToInstant(date: string, time = "00:00") {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000);
}

/** IST wall-clock value for <input type="datetime-local">. */
export function toIstInputValue(value: Date | string) {
  const p = istParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromIstInputValue(value: string) {
  const [date, time] = value.split("T");
  return istToInstant(date, time ?? "00:00");
}

/** Relative day label for follow-ups: Today, Tomorrow, Yesterday, or the date. */
export function relativeDay(value: Date | string, now: Date = new Date()) {
  const target = todayIST(new Date(value));
  const today = todayIST(now);
  if (target === today) return "Today";
  if (target === addDays(today, 1)) return "Tomorrow";
  if (target === addDays(today, -1)) return "Yesterday";
  return formatDate(value);
}

export function formatDue(value: Date | string, now: Date = new Date()) {
  return `${relativeDay(value, now)}, ${formatTime(value)}`;
}

export function timeAgo(value: Date | string | null | undefined, now: Date = new Date()) {
  if (!value) return "—";
  const seconds = Math.round((now.getTime() - new Date(value).getTime()) / 1000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? "ago" : "from now";
  if (abs < 45) return seconds >= 0 ? "just now" : "in a moment";
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86_400) return `${Math.round(abs / 3600)} h ${suffix}`;
  if (abs < 7 * 86_400) return `${Math.round(abs / 86_400)} d ${suffix}`;
  return formatDate(value);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function formatINR(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? inr.format(n) : "—";
}

/** +919991999189 → +91 99919 99189 for Indian mobiles; other numbers unchanged. */
export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "—";
  const m = e164.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
