import { formatCalendarDate } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode } from "@/lib/domain/labels";

/** Company details printed on every quotation. */
export const QUOTATION_COMPANY = {
  name: "KHANA BANAO",
  brand: "Chefpy",
  tagline: "Your Trusted Partner for Events & Chef Services",
  addressLines: ["Embassy TechVillage, Outer Ring Road,", "Devarabisanahalli, Bellandur,", "Bengaluru, Karnataka – 560103"],
  phone: "+91 94227 99299",
  email: "info@khanabanao.com",
  website: "www.chefpy.com",
  workingHours: "Mon–Sun, 9:00 – 21:00",
  responseTime: "Within a few hours",
} as const;

/** Share of the final package price taken as the booking advance. */
export const ADVANCE_RATE = 0.4;

export type QuotationLead = {
  lead_number: number;
  customer_name: string;
  occasion_code: string | null;
  guest_range: string | null;
  event_date: string | null;
  event_date_raw: string | null;
  event_address: string | null;
  quoted_amount_inr: string | number | null;
};

export type QuotationDefaults = {
  quoteNo: string;
  quoteDate: string;
  validTill: string;
  customerName: string;
  eventDate: string;
  occasion: string;
  guests: string;
  location: string;
  packagePrice: string;
};

/** "—" is the app's empty marker; on a quotation an empty field should stay blank to fill in. */
const blankIfDash = (v: string) => (v === "—" ? "" : v);

/** Today's calendar date in India as YYYY-MM-DD. */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Parses "6,500", "₹6500", " 6500.50 " → number; anything without digits → null. */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 650000 → "6,50,000" (Indian grouping, no currency sign). */
export function formatAmount(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Final price = package − discount (never below zero); advance = 40% of final, rounded to the rupee. */
export function quotationTotals(packagePrice: string, discount: string) {
  const price = parseAmount(packagePrice);
  if (price === null) return { final: null, advance: null };
  const final = Math.max(price - (parseAmount(discount) ?? 0), 0);
  return { final, advance: advanceFor(final) };
}

export function advanceFor(final: number | null): number | null {
  return final === null ? null : Math.round(final * ADVANCE_RATE);
}

export function quotationDefaults(lead: QuotationLead, now: Date): QuotationDefaults {
  const today = istDate(now);
  const quoted = parseAmount(lead.quoted_amount_inr);
  return {
    quoteNo: `KB-${lead.lead_number}-${today.slice(2).replaceAll("-", "")}`,
    quoteDate: formatCalendarDate(today),
    validTill: formatCalendarDate(today),
    customerName: lead.customer_name,
    eventDate: lead.event_date ? formatCalendarDate(lead.event_date) : (lead.event_date_raw ?? ""),
    occasion: blankIfDash(humanizeCode(lead.occasion_code)),
    guests: blankIfDash(guestRangeLabel(lead.guest_range)),
    location: lead.event_address ?? "",
    packagePrice: quoted === null ? "" : formatAmount(quoted),
  };
}
